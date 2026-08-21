import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { renderHumanResult, runCli } from "../src/cli.ts";

const parseCli = <T>(value: T): T => value;

import { tempWorkspace, writeWorkspaceModule } from "./test-helpers.ts";

test("platform status aggregates only Module-owned setup/runtime status", async () => {
	const root = await tempWorkspace();
	try {
		await writeWorkspaceModule(root, {
			moduleRef: "fixture-module",
			statusData: { setupStatus: "ACTION_REQUIRED", runtimeStatus: "STOPPED" },
		});
		const output = parseCli(await runCli(["status"], { cwd: root })) as {
			status: string;
			data: { modules: unknown[] };
		};
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
		const output = parseCli(await runCli(["status"], { cwd: root })) as {
			status: string;
		};
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
			const old = parseCli(await runCli([removed], { cwd: root })) as {
				status: string;
				error?: { code: string };
			};
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
	assert.match(rendered, /ProFlow 配置/);
	assert.match(rendered, /chatgpt-carrier/);
	assert.match(rendered, /\[TODO 1\/1\]/);
	assert.match(rendered, /proflow-chatgpt-carrier setup/);
	assert.match(rendered, /AI 执行/);
	assert.match(rendered, /model-runtime/);
	assert.match(rendered, /\[BLOCKED 1\/1\]/);
	assert.match(rendered, /SETUP_FAILED/);
	assert.match(rendered, /producer shared facts are unavailable/);
	assert.notEqual(rendered, "SETUP FAILED");
});
