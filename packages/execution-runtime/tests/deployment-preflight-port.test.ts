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

test("FJ-07 installed deterministic config is READY while runtime producers remain unavailable", async (context) => {
	const workspaceRoot = await workspace(context);
	await behaviorAdapter.install({ workspaceRoot });
	const observed = await behaviorAdapter.status({ workspaceRoot });
	assert.equal(observed.result.status, "SUCCEEDED");
	assert.deepEqual(observed.result.data, {
		setupStatus: "READY",
		runtimeStatus: "STOPPED",
		issues: [
			{
				scope: "RUNTIME",
				code: "UPSTREAM_NOT_READY",
				message:
					"等待 platform-host、model-runtime 与 execution-browser-extension 发布运行所需信息",
				relatedModuleRefs: [
					"platform-host",
					"model-runtime",
					"execution-browser-extension",
				],
				nextCommand: "platform setup",
			},
		],
	});
	assert.equal("preflight" in behaviorAdapter, false);
});

test("setup materializes machine-owned config while start still fails closed on missing runtime facts", async (context) => {
	const workspaceRoot = await workspace(context);
	const setup = await behaviorAdapter.setup({ workspaceRoot });
	assert.equal(setup.result.status, "SUCCEEDED");
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
