import assert from "node:assert/strict";
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
		const next = await call(
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
				credential: "role-scoped-bearer-test-credential",
			},
		});
		const authNext = await call(
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
					value: { status: "AUTH_UPDATED" },
				}),
			},
		);
		assert.equal(authResult.status, 200);
		assert.deepEqual(await authPending, { status: "AUTH_UPDATED" });
	} finally {
		await server.close();
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

	assert.match(adapter, /proflowProvisioningBridge/);
	assert.match(adapter, /provisioningBridgeEndpoint/);
	assert.match(adapter, /provisioningBridgeTokenFile/);
	assert.match(background, /runProvisioningBridgeLoop/);
	assert.match(background, /\/v1\/provisioning\/session\/hello/);
	assert.match(background, /\/v1\/provisioning\/commands\/next/);
	assert.match(background, /PROFLOW_PROVISIONING_COMMAND/);
	assert.match(content, /PROFLOW_PROVISIONING_COMMAND/);
	assert.match(content, /chrome\.runtime\.onMessage\.addListener/);
	assert.doesNotMatch(
		content,
		/ExecuteCapabilityRequest|TaskObserver|workerRef|taskId/,
	);
});
