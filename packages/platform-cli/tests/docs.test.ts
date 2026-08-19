import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { test } from "node:test";

import { runCli } from "../src/cli.ts";
import { tempWorkspace, writeWorkspaceModule } from "./test-helpers.ts";

test("platform docs aggregates Module-owned contracts and documents", async () => {
	const root = await tempWorkspace();
	try {
		await writeWorkspaceModule(root, {
			moduleRef: "docs-fixture",
			provides: [{ contractRef: "fixture.api", version: "1.0.0" }],
			requires: [{ contractRef: "fixture.base", versionRange: ">=1.0.0" }],
			configSlots: [
				{
					key: "endpoint",
					type: "url",
					required: true,
					description: "Fixture endpoint",
				},
			],
			documents: [
				{ id: "overview", path: "README.md", content: "# Docs fixture\n" },
				{
					id: "configuration",
					path: "CONFIGURATION.md",
					content: "# Configuration\nSet endpoint before start.\n",
				},
			],
		});
		const output = JSON.parse(
			await runCli(["docs", "--json"], { cwd: root }),
		) as {
			status: string;
			data: { modules: Array<Record<string, unknown>> };
		};
		assert.equal(output.status, "SUCCEEDED");
		assert.equal(output.data.modules.length, 1);
		const module = output.data.modules[0];
		assert.equal(module?.moduleRef, "docs-fixture");
		assert.deepEqual(module?.provides, [
			{ contractRef: "fixture.api", version: "1.0.0" },
		]);
		assert.deepEqual(module?.requires, [
			{ contractRef: "fixture.base", versionRange: ">=1.0.0" },
		]);
		const documents = module?.documents as Array<Record<string, unknown>>;
		assert.deepEqual(
			documents.map((document) => document.id),
			["overview", "configuration"],
		);
		assert.match(String(documents[1]?.content), /Set endpoint before start/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
