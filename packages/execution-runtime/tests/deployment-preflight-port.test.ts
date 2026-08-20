import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { behaviorAdapter } from "../deployment/adapter.ts";

async function workspace(context: { after(fn: () => unknown): void }) {
	const root = await mkdtemp(
		join(tmpdir(), "proflow-execution-runtime-deployment-"),
	);
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

test("FJ-07 status exposes missing producer facts as FAILED instead of a Platform preflight", async (context) => {
	const workspaceRoot = await workspace(context);
	const observed = await behaviorAdapter.status({ workspaceRoot });
	assert.equal(observed.result.status, "SUCCEEDED");
	assert.deepEqual(observed.result.data, {
		setupStatus: "FAILED",
		runtimeStatus: "STOPPED",
	});
	assert.equal("preflight" in behaviorAdapter, false);
});

test("missing shared facts fail Module.setup/start without asking a human to copy machine-owned config", async (context) => {
	const workspaceRoot = await workspace(context);
	const setup = await behaviorAdapter.setup({ workspaceRoot });
	assert.equal(setup.result.status, "FAILED");
	assert.equal(setup.result.error?.code, "SETUP_FAILED");
	assert.equal("actionRequired" in setup.result, false);

	const start = await behaviorAdapter.start({ workspaceRoot });
	assert.equal(start.result.status, "FAILED");
	assert.equal(start.result.error?.code, "START_FAILED");
});

test("execution-runtime exposes exactly the fixed seven management commands", () => {
	assert.deepEqual(Object.keys(behaviorAdapter).sort(), [
		"docs",
		"install",
		"setup",
		"start",
		"status",
		"stop",
		"uninstall",
	]);
});
