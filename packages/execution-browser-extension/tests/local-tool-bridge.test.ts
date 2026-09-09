import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createLocalToolBridgeHostClient, createLocalToolBridgeServer, LocalToolBridgeError } from "../src/local-tool-bridge.ts";

const extensionId = "a".repeat(32);
const hostToken = "h".repeat(64);
const extensionToken = "e".repeat(64);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

test("CP-EXE-BR-39 Local Tool lane bounds concurrency and rechecks the absolute deadline at the Effect Gate", async (context) => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), "proflow-local-lane-"));
	context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
	const release = deferred();
	let active = 0; let maxActive = 0; let calls = 0;
	const bridge = await createLocalToolBridgeServer({
		hostToken, extensionToken, extensionId, generation: "generation-s2", workspaceRoot,
		execute: async (command) => { calls += 1; active += 1; maxActive = Math.max(maxActive, active); if ((command.input as { name?: string }).name === "first") await release.promise; active -= 1; return { ok: true }; },
	});
	context.after(() => bridge.close());
	const headers = { authorization: `Bearer ${extensionToken}`, origin: `chrome-extension://${extensionId}`, "content-type": "application/json" };
	await fetch(`${bridge.endpoint}/v1/local-tools/session/hello`, { method: "POST", headers, body: JSON.stringify({ extensionId, extensionInstanceId: "ext-s2", moduleVersion: "0.1.50" }) });
	const query = "?extensionInstanceId=ext-s2";
	const poll = () => fetch(`${bridge.endpoint}/v1/local-tools/commands/next${query}`, { headers });
	assert.equal((await poll()).status, 204);
	const claim = async () => {
		for (let attempt = 0; attempt < 50; attempt += 1) { const response = await poll(); if (response.status === 200) return (await response.json()) as Record<string, unknown>; assert.equal(response.status, 204); await sleep(10); }
		throw new Error("COMMAND_NOT_CLAIMED");
	};
	const client = createLocalToolBridgeHostClient({ endpoint: bridge.endpoint, token: hostToken });
	const effect = (name: string, deadlineAt = new Date(Date.now() + 5_000).toISOString()) => client.request({ authenticatedRoleRef: "g-dev", workspaceRoot, tool: "localDev", operation: "mutate", input: { action: "write", path: `${name}.txt`, name }, deadlineAt });
	const execute = (command: Record<string, unknown>) => fetch(`${bridge.endpoint}/v1/local-tools/commands/execute${query}`, { method: "POST", headers, body: JSON.stringify(command) });

	const first = effect("first");
	const firstCommand = await claim();
	assert.equal((await execute(firstCommand)).status, 202);
	const second = effect("second");
	for (let attempt = 0; attempt < 50 && bridge.status().pendingCommands < 2; attempt += 1) await sleep(10);
	assert.equal((await poll()).status, 204);
	release.resolve();
	await first;
	const secondCommand = await claim();
	assert.equal((await execute(secondCommand)).status, 202);
	await second;
	assert.equal(maxActive, 1);

	const expiredAssertion = assert.rejects(
		effect("expired", new Date(Date.now() + 120).toISOString()),
		(error) => error instanceof LocalToolBridgeError && error.code === "LOCAL_TOOL_COMMAND_TIMEOUT",
	);
	const expiredCommand = await claim();
	await sleep(160);
	assert.notEqual((await execute(expiredCommand)).status, 202);
	await expiredAssertion;
	assert.equal(calls, 2);
});
