import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { renderHumanResult, runCli } from "../src/cli.ts";
import { tempWorkspace, writeWorkspaceModule } from "./test-helpers.ts";

test("platform status aggregates only Module-owned setup/runtime status", async () => {
	const root = await tempWorkspace();
	try {
		await writeWorkspaceModule(root, {
			moduleRef: "fixture-module",
			statusData: { setupStatus: "ACTION_REQUIRED", runtimeStatus: "STOPPED" },
		});
		const output = JSON.parse(
			await runCli(["status", "--json"], { cwd: root }),
		) as { status: string; data: { modules: unknown[] } };
		assert.equal(output.status, "SUCCEEDED");
		assert.deepEqual(output.data.modules, [
			{
				moduleRef: "fixture-module",
				version: "1.0.0",
				setupStatus: "ACTION_REQUIRED",
				runtimeStatus: "STOPPED",
			},
		]);
		const serialized = JSON.stringify(output.data.modules[0]);
		assert.equal(serialized.includes("configStatus"), false);
		assert.equal(serialized.includes("missingConfig"), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("platform status ignores obsolete config and all removed routes remain invalid", async () => {
	const root = await tempWorkspace();
	try {
		await writeWorkspaceModule(root, { moduleRef: "fixture-module" });
		const configRoot = join(root, ".proflow", "config");
		await mkdir(configRoot, { recursive: true });
		await writeFile(join(configRoot, "fixture-module.json"), "{not-json");
		const output = JSON.parse(
			await runCli(["status", "--json"], { cwd: root }),
		) as { status: string };
		assert.equal(output.status, "SUCCEEDED");
		for (const removed of [
			"modules",
			"preflight",
			"verify",
			"doctor",
			"restart",
			"plan",
			"apply",
			"upgrade",
			"manifest",
		]) {
			const old = JSON.parse(
				await runCli([removed, "--json"], { cwd: root }),
			) as { status: string; error?: { code: string } };
			assert.equal(old.status, "FAILED", removed);
			assert.equal(old.error?.code, "INVALID_REQUEST", removed);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("platform setup human output preserves all actions when the aggregate also contains machine failures", () => {
	const rendered = renderHumanResult({
		command: "setup",
		status: "FAILED",
		data: {
			phase: "setup",
			completed: false,
			results: [
				{
					moduleRef: "chatgpt-carrier",
					result: {
						status: "ACTION_REQUIRED",
						actionRequired: {
							action: "materialize-custom-gpt-carrier",
							description: "Run the package-owned carrier setup command.",
						},
					},
				},
				{
					moduleRef: "model-runtime",
					result: {
						status: "FAILED",
						error: {
							code: "SETUP_FAILED",
							message: "producer shared facts are unavailable",
						},
					},
				},
			],
		},
	});
	assert.match(rendered, /ProFlow Setup/);
	assert.match(rendered, /chatgpt-carrier — ACTION_REQUIRED/);
	assert.match(rendered, /materialize-custom-gpt-carrier/);
	assert.match(rendered, /Run the package-owned carrier setup command/);
	assert.match(rendered, /model-runtime — FAILED/);
	assert.match(rendered, /SETUP_FAILED/);
	assert.match(rendered, /producer shared facts are unavailable/);
	assert.notEqual(rendered, "SETUP FAILED");
});
