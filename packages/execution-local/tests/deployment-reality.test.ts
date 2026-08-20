import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { behaviorAdapter } from "../deployment/adapter.ts";

test("execution-local Module.install materializes deterministic workspace/artifact reality", async () => {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-execution-local-deploy-"),
	);
	const context = { workspaceRoot };
	try {
		const before = await behaviorAdapter.status(context);
		assert.equal(before.result.data.setupStatus, "FAILED");
		const installed = await behaviorAdapter.install(context);
		assert.equal(installed.result.status, "SUCCEEDED");
		const roots = installed.result.data;
		assert.equal(roots.projectRoot, workspaceRoot);
		assert.match(roots.artifactRoot, /\.proflow.*artifacts.*execution/);
		const after = await behaviorAdapter.status(context);
		assert.deepEqual(after.result.data, {
			setupStatus: "READY",
			runtimeStatus: "NOT_APPLICABLE",
		});
	} finally {
		await rm(workspaceRoot, { recursive: true, force: true });
	}
});
