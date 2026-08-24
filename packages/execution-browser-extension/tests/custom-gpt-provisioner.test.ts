import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	deterministicLoopbackPort,
	ensureModuleSecretFile,
	writeModuleSharedFacts,
} from "@tomflow/proflow-module-contract";
import {
	createCustomGptProvisioningHost,
	createWorkspaceCustomGptProvisioningHost,
} from "../src/custom-gpt-provisioner.ts";

const extensionId = "h".repeat(32);
const extensionInstanceId = "extension:host-test";
const token = "provisioning-host-token-".padEnd(40, "x");

function storedZip(name: string, content: string): Buffer {
	const nameBytes = Buffer.from(name);
	const data = Buffer.from(content);
	const local = Buffer.alloc(30);
	local.writeUInt32LE(0x04034b50, 0);
	local.writeUInt16LE(20, 4);
	local.writeUInt32LE(data.length, 18);
	local.writeUInt32LE(data.length, 22);
	local.writeUInt16LE(nameBytes.length, 26);
	const central = Buffer.alloc(46);
	central.writeUInt32LE(0x02014b50, 0);
	central.writeUInt16LE(20, 4);
	central.writeUInt16LE(20, 6);
	central.writeUInt32LE(data.length, 20);
	central.writeUInt32LE(data.length, 24);
	central.writeUInt16LE(nameBytes.length, 28);
	const localPart = Buffer.concat([local, nameBytes, data]);
	const centralPart = Buffer.concat([central, nameBytes]);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(1, 8);
	eocd.writeUInt16LE(1, 10);
	eocd.writeUInt32LE(centralPart.length, 12);
	eocd.writeUInt32LE(localPart.length, 16);
	return Buffer.concat([localPart, centralPart, eocd]);
}

async function extensionFetch(
	endpoint: string,
	path: string,
	init: RequestInit = {},
) {
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
test("CP-EXE-BR-20 Mac provisioner hydrates package assets before sending one provisioning command", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-provisioner-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const packageRoot = join(root, "package");
	await mkdir(join(packageRoot, "actions"), { recursive: true });
	await mkdir(join(packageRoot, "knowledge"), { recursive: true });
	await writeFile(
		join(packageRoot, "actions/custom-gpt.openapi.yaml"),
		"openapi: 3.1.0\nservers:\n  - url: https://GATEWAY_PUBLIC_HOST\n",
	);
	await writeFile(
		join(packageRoot, "knowledge/custom-gpt-knowledge.zip"),
		storedZip("proflow-knowledge-smoke.md", "PF-KNOWLEDGE-REAL2-001"),
	);
	const host = await createCustomGptProvisioningHost({
		token,
		extensionId,
		commandTimeoutMs: 2_000,
		onlineTimeoutMs: 2_000,
	});
	context.after(() => host.close());
	const hello = await extensionFetch(
		host.endpoint,
		"/v1/provisioning/session/hello",
		{
			method: "POST",
			body: JSON.stringify({ extensionId, extensionInstanceId }),
		},
	);
	assert.equal(hello.status, 200);
	const heartbeat = await extensionFetch(
		host.endpoint,
		`/v1/provisioning/session/heartbeat?extensionInstanceId=${encodeURIComponent(extensionInstanceId)}`,
		{ method: "POST", body: "{}" },
	);
	assert.equal(heartbeat.status, 200);
	const pending = host.provisionPackage({
		packageRoot,
		stagingRoot: join(root, "stage"),
		gatewayUrl: "https://gateway.example.test",
		material: {
			packageName: "@tomflow/proflow-agent-product",
			version: "0.1.0",
			displayName: "Product Agent",
			description: "Product role",
			instructions: "Follow product instructions",
			conversationStarters: ["Start product work"],
			recommendedModel: "gpt-5-6",
			capabilities: {
				webSearch: true,
				imageGeneration: false,
				codeInterpreter: true,
			},
			knowledgeBundle: "knowledge/custom-gpt-knowledge.zip",
			actionSchema: "actions/custom-gpt.openapi.yaml",
		},
	});
	const nextPath = `/v1/provisioning/commands/next?extensionInstanceId=${encodeURIComponent(extensionInstanceId)}`;
	let next = await extensionFetch(host.endpoint, nextPath);
	const nextDeadline = Date.now() + 2_000;
	while (next.status === 204 && Date.now() < nextDeadline) {
		await new Promise<void>((resolveWait) => setTimeout(resolveWait, 25));
		next = await extensionFetch(host.endpoint, nextPath);
	}
	assert.equal(next.status, 200);
	const command = (await next.json()) as Record<string, unknown>;
	const hydrated = command.request as Record<string, unknown>;
	assert.match(
		String(hydrated.actionSchema),
		/https:\/\/gateway\.example\.test/,
	);
	assert.doesNotMatch(String(hydrated.actionSchema), /GATEWAY_PUBLIC_HOST/);
	const files = hydrated.knowledgeFiles as Array<Record<string, unknown>>;
	assert.equal(files.length, 1);
	const fileResponse = await fetch(String(files[0]?.url), {
		headers: { origin: "https://chatgpt.com" },
	});
	assert.equal(fileResponse.status, 200);
	assert.equal(await fileResponse.text(), "PF-KNOWLEDGE-REAL2-001");
	const report = await extensionFetch(
		host.endpoint,
		`/v1/provisioning/commands/result?extensionInstanceId=${encodeURIComponent(extensionInstanceId)}`,
		{
			method: "POST",
			body: JSON.stringify({
				commandId: command.commandId,
				ok: true,
				value: {
					status: "LIVE_CREATED",
					packageName: "@tomflow/proflow-agent-product",
					version: "0.1.0",
					gptId: "g-product",
					carrierUrl: "https://chatgpt.com/g/g-product",
				},
			}),
		},
	);
	assert.equal(report.status, 200);
	const result = await pending;
	assert.deepEqual(result, {
		status: "LIVE_CREATED",
		packageName: "@tomflow/proflow-agent-product",
		version: "0.1.0",
		gptId: "g-product",
		carrierUrl: "https://chatgpt.com/g/g-product",
		knowledgeBundleSha256: result.knowledgeBundleSha256,
		knowledgeFiles: result.knowledgeFiles,
	});
	assert.match(result.knowledgeBundleSha256, /^sha256:[0-9a-f]{64}$/);
	assert.deepEqual(
		result.knowledgeFiles.map((file) => file.name),
		["proflow-knowledge-smoke.md"],
	);
});

test("CP-EXE-BR-20 workspace factory binds the Extension-owned deterministic provisioning facts", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-provisioning-workspace-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const moduleContext = { workspaceRoot: root };
	const moduleRef = "execution-browser-extension";
	const tokenFile = await ensureModuleSecretFile(
		moduleContext,
		moduleRef,
		"provisioning",
	);
	const port = deterministicLoopbackPort(
		moduleContext,
		moduleRef,
		"provisioning",
	);
	await writeModuleSharedFacts(moduleContext, moduleRef, {
		extensionId,
		provisioningBridgeTokenFile: tokenFile,
		provisioningBridgeEndpoint: `http://127.0.0.1:${port}`,
	});
	const host = await createWorkspaceCustomGptProvisioningHost({
		workspaceRoot: root,
	});
	context.after(() => host.close());
	assert.equal(host.endpoint, `http://127.0.0.1:${port}`);
	assert.equal(host.status().online, false);
});
