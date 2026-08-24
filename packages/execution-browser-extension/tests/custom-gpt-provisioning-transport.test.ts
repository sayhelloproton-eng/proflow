import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const extensionId = "p".repeat(32);
const extensionInstanceId = "extension:provisioning-transport";
const token = "provisioning-token-".padEnd(40, "x");

async function call(endpoint: string, path: string, init: RequestInit = {}) {
	return fetch(`${endpoint}${path}`, {
		...init,
		headers: {
			authorization: `Bearer ${token}`,
			origin: `chrome-extension://${extensionId}`,
			"content-type": "application/json",
			...(init.headers ?? {}),
		},
	});
}

async function callWithoutOrigin(
	endpoint: string,
	path: string,
	init: RequestInit = {},
) {
	return fetch(`${endpoint}${path}`, {
		...init,
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
			...(init.headers ?? {}),
		},
	});
}

test("CP-EXE-BR-17 provisioning uses an independent authenticated command transport", async () => {
	const module = (await import("../src/provisioning-bridge.ts")) as Record<
		string,
		unknown
	>;
	const create = module.createCustomGptProvisioningBridgeServer;
	assert.equal(typeof create, "function");
	if (typeof create !== "function") return;
	type ProvisioningServer = {
		endpoint: string;
		provisioning: {
			request(input: Record<string, unknown>): Promise<unknown>;
		};
		close(): Promise<void>;
	};
	const server = await (
		create as (input: Record<string, unknown>) => Promise<ProvisioningServer>
	)({
		token,
		extensionId,
		commandTimeoutMs: 2_000,
	});
	try {
		assert.match(server.endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
		const hello = await call(
			server.endpoint,
			"/v1/provisioning/session/hello",
			{
				method: "POST",
				body: JSON.stringify({ extensionId, extensionInstanceId }),
			},
		);
		assert.equal(hello.status, 200);
		const heartbeat = await call(
			server.endpoint,
			`/v1/provisioning/session/heartbeat?extensionInstanceId=${encodeURIComponent(extensionInstanceId)}`,
			{ method: "POST", body: "{}" },
		);
		assert.equal(heartbeat.status, 200);
		const pending = server.provisioning.request({
			type: "PROVISION_CUSTOM_GPT",
			request: { packageName: "@tomflow/proflow-agent-product" },
		});
		const next = await callWithoutOrigin(
			server.endpoint,
			`/v1/provisioning/commands/next?extensionInstanceId=${encodeURIComponent(extensionInstanceId)}`,
		);
		assert.equal(next.status, 200);
		const command = (await next.json()) as Record<string, unknown>;
		assert.equal(command.type, "PROVISION_CUSTOM_GPT");
		assert.equal(typeof command.commandId, "string");
		const result = await call(
			server.endpoint,
			`/v1/provisioning/commands/result?extensionInstanceId=${encodeURIComponent(extensionInstanceId)}`,
			{
				method: "POST",
				body: JSON.stringify({
					commandId: command.commandId,
					ok: true,
					value: { gptId: "g-test" },
				}),
			},
		);
		assert.equal(result.status, 200);
		assert.deepEqual(await pending, { gptId: "g-test" });

		const authPending = server.provisioning.request({
			type: "FINALIZE_CUSTOM_GPT_AUTH",
			request: {
				carrierUrl: "https://chatgpt.com/g/g-test",
				credential: "role-credential-".padEnd(40, "x"),
			},
		});
		const authNext = await callWithoutOrigin(
			server.endpoint,
			`/v1/provisioning/commands/next?extensionInstanceId=${encodeURIComponent(extensionInstanceId)}`,
		);
		assert.equal(authNext.status, 200);
		const authCommand = (await authNext.json()) as Record<string, unknown>;
		assert.equal(authCommand.type, "FINALIZE_CUSTOM_GPT_AUTH");
		const authResult = await call(
			server.endpoint,
			`/v1/provisioning/commands/result?extensionInstanceId=${encodeURIComponent(extensionInstanceId)}`,
			{
				method: "POST",
				body: JSON.stringify({
					commandId: authCommand.commandId,
					ok: true,
					value: { status: "AUTH_UPDATED", gptId: "g-test" },
				}),
			},
		);
		assert.equal(authResult.status, 200);
		assert.deepEqual(await authPending, {
			status: "AUTH_UPDATED",
			gptId: "g-test",
		});
	} finally {
		await server.close();
	}
});

test("CP-EXE-BR-17A knowledge relay accepts the real originless GET once", async () => {
	const module = (await import("../src/provisioning-bridge.ts")) as Record<
		string,
		unknown
	>;
	const create = module.createCustomGptProvisioningBridgeServer;
	assert.equal(typeof create, "function");
	if (typeof create !== "function") return;
	const temporaryRoot = await mkdtemp(
		join(tmpdir(), "proflow-provisioning-relay-"),
	);
	const knowledgePath = join(temporaryRoot, "knowledge.md");
	await writeFile(knowledgePath, "proflow knowledge relay", "utf8");
	type ProvisioningServer = {
		endpoint: string;
		provisioning: {
			registerFiles(
				input: Array<Record<string, unknown>>,
			): Promise<Array<Record<string, unknown>>>;
		};
		close(): Promise<void>;
	};
	const server = await (
		create as (input: Record<string, unknown>) => Promise<ProvisioningServer>
	)({ token, extensionId });
	try {
		const hello = await call(
			server.endpoint,
			"/v1/provisioning/session/hello",
			{
				method: "POST",
				body: JSON.stringify({ extensionId, extensionInstanceId }),
			},
		);
		assert.equal(hello.status, 200);
		const [descriptor] = await server.provisioning.registerFiles([
			{ name: "knowledge.md", path: knowledgePath, mime: "text/markdown" },
		]);
		assert.equal(typeof descriptor?.url, "string");
		const relayUrl = String(descriptor?.url);
		const first = await fetch(relayUrl);
		assert.equal(first.status, 200);
		assert.equal(await first.text(), "proflow knowledge relay");
		const second = await fetch(relayUrl);
		assert.equal(second.status, 404);
	} finally {
		await server.close();
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});

test("CP-EXE-BR-18 extension wires provisioning bridge to the GPT editor content surface", async () => {
	const { readFile } = await import("node:fs/promises");
	const root = new URL("..", import.meta.url);
	const adapter = await readFile(
		new URL("deployment/adapter.ts", root),
		"utf8",
	);
	const background = await readFile(
		new URL("extension/background.ts", root),
		"utf8",
	);
	const content = await readFile(
		new URL("extension/provisioning-content.ts", root),
		"utf8",
	);
	const build = await readFile(
		new URL("../../../scripts/build-packages.mjs", import.meta.url),
		"utf8",
	);

	assert.match(adapter, /proflowProvisioningBridge/);
	assert.match(adapter, /provisioningBridgeEndpoint/);
	assert.match(adapter, /provisioningBridgeTokenFile/);
	assert.match(background, /runProvisioningBridgeLoop/);
	assert.match(background, /\/v1\/provisioning\/session\/hello/);
	assert.match(background, /\/v1\/provisioning\/commands\/next/);
	assert.match(background, /PROFLOW_PROVISIONING_COMMAND/);
	assert.match(background, /PROVISIONING_SURFACE_NOT_READY/);
	const provisioningFunctionStart = background.indexOf(
		"async function executeProvisioningCommand",
	);
	const provisioningFunctionEnd = background.indexOf(
		"async function bridgeFetch",
		provisioningFunctionStart,
	);
	assert.ok(provisioningFunctionStart >= 0);
	assert.ok(provisioningFunctionEnd > provisioningFunctionStart);
	const provisioningFunction = background.slice(
		provisioningFunctionStart,
		provisioningFunctionEnd,
	);
	assert.match(
		provisioningFunction,
		/chrome\.tabs\.create\(\{ url: editorUrl, active: true \}\)/,
	);
	assert.match(provisioningFunction, /https:\/\/chatgpt\.com\/gpts\/editor/);
	assert.match(provisioningFunction, /FINALIZE_CUSTOM_GPT_AUTH/);
	assert.match(provisioningFunction, /PROVISIONING_CARRIER_URL_INVALID/);
	assert.match(provisioningFunction, /gpts\/editor\/\$\{match\[1\]\}/);
	assert.doesNotMatch(
		provisioningFunction,
		/waitForNewEditorTab|finalizeProvisioningCreate|PROFLOW_PROVISIONING_FINALIZE_CREATE/,
	);
	assert.doesNotMatch(provisioningFunction, /chrome\.tabs\.update/);
	assert.match(background, /missingProvisioningReceiver/);
	assert.match(background, /receiverReloaded/);
	assert.match(background, /chrome\.tabs\.get\(tabId\)/);
	assert.match(background, /chrome\.tabs\.reload\(tabId\)/);
	assert.match(content, /PROFLOW_PROVISIONING_COMMAND/);
	assert.doesNotMatch(content, /PROFLOW_PROVISIONING_FINALIZE_CREATE/);
	assert.match(content, /chrome\.runtime\.onMessage\.addListener/);
	assert.doesNotMatch(content, /GPT_EDITOR_CREATE_BUTTON_NOT_FOUND/);
	assert.match(content, /matchesExactSemantic/);
	assert.match(content, /element\.getAttribute\("role"\) !== "radio"/);
	assert.match(content, /element\.closest\('\[role="radiogroup"\]'\) === null/);
	assert.match(content, /getClientRects\(\)\.length > 0/);
	assert.match(content, /getComputedStyle\(element\)/);
	assert.doesNotMatch(content, /matchesAny\(element, \["Create", "创建"\]\)/);
	assert.match(content, /"Only me"/);
	assert.match(content, /"Private"/);
	assert.match(content, /"只有我"/);
	assert.match(content, /"私有"/);
	assert.doesNotMatch(content, /Invite-only|Invite only|仅限受邀者/);
	assert.doesNotMatch(content, /waitForDialogClickable/);
	assert.match(content, /FINALIZE_CUSTOM_GPT_AUTH/);
	assert.match(content, /existingActionEditButton/);
	assert.match(content, /openExistingActionEditor/);
	assert.match(content, /GPT_EDITOR_ACTION_EDIT_NOT_FOUND/);
	assert.match(content, /finalizeBearerAuth/);
	assert.match(content, /GPT_EDITOR_AUTH_DIALOG_NOT_FOUND/);
	assert.match(content, /GPT_EDITOR_AUTH_KEY_READBACK_MISMATCH/);
	assert.match(content, /GPT_EDITOR_PRIVATE_CONTROL_NOT_FOUND/);
	assert.match(content, /GPT_EDITOR_PRIVATE_SELECTION_NOT_CONFIRMED/);
	assert.match(content, /GPT_EDITOR_PRIVATE_CREATE_ACTION_NOT_FOUND/);
	assert.match(content, /settings saved/);
	assert.match(content, /设置已保存/);
	assert.doesNotMatch(
		content,
		/clickable\(\["Update", "更新", "Share", "分享"\]\)/,
	);
	assert.doesNotMatch(content, /waitForPublishCreateButton|publishTriggered/);
	assert.match(content, /verifyConfiguredMaterial/);
	assert.match(content, /GPT_EDITOR_CREATE_NOT_READY/);
	assert.match(content, /GPT_EDITOR_FORM_READY_STATE_LOST/);
	assert.match(content, /GPT_EDITOR_ACTION_SCHEMA_READBACK_MISMATCH/);
	assert.match(content, /GPT_EDITOR_KNOWLEDGE_READBACK_MISMATCH/);
	assert.match(content, /waitForKnowledgeName/);
	assert.match(content, /knowledgeReadbackMatches\(name\)/);
	assert.match(build, /provisioning-content\.ts/);
	assert.match(build, /--format=iife/);
	assert.doesNotMatch(
		content,
		/ExecuteCapabilityRequest|TaskObserver|workerRef|taskId/,
	);
});
