import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { runCli } from "../src/cli.ts";

const parseCli = <T>(value: T): T => value;

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

const STALE = {
	moduleRef: "stale-fixture",
	packageName: "@tomflow/proflow-stale-fixture",
	version: "9.9.9",
} as const;

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

function packageRunner(
	root: string,
	calls: string[][],
	adapterSource?: string,
) {
	return {
		async run(command: string, args: readonly string[]) {
			calls.push([command, ...args]);
			if (args.includes("install")) {
				const manifest = await readManifest(root);
				const dependencies = manifest.dependencies as
					| Record<string, string>
					| undefined;
				assert.ok(dependencies);
				for (const item of PACKAGES) {
					assert.equal(dependencies[item.packageName], item.version);
					await writeInstalledModule(root, {
						moduleRef: item.moduleRef,
						packageName: item.packageName,
						version: item.version,
						...(adapterSource === undefined ? {} : { adapterSource }),
					});
				}
				await rm(join(root, "node_modules", ...STALE.packageName.split("/")), {
					recursive: true,
					force: true,
				});
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

test("install rejects invalid existing Workspace metadata before external discovery or mutation", async () => {
	const root = await tempWorkspace();
	const packageCalls: string[][] = [];
	let registryCalls = 0;
	const baseRegistryRunner = registryRunner();
	const installMarker = join(root, "module-install-called");
	const adapterSource = `
import { writeFile } from "node:fs/promises";
const base = (moduleRef) => ({ contract: "deployment.result.v1", ok: true, status: "SUCCEEDED", moduleRef, moduleVersion: "1.0.0" });
export const behaviorAdapter = {
  install: async (context) => { await writeFile(${JSON.stringify(installMarker)}, context.workspaceRoot); return { result: base("fixture-a"), observedEffects: [] }; },
  uninstall: async () => ({ result: base("fixture-a"), observedEffects: [] }),
  status: async () => ({ result: { ...base("fixture-a"), data: { setupStatus: "READY", runtimeStatus: "NOT_APPLICABLE" } }, observedEffects: [] }),
  setup: async () => ({ result: base("fixture-a"), observedEffects: [] }),
  docs: async () => ({ result: base("fixture-a"), observedEffects: [] }),
  start: async () => ({ result: base("fixture-a"), observedEffects: [] }),
  stop: async () => ({ result: base("fixture-a"), observedEffects: [] }),
};
`;
	try {
		await mkdir(join(root, ".proflow"), { recursive: true });
		await writeFile(
			join(root, ".proflow", "workspace.json"),
			JSON.stringify({
				contract: "invalid.workspace.contract",
				workspaceInstanceId: "invalid-workspace-instance",
				workspaceRoot: root,
				createdAt: new Date().toISOString(),
			}),
		);
		const manifestBefore = await readFile(join(root, "package.json"), "utf8");
		const output = parseCli(
			await runCli(["install", "--workspace", root], {
				cwd: root,
				registryRunner: {
					async run(args) {
						registryCalls += 1;
						return baseRegistryRunner.run(args);
					},
				},
				packageRunner: packageRunner(root, packageCalls, adapterSource),
				executableAvailable: () => true,
			}),
		) as { status: string; error?: { code: string } };

		assert.equal(output.status, "FAILED");
		assert.equal(output.error?.code, "WORKSPACE_INSTANCE_INVALID");
		assert.equal(registryCalls, 0);
		assert.deepEqual(packageCalls, []);
		assert.equal(
			await readFile(join(root, "package.json"), "utf8"),
			manifestBefore,
		);
		await assert.rejects(readFile(installMarker, "utf8"));
		await assert.rejects(
			readFile(
				join(
					root,
					"node_modules",
					"@tomflow",
					"proflow-fixture-a",
					"package.json",
				),
				"utf8",
			),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("install synchronizes the complete Registry package set in one transaction", async () => {
	const root = await tempWorkspace();
	const calls: string[][] = [];
	const progress: Array<{ phase: string; moduleRef?: string; status: string }> =
		[];
	try {
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				private: true,
				dependencies: {
					[STALE.packageName]: STALE.version,
					"left-pad": "1.3.0",
				},
				devDependencies: { typescript: "7.0.2" },
			}),
		);
		await writeInstalledModule(root, STALE);
		const output = parseCli(
			await runCli(["install", "--workspace", root], {
				cwd: root,
				registryRunner: registryRunner(),
				packageRunner: packageRunner(root, calls),
				executableAvailable: () => true,
				onProgress: (event) => progress.push(event),
			}),
		) as { status: string; data: Record<string, unknown> };
		assert.equal(output.status, "SUCCEEDED");
		assert.equal(output.data.next, "platform status");
		assert.ok(progress.some((event) => event.phase === "workspace"));
		assert.ok(progress.some((event) => event.phase === "registry"));
		assert.ok(
			progress.some(
				(event) => event.phase === "registry" && event.status === "SUCCEEDED",
			),
		);
		assert.deepEqual(
			progress
				.filter(
					(event) => event.phase === "install" && event.status === "SUCCEEDED",
				)
				.map((event) => event.moduleRef)
				.sort(),
			["fixture-a", "fixture-b"],
		);
		assert.equal(
			calls.length,
			1,
			"complete package set must use one package-manager transaction",
		);
		assert.deepEqual(calls[0], ["npm", "install", "--ignore-scripts"]);
		const manifest = await readManifest(root);
		assert.deepEqual(manifest.dependencies, {
			"left-pad": "1.3.0",
			"@tomflow/proflow-fixture-a": "1.2.3",
			"@tomflow/proflow-fixture-b": "2.3.4",
		});
		assert.deepEqual(manifest.devDependencies, { typescript: "7.0.2" });
		await assert.rejects(
			readFile(
				join(
					root,
					"node_modules",
					...STALE.packageName.split("/"),
					"package.json",
				),
				"utf8",
			),
		);
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
		await runCli(["install"], {
			cwd: root,
			registryRunner: registryRunner(),
			packageRunner: packageRunner(root, calls),
			executableAvailable: () => true,
		});
		calls.length = 0;
		const output = parseCli(
			await runCli(["uninstall"], {
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

test("uninstall never removes packages after a Module.uninstall failure", async () => {
	const root = await tempWorkspace();
	const packageCalls: string[][] = [];
	const moduleRef = PACKAGES[0].moduleRef;
	const packageName = PACKAGES[0].packageName;
	const version = PACKAGES[0].version;
	const adapterSource = `
const success = { contract: "deployment.result.v1", ok: true, status: "SUCCEEDED", moduleRef: ${JSON.stringify(moduleRef)}, moduleVersion: ${JSON.stringify(version)} };
export const behaviorAdapter = {
  install: async () => ({ result: success, observedEffects: [] }),
  uninstall: async () => ({ result: { ...success, ok: false, status: "FAILED", error: { code: "UNINSTALL_FAILED", message: "fixture uninstall failure", retryable: true } }, observedEffects: [] }),
  status: async () => ({ result: { ...success, data: { setupStatus: "READY", runtimeStatus: "NOT_APPLICABLE" } }, observedEffects: [] }),
  setup: async () => ({ result: success, observedEffects: [] }),
  docs: async () => ({ result: success, observedEffects: [] }),
  start: async () => ({ result: success, observedEffects: [] }),
  stop: async () => ({ result: success, observedEffects: [] }),
};
`;
	try {
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				private: true,
				dependencies: { [packageName]: version },
			}),
		);
		await writeInstalledModule(root, {
			moduleRef,
			packageName,
			version,
			adapterSource,
		});
		const output = parseCli(
			await runCli(["uninstall", "--workspace", root], {
				cwd: root,
				packageRunner: {
					async run(command, args) {
						packageCalls.push([command, ...args]);
						return "";
					},
				},
				executableAvailable: () => true,
			}),
		) as { status: string; data?: { removed?: string[] } };

		assert.equal(output.status, "FAILED");
		assert.deepEqual(output.data?.removed, []);
		assert.deepEqual(packageCalls, []);
		assert.deepEqual((await readManifest(root)).dependencies, {
			[packageName]: version,
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("all operational commands accept --workspace while positional module arguments remain invalid", async () => {
	const root = await tempWorkspace();
	try {
		const explicitWorkspace = parseCli(
			await runCli(["status", "--workspace", root], { cwd: root }),
		) as { status: string; error?: { code: string } };
		assert.equal(explicitWorkspace.status, "SUCCEEDED");

		const positional = parseCli(
			await runCli(["install", "fixture-module"], { cwd: root }),
		) as { status: string; error?: { code: string } };
		assert.equal(positional.status, "FAILED");
		assert.equal(positional.error?.code, "INVALID_REQUEST");

		for (const legacyBare of ["help", "version"] as const) {
			const result = parseCli(await runCli([legacyBare], { cwd: root })) as {
				status: string;
				error?: { code: string };
			};
			assert.equal(result.status, "FAILED");
			assert.equal(result.error?.code, "INVALID_REQUEST");
		}

		for (const flag of ["--help", "--version"] as const) {
			const result = parseCli(await runCli([flag], { cwd: root })) as {
				status: string;
			};
			assert.equal(result.status, "SUCCEEDED");
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
