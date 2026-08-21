import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { runCli } from "../src/cli.ts";

const parseCli = <T>(value: T): T => value;

import { tempWorkspace, writeWorkspaceModule } from "./test-helpers.ts";

test("platform docs forwards Module.docs result instead of reading package prose itself", async () => {
	const root = await tempWorkspace();
	try {
		await writeWorkspaceModule(root, {
			moduleRef: "docs-fixture",
			docsData: { docs: "MODULE_OWNED_DOCS" },
		});
		await writeFile(
			join(root, "packages", "docs-fixture", "DOCS.md"),
			"PLATFORM_MUST_NOT_READ_THIS\n",
		);
		const output = parseCli(await runCli(["docs"], { cwd: root })) as {
			status: string;
			data: { modules: Array<Record<string, unknown>> };
		};
		assert.equal(output.status, "SUCCEEDED");
		assert.deepEqual(output.data.modules, [
			{
				moduleRef: "docs-fixture",
				version: "1.0.0",
				docs: "MODULE_OWNED_DOCS",
			},
		]);
		assert.equal(
			JSON.stringify(output).includes("PLATFORM_MUST_NOT_READ_THIS"),
			false,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
