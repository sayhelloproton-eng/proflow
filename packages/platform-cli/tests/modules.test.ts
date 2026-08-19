import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { test } from "node:test";

import { runCli } from "../src/cli.ts";
import { tempWorkspace, writeWorkspaceModule } from "./test-helpers.ts";

test("platform modules reports only Module-owned status facts", async () => {
	const root = await tempWorkspace();
	try {
		await writeWorkspaceModule(root, {
			moduleRef: "fixture-module",
			configSlots: [
				{
					key: "apiUrl",
					type: "url",
					required: true,
					description: "Fixture API URL",
				},
			],
			statusData: {
				configStatus: "INCOMPLETE",
				missingConfig: ["apiUrl"],
				runtimeStatus: "STOPPED",
			},
		});
		const output = JSON.parse(
			await runCli(["modules", "--json"], { cwd: root }),
		) as {
			status: string;
			data: { modules: Array<Record<string, unknown>> };
		};
		assert.equal(output.status, "SUCCEEDED");
		assert.deepEqual(output.data.modules, [
			{
				moduleRef: "fixture-module",
				version: "1.0.0",
				configStatus: "INCOMPLETE",
				missingConfig: ["apiUrl"],
				runtimeStatus: "STOPPED",
			},
		]);
		const serialized = JSON.stringify(output.data.modules[0]);
		for (const forbidden of [
			"planRef",
			"manifestRef",
			"verificationRef",
			"installClass",
			"installRequires",
		]) {
			assert.equal(serialized.includes(forbidden), false);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
