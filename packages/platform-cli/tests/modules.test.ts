import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { runCli } from "../src/cli.ts";
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

test("platform status ignores obsolete Platform-side config files", async () => {
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
		const old = JSON.parse(
			await runCli(["modules", "--json"], { cwd: root }),
		) as { status: string; error?: { code: string } };
		assert.equal(old.status, "FAILED");
		assert.equal(old.error?.code, "INVALID_REQUEST");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
