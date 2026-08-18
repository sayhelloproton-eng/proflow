import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createProductionBinding } from "../deployment/adapter.ts";

test("execution-local production binding observes real project/artifact filesystem reality", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-execution-local-deploy-"));
	try {
		const projectRoot = join(root, "project");
		await mkdir(projectRoot);
		const binding = createProductionBinding({
			config: {
				projectRoot,
				artifactRoot: join(root, "artifacts", "execution"),
			},
		});
		const preflight = await (
			binding.behaviorAdapter.preflight as () => Promise<{
				result: { status: string };
			}>
		)();
		const verify = await (
			binding.behaviorAdapter.verify as () => Promise<{
				result: { status: string; checks?: Array<{ status: string }> };
			}>
		)();
		assert.equal(preflight.result.status, "SUCCEEDED");
		assert.equal(verify.result.status, "SUCCEEDED");
		assert.equal(verify.result.checks?.[0]?.status, "PASS");

		const missing = createProductionBinding({
			config: {
				projectRoot: join(root, "missing"),
				artifactRoot: join(root, "artifacts"),
			},
		});
		const missingPreflight = await (
			missing.behaviorAdapter.preflight as () => Promise<{
				result: { status: string };
			}>
		)();
		assert.equal(missingPreflight.result.status, "ACTION_REQUIRED");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
