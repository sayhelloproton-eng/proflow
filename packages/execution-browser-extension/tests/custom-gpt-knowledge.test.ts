import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { materializeCustomGptKnowledgeBundle } from "../src/custom-gpt-knowledge.ts";
import { createCustomGptProvisioningBridgeServer } from "../src/provisioning-bridge.ts";

function storedZip(name: string, content: string): Buffer {
	const nameBytes = Buffer.from(name);
	const data = Buffer.from(content);
	const local = Buffer.alloc(30);
	local.writeUInt32LE(0x04034b50, 0);
	local.writeUInt16LE(20, 4);
	local.writeUInt16LE(0, 6);
	local.writeUInt16LE(0, 8);
	local.writeUInt32LE(0, 14);
	local.writeUInt32LE(data.length, 18);
	local.writeUInt32LE(data.length, 22);
	local.writeUInt16LE(nameBytes.length, 26);
	local.writeUInt16LE(0, 28);
	const central = Buffer.alloc(46);
	central.writeUInt32LE(0x02014b50, 0);
	central.writeUInt16LE(20, 4);
	central.writeUInt16LE(20, 6);
	central.writeUInt16LE(0, 8);
	central.writeUInt16LE(0, 10);
	central.writeUInt32LE(0, 16);
	central.writeUInt32LE(data.length, 20);
	central.writeUInt32LE(data.length, 24);
	central.writeUInt16LE(nameBytes.length, 28);
	central.writeUInt16LE(0, 30);
	central.writeUInt16LE(0, 32);
	central.writeUInt16LE(0, 34);
	central.writeUInt16LE(0, 36);
	central.writeUInt32LE(0, 38);
	central.writeUInt32LE(0, 42);
	const localPart = Buffer.concat([local, nameBytes, data]);
	const centralPart = Buffer.concat([central, nameBytes]);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(0, 4);
	eocd.writeUInt16LE(0, 6);
	eocd.writeUInt16LE(1, 8);
	eocd.writeUInt16LE(1, 10);
	eocd.writeUInt32LE(centralPart.length, 12);
	eocd.writeUInt32LE(localPart.length, 16);
	eocd.writeUInt16LE(0, 20);
	return Buffer.concat([localPart, centralPart, eocd]);
}

const extensionId = "k".repeat(32);
const extensionInstanceId = "extension:knowledge";
const token = "knowledge-token-".padEnd(40, "x");

async function authorizedFetch(url: string, init: RequestInit = {}) {
	return fetch(url, {
		...init,
		headers: {
			authorization: `Bearer ${token}`,
			origin: `chrome-extension://${extensionId}`,
			...(init.headers ?? {}),
		},
	});
}
async function pageFetch(url: string, init: RequestInit = {}) {
	return fetch(url, {
		...init,
		headers: {
			origin: "https://chatgpt.com",
			...(init.headers ?? {}),
		},
	});
}

test("CP-EXE-BR-20 knowledge ZIP materialization is traversal-safe and hashed", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-knowledge-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const bundle = join(root, "knowledge.zip");
	const archive = storedZip(
		"proflow-knowledge-smoke.md",
		"PF-KNOWLEDGE-REAL2-001",
	);
	await writeFile(bundle, archive);
	const result = await materializeCustomGptKnowledgeBundle({
		bundlePath: bundle,
		stagingRoot: join(root, "stage"),
	});
	assert.equal(result.files.length, 1);
	assert.equal(result.files[0]?.name, "knowledge.zip");
	assert.equal(result.files[0]?.mime, "application/zip");
	assert.match(result.files[0]?.sha256 ?? "", /^sha256:[0-9a-f]{64}$/);
	assert.deepEqual(await readFile(result.files[0]?.path ?? ""), archive);

	const malicious = join(root, "malicious.zip");
	await writeFile(malicious, storedZip("../escape.md", "escape"));
	await assert.rejects(
		materializeCustomGptKnowledgeBundle({
			bundlePath: malicious,
			stagingRoot: join(root, "stage-malicious"),
		}),
		/KNOWLEDGE_ZIP_ENTRY_UNSAFE/,
	);
});

test("CP-EXE-BR-20 provisioning file relay is authenticated and one-time", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-knowledge-relay-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const file = join(root, "proflow-knowledge-smoke.md");
	await writeFile(file, "PF-KNOWLEDGE-REAL2-001");
	const server = await createCustomGptProvisioningBridgeServer({
		token,
		extensionId,
		commandTimeoutMs: 2_000,
	});
	context.after(() => server.close());
	const hello = await authorizedFetch(
		`${server.endpoint}/v1/provisioning/session/hello`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ extensionId, extensionInstanceId }),
		},
	);
	assert.equal(hello.status, 200);
	const heartbeat = await authorizedFetch(
		`${server.endpoint}/v1/provisioning/session/heartbeat?extensionInstanceId=${encodeURIComponent(extensionInstanceId)}`,
		{ method: "POST", body: "{}" },
	);
	assert.equal(heartbeat.status, 200);

	const registered = await server.provisioning.registerFiles([
		{
			name: "proflow-knowledge-smoke.md",
			path: file,
			mime: "text/markdown",
		},
	]);
	assert.equal(registered.length, 1);
	const url = String(registered[0]?.url);
	const first = await pageFetch(url);
	assert.equal(first.status, 200);
	assert.equal(await first.text(), "PF-KNOWLEDGE-REAL2-001");
	const second = await pageFetch(url);
	assert.equal(second.status, 404);
});
