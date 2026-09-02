import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { runCli } from "../src/cli.ts";
import { tempWorkspace, writeInstalledModule } from "./test-helpers.ts";

const target = {
	moduleRef: "fixture-a",
	packageName: "@tomflow/proflow-fixture-a",
	fromVersion: "1.0.0",
	toVersion: "1.2.3",
};
const sibling = {
	moduleRef: "fixture-b",
	packageName: "@tomflow/proflow-fixture-b",
	version: "2.3.4",
};

async function manifest(root: string) {
	return JSON.parse(await readFile(join(root, "package.json"), "utf8"));
}
test("CP-DEP-CLI-UPDATE-01 platform update changes exactly one installed ProFlow package", async () => {
	const root = await tempWorkspace();
	const packageCalls: string[][] = [];
	let registrySearches = 0;
	try {
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				private: true,
				dependencies: {
					[target.packageName]: target.fromVersion,
					[sibling.packageName]: sibling.version,
				},
			}),
		);
		await writeInstalledModule(root, {
			moduleRef: target.moduleRef,
			packageName: target.packageName,
			version: target.fromVersion,
		});
		await writeInstalledModule(root, sibling);
		const result = await runCli(
			["update", "--package", target.packageName, "--workspace", root],
			{
				cwd: root,
				executableAvailable: () => true,
				registryRunner: {
					async run(args) {
						if (args[0] === "config")
							return { stdout: "https://registry.example.test\n", stderr: "" };
						if (args[0] === "search") {
							registrySearches += 1;
							throw new Error("targeted update must not search the scope");
						}
						if (args[0] === "view" && args[1] === target.packageName)
							return {
								stdout: JSON.stringify({
									name: target.packageName,
									version: target.toVersion,
									proflow: {
										module: true,
										descriptor: "./deployment/descriptor.js",
										manifest: "./proflow.module.json",
									},
								}),
								stderr: "",
							};
						throw new Error(`unexpected registry args: ${args.join(" ")}`);
					},
				},
				packageRunner: {
					async run(command, args) {
						packageCalls.push([command, ...args]);
						assert.ok(args.includes(`${target.packageName}@${target.toVersion}`));
						assert.equal(args.some((arg) => arg.includes(sibling.packageName)), false);
						const current = await manifest(root);
						await writeFile(
							join(root, "package.json"),
							JSON.stringify({
								...current,
								dependencies: {
									...current.dependencies,
									[target.packageName]: target.toVersion,
								},
							}),
						);
						await rm(join(root, "node_modules", ...target.packageName.split("/")), {
							recursive: true,
							force: true,
						});
						await writeInstalledModule(root, {
							moduleRef: target.moduleRef,
							packageName: target.packageName,
							version: target.toVersion,
						});
						return "";
					},
				},
			},
		);
		assert.equal(result.status, "SUCCEEDED");
		assert.equal(registrySearches, 0);
		assert.equal(packageCalls.length, 1);
		const next = await manifest(root);
		assert.equal(next.dependencies[target.packageName], target.toVersion);
		assert.equal(next.dependencies[sibling.packageName], sibling.version);
		assert.equal(
			JSON.stringify(result.data).includes('"changed":true'),
			true,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("CP-DEP-CLI-UPDATE-02 platform update requires one installed package target", async () => {
	const root = await tempWorkspace();
	try {
		const missing = await runCli(["update", "--workspace", root], { cwd: root });
		assert.equal(missing.status, "FAILED");
		assert.equal(missing.error?.code, "INVALID_REQUEST");
		const absent = await runCli(
			["update", "--package", target.packageName, "--workspace", root],
			{ cwd: root },
		);
		assert.equal(absent.status, "FAILED");
		assert.equal(absent.error?.code, "PACKAGE_NOT_FOUND");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
