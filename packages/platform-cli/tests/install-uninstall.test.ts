import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { runCli } from "../src/cli.ts";
import { tempWorkspace, writeInstalledModule } from "./test-helpers.ts";

const PACKAGES = [
	{
		moduleRef: "fixture-a",
		packageName: "@tomflow/proflow-fixture-a",
		version: "1.2.3",
	},
	{
		moduleRef: "fixture-b",
		packageName: "@tomflow/proflow-fixture-b",
		version: "2.3.4",
	},
] as const;

function registryRunner() {
	return {
		async run(args: readonly string[]) {
			if (args[0] === "config") {
				return { stdout: "https://registry.example.test\n", stderr: "" };
			}
			if (args[0] === "search") {
				return {
					stdout: JSON.stringify(
						PACKAGES.map((item) => ({ name: item.packageName })),
					),
					stderr: "",
				};
			}
			if (args[0] === "view") {
				const item = PACKAGES.find(
					(candidate) => candidate.packageName === args[1],
				);
				assert.ok(item);
				return {
					stdout: JSON.stringify({
						name: item.packageName,
						version: item.version,
						proflow: {
							module: true,
							descriptor: "./deployment/descriptor.js",
							manifest: "./proflow.module.json",
						},
					}),
					stderr: "",
				};
			}
			throw new Error(`unexpected registry args: ${args.join(" ")}`);
		},
	};
}

async function readManifest(root: string): Promise<Record<string, unknown>> {
	return JSON.parse(
		await readFile(join(root, "package.json"), "utf8"),
	) as Record<string, unknown>;
}

function packageRunner(root: string, calls: string[][]) {
	return {
		async run(command: string, args: readonly string[]) {
			calls.push([command, ...args]);
			if (args.includes("install")) {
				const manifest = await readManifest(root);
				const dependencies = Object.fromEntries(
					PACKAGES.map((item) => [item.packageName, item.version]),
				);
				await writeFile(
					join(root, "package.json"),
					JSON.stringify({ ...manifest, dependencies }),
				);
				for (const item of PACKAGES) {
					await writeInstalledModule(root, {
						moduleRef: item.moduleRef,
						packageName: item.packageName,
						version: item.version,
					});
				}
				return "";
			}
			if (args.includes("uninstall")) {
				const manifest = await readManifest(root);
				await writeFile(
					join(root, "package.json"),
					JSON.stringify({ ...manifest, dependencies: {} }),
				);
				return "";
			}
			throw new Error(
				`unexpected package-manager call: ${command} ${args.join(" ")}`,
			);
		},
	};
}

test("install synchronizes the complete Registry package set in one transaction", async () => {
	const root = await tempWorkspace();
	const calls: string[][] = [];
	try {
		const output = JSON.parse(
			await runCli(["install", "--workspace", root, "--json"], {
				cwd: root,
				registryRunner: registryRunner(),
				packageRunner: packageRunner(root, calls),
				executableAvailable: () => true,
			}),
		) as { status: string; data: Record<string, unknown> };
		assert.equal(output.status, "SUCCEEDED");
		assert.equal(output.data.next, "platform modules");
		assert.equal(
			calls.length,
			1,
			"complete package set must use one package-manager transaction",
		);
		for (const item of PACKAGES) {
			assert.ok(calls[0]?.includes(`${item.packageName}@${item.version}`));
		}
		const manifest = await readManifest(root);
		assert.deepEqual(manifest.dependencies, {
			"@tomflow/proflow-fixture-a": "1.2.3",
			"@tomflow/proflow-fixture-b": "2.3.4",
		});
		const metadata = JSON.parse(
			await readFile(join(root, ".proflow", "workspace.json"), "utf8"),
		) as Record<string, unknown>;
		assert.equal(metadata.contract, "proflow.workspace.v1");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("uninstall removes ProFlow dependencies and preserves .proflow", async () => {
	const root = await tempWorkspace();
	const calls: string[][] = [];
	try {
		await runCli(["install", "--json"], {
			cwd: root,
			registryRunner: registryRunner(),
			packageRunner: packageRunner(root, calls),
			executableAvailable: () => true,
		});
		calls.length = 0;
		const output = JSON.parse(
			await runCli(["uninstall", "--json"], {
				cwd: root,
				packageRunner: packageRunner(root, calls),
				executableAvailable: () => true,
			}),
		) as { status: string; data: Record<string, unknown> };
		assert.equal(output.status, "SUCCEEDED");
		assert.equal(calls.length, 1);
		assert.ok(calls[0]?.includes("uninstall"));
		assert.deepEqual((await readManifest(root)).dependencies, {});
		const metadata = await readFile(
			join(root, ".proflow", "workspace.json"),
			"utf8",
		);
		assert.match(metadata, /proflow\.workspace\.v1/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("only install accepts --workspace and all commands reject positional module arguments", async () => {
	const root = await tempWorkspace();
	try {
		const wrongWorkspace = JSON.parse(
			await runCli(["modules", "--workspace", root, "--json"], { cwd: root }),
		) as { status: string; error?: { code: string } };
		assert.equal(wrongWorkspace.status, "FAILED");
		assert.equal(wrongWorkspace.error?.code, "INVALID_REQUEST");

		const positional = JSON.parse(
			await runCli(["install", "fixture-module", "--json"], { cwd: root }),
		) as { status: string; error?: { code: string } };
		assert.equal(positional.status, "FAILED");
		assert.equal(positional.error?.code, "INVALID_REQUEST");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
