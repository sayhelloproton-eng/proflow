import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { renderHumanResult, runCli } from "../src/cli.ts";

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
		const output = parseCli(
			await runCli(["docs", "--module", "docs-fixture"], { cwd: root }),
		) as {
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

test("platform docs defaults to an index instead of dumping every Module document", async () => {
	const root = await tempWorkspace();
	try {
		await writeWorkspaceModule(root, {
			moduleRef: "docs-index",
			docsData: { docs: "INTERNAL_FULL_DOCUMENT" },
		});
		const output = parseCli(await runCli(["docs"], { cwd: root })) as {
			status: string;
			data: { indexOnly: boolean; modules: Array<Record<string, unknown>> };
		};
		assert.equal(output.status, "SUCCEEDED");
		assert.equal(output.data.indexOnly, true);
		assert.equal(
			JSON.stringify(output).includes("INTERNAL_FULL_DOCUMENT"),
			false,
		);
		const rendered = renderHumanResult(output as never);
		assert.match(rendered, /platform install/);
		assert.match(rendered, /platform setup/);
		assert.match(rendered, /platform start/);
		assert.match(rendered, /可用模块文档（1）/);
		assert.match(rendered, /platform docs --module docs-index/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("platform docs supports a single Module filter", async () => {
	const root = await tempWorkspace();
	try {
		await writeWorkspaceModule(root, {
			moduleRef: "docs-first",
			docsData: { docs: "FIRST_DOCS" },
		});
		await writeWorkspaceModule(root, {
			moduleRef: "docs-second",
			docsData: { docs: "SECOND_DOCS" },
		});
		const output = parseCli(
			await runCli(["docs", "--module", "docs-second"], { cwd: root }),
		) as { status: string; data: { modules: Array<Record<string, unknown>> } };
		assert.equal(output.status, "SUCCEEDED");
		assert.deepEqual(
			output.data.modules.map((item) => item.moduleRef),
			["docs-second"],
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("core onboarding docs expose only Platform lifecycle commands", async () => {
	for (const path of [
		"../../execution-browser-extension/DOCS.md",
		"../../execution-browser-extension/SETUP.md",
		"../../dev-tunnel/DOCS.md",
		"../../dev-tunnel/SETUP.md",
		"../../model-provider-api/DOCS.md",
		"../../model-provider-api/SETUP.md",
		"../../model-runtime/DOCS.md",
		"../../model-runtime/SETUP.md",
	]) {
		const content = await readFile(new URL(path, import.meta.url), "utf8");
		assert.doesNotMatch(content, /pnpm exec|platform setup --module/);
	}
});
