import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createBehaviorAdapter } from "../deployment/adapter.ts";
import { descriptor } from "../deployment/descriptor.ts";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

async function workspace(context: { after(fn: () => unknown): void }) {
	const root = await mkdtemp(join(tmpdir(), "proflow-chrome-boundary-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

test("EXT-CHROME-01 chrome-runtime owns only the external browser prerequisite, not Task/Worker identity", () => {
	assert.match(readme, /external browser prerequisite/i);
	assert.match(readme, /not a Task\/Worker identity owner/i);
	assert.doesNotMatch(
		JSON.stringify(descriptor),
		/workerRef|conversationLocator|taskId|nodeId/,
	);
});

test("EXT-CHROME-02 tab/window identity is transient and frame registry is not a v1 readiness contract", () => {
	assert.match(readme, /tab\/window ids remain transient/i);
	assert.match(readme, /No frame registry/i);
	assert.doesNotMatch(
		JSON.stringify(descriptor),
		/frameRegistry|frameRole|persistentTab/,
	);
});

test("EXT-CHROME-03 Chrome availability establishes only chrome-runtime readiness, not MV3 extension state", async (context) => {
	const workspaceRoot = await workspace(context);
	const adapter = createBehaviorAdapter(async () => ({
		available: true,
		resourceVersion: "Chrome 150.0.0.0",
		extensionLoaded: false,
	}));
	const status = await adapter.status({ workspaceRoot });
	assert.deepEqual(status.result.data, {
		setupStatus: "READY",
		runtimeStatus: "RUNNING",
	});
	assert.equal(
		JSON.stringify(status.result.data).includes("extensionLoaded"),
		false,
	);
});

test("EXT-CHROME-04 external Chrome runtime uses the fixed seven-command management contract without descriptor lifecycle metadata", () => {
	assert.equal("lifecycle" in descriptor, false);
	assert.equal("verification" in descriptor, false);
});
