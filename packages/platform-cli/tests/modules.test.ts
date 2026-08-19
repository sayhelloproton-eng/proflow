import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

test("production bindings keep raw secrets owner-scoped while sharing public config", async () => {
	const root = await tempWorkspace();
	try {
		const status = (moduleRef: string) =>
			`{ contract: "deployment.result.v1", ok: true, status: "SUCCEEDED", moduleRef: ${JSON.stringify(moduleRef)}, moduleVersion: "1.0.0", data: { configStatus: "READY", runtimeStatus: "UNKNOWN" } }`;
		await writeWorkspaceModule(root, {
			moduleRef: "secret-owner",
			adapterSource: `export function createProductionBinding(input) {
	if (input.config.publicValue !== "visible" || input.config.rawSecret !== "owner-only") throw new Error("OWNER_CONFIG_SCOPE_BROKEN");
	return { behaviorAdapter: { status: async () => ({ result: ${status("secret-owner")}, observedEffects: [] }) } };
}
export const behaviorAdapter = {};
`,
		});
		await writeWorkspaceModule(root, {
			moduleRef: "config-consumer",
			adapterSource: `export function createProductionBinding(input) {
	const peer = input.configByModuleRef.get("secret-owner");
	if (peer?.publicValue !== "visible" || "rawSecret" in (peer ?? {})) throw new Error("CROSS_MODULE_SECRET_EXPOSED");
	return { behaviorAdapter: { status: async () => ({ result: ${status("config-consumer")}, observedEffects: [] }) } };
}
export const behaviorAdapter = {};
`,
		});
		const configRoot = join(root, ".proflow", "config");
		await mkdir(configRoot, { recursive: true });
		await writeFile(
			join(configRoot, "secret-owner.json"),
			JSON.stringify({ publicValue: "visible" }),
		);
		await writeFile(
			join(configRoot, "secret-owner.secrets.json"),
			JSON.stringify({ rawSecret: "owner-only" }),
		);
		const output = JSON.parse(
			await runCli(["modules", "--json"], { cwd: root }),
		) as {
			status: string;
			data?: { modules: Array<{ moduleRef: string }> };
		};
		assert.equal(output.status, "SUCCEEDED");
		assert.deepEqual(
			output.data?.modules.map((module) => module.moduleRef),
			["config-consumer", "secret-owner"],
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
