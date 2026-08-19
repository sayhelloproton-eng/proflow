import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	cleanupWorkspacePackageManagerArtifacts,
	createWorkspacePackageManagerDriver,
} from "../src/apply/driver.ts";
import type { ResolvedModule } from "../src/contracts.ts";
import { PlatformError } from "../src/errors.ts";
import { preflightInstallerEnvironment } from "../src/install/environment.ts";
import { readWorkspacePackageManagerSelection } from "../src/install/package-manager.ts";

async function workspace() {
	const root = await mkdtemp(join(tmpdir(), "proflow-package-manager-"));
	return {
		root,
		async manifest(value: Record<string, unknown>) {
			await writeFile(
				join(root, "package.json"),
				`${JSON.stringify(value, null, 2)}\n`,
			);
		},
		async lockfile(name: string) {
			await writeFile(join(root, name), "# fixture\n");
		},
		async cleanup() {
			await rm(root, { recursive: true, force: true });
		},
	};
}

function moduleFixture(): ResolvedModule {
	return {
		moduleRef: "fixture",
		packageName: "@tomflow/proflow-fixture",
		moduleVersion: "1.2.3",
		kind: "library",
		installClass: "optional",
		identity: { domain: "deployment-governance", summary: "fixture" },
		documentation: [],
		provides: [],
		requires: [],
		requirements: [],
		configSlots: [],
		lifecycle: ["describe", "verify", "doctor"],
		verification: { checks: [] },
		effects: [],
		source: { type: "registry" },
	};
}

test("CP-DPL-CLI-11 packageManager declaration supports npm, yarn, and pnpm", async () => {
	for (const [declared, expected] of [
		["npm@10.8.2", "npm"],
		["yarn@4.9.2", "yarn"],
		["pnpm@11.21.0", "pnpm"],
	] as const) {
		const w = await workspace();
		try {
			await w.manifest({ private: true, packageManager: declared });
			const selection = await readWorkspacePackageManagerSelection(w.root);
			assert.equal(selection.name, expected);
			assert.equal(selection.source, "declared");
		} finally {
			await w.cleanup();
		}
	}
});

test("CP-DPL-CLI-11 a single lockfile selects yarn/pnpm/npm when packageManager is absent", async () => {
	for (const [lockfile, expected] of [
		["yarn.lock", "yarn"],
		["pnpm-lock.yaml", "pnpm"],
		["package-lock.json", "npm"],
	] as const) {
		const w = await workspace();
		try {
			await w.manifest({ private: true });
			await w.lockfile(lockfile);
			const selection = await readWorkspacePackageManagerSelection(w.root);
			assert.equal(selection.name, expected);
			assert.equal(selection.source, "lockfile");
		} finally {
			await w.cleanup();
		}
	}
});

test("CP-DPL-CLI-11 + RF-DPL-CLI-12 conflicting declaration/lockfile and multiple lockfiles fail closed", async () => {
	const w = await workspace();
	try {
		await w.manifest({ private: true, packageManager: "npm@10.8.2" });
		await w.lockfile("yarn.lock");
		await assert.rejects(
			readWorkspacePackageManagerSelection(w.root),
			(error: unknown) =>
				error instanceof PlatformError &&
				error.code === "PACKAGE_MANAGER_CONFLICT",
		);
	} finally {
		await w.cleanup();
	}
});

test("CP-DPL-CLI-11 Fresh Workspace with no declaration or lockfile deterministically defaults to npm", async () => {
	const w = await workspace();
	try {
		const selection = await readWorkspacePackageManagerSelection(w.root);
		assert.deepEqual(selection, { name: "npm", source: "bootstrap-default" });
	} finally {
		await w.cleanup();
	}
});

test("CP-DPL-CLI-11 Yarn Classic and modern Yarn receive script-safe exact mutation argv", async () => {
	for (const [declared, expectedAdd, expectedRemove] of [
		[
			"yarn@1.22.22",
			["add", "--exact", "--ignore-scripts", "@tomflow/proflow-fixture@1.2.3"],
			["remove", "--ignore-scripts", "@tomflow/proflow-fixture"],
		],
		[
			"yarn@4.9.2",
			["add", "--exact", "--mode=skip-build", "@tomflow/proflow-fixture@1.2.3"],
			["remove", "--mode=skip-build", "@tomflow/proflow-fixture"],
		],
	] as const) {
		const w = await workspace();
		const calls: Array<{ command: string; args: readonly string[] }> = [];
		try {
			await w.manifest({ private: true, packageManager: declared });
			const driver = createWorkspacePackageManagerDriver({
				workspaceRoot: w.root,
				executableAvailable: () => true,
				runner: {
					async run(command, args) {
						calls.push({ command, args: [...args] });
						return command === "yarn" && args[0] === "--version"
							? declared.slice("yarn@".length)
							: "";
					},
				},
			});
			await driver.install(moduleFixture());
			await driver.remove(moduleFixture());
			assert.deepEqual(calls[0], { command: "yarn", args: expectedAdd });
			assert.deepEqual(calls[1], { command: "yarn", args: expectedRemove });
		} finally {
			await w.cleanup();
		}
	}
});

test("CP-DPL-CLI-11 npm and pnpm receive exact script-safe install/remove argv", async () => {
	for (const [declared, command, expectedAdd, expectedRemove] of [
		[
			"npm@10.8.2",
			"npm",
			[
				"install",
				"--save-exact",
				"--ignore-scripts",
				"@tomflow/proflow-fixture@1.2.3",
			],
			["uninstall", "--ignore-scripts", "@tomflow/proflow-fixture"],
		],
		[
			"pnpm@11.21.0",
			"pnpm",
			[
				"add",
				"--save-exact",
				"--ignore-scripts",
				"@tomflow/proflow-fixture@1.2.3",
			],
			["--config.ignore-scripts=true", "remove", "@tomflow/proflow-fixture"],
		],
	] as const) {
		const w = await workspace();
		const calls: Array<{ command: string; args: readonly string[] }> = [];
		try {
			await w.manifest({ private: true, packageManager: declared });
			const driver = createWorkspacePackageManagerDriver({
				workspaceRoot: w.root,
				executableAvailable: () => true,
				runner: {
					async run(actualCommand, args) {
						calls.push({ command: actualCommand, args: [...args] });
						return "";
					},
				},
			});
			await driver.install(moduleFixture());
			await driver.remove(moduleFixture());
			assert.deepEqual(calls[0], { command, args: expectedAdd });
			assert.deepEqual(calls[1], { command, args: expectedRemove });
		} finally {
			await w.cleanup();
		}
	}
});

test("CP-DPL-CLI-11 whole uninstall cleanup removes only ProFlow pnpm workspace artifacts", async () => {
	const w = await workspace();
	try {
		await w.manifest({ private: true, packageManager: "pnpm@11.21.0" });
		await writeFile(
			join(w.root, "pnpm-workspace.yaml"),
			"packages: []\nminimumReleaseAgeExclude:\n  - '@tomflow/proflow-fixture@1.2.3'\n  - 'user-package@9.9.9'\nonlyBuiltDependencies:\n  - user-native\n",
		);
		await writeFile(
			join(w.root, "pnpm-lock.yaml"),
			"lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n",
		);

		await cleanupWorkspacePackageManagerArtifacts({
			workspaceRoot: w.root,
			removedModules: [moduleFixture()],
		});

		assert.equal(
			await readFile(join(w.root, "pnpm-workspace.yaml"), "utf8"),
			"packages: []\nminimumReleaseAgeExclude:\n  - 'user-package@9.9.9'\nonlyBuiltDependencies:\n  - user-native\n",
		);
		assert.equal(
			await readFile(join(w.root, "pnpm-lock.yaml"), "utf8"),
			"lockfileVersion: '9.0'\n\nimporters:\n  .: {}\n",
		);

		await writeFile(
			join(w.root, "pnpm-workspace.yaml"),
			"packages: []\nminimumReleaseAgeExclude:\n  - '@tomflow/proflow-fixture@1.2.3'\nonlyBuiltDependencies:\n  - user-native\n",
		);
		await cleanupWorkspacePackageManagerArtifacts({
			workspaceRoot: w.root,
			removedModules: [moduleFixture()],
		});
		assert.equal(
			await readFile(join(w.root, "pnpm-workspace.yaml"), "utf8"),
			"packages: []\nonlyBuiltDependencies:\n  - user-native\n",
		);
	} finally {
		await w.cleanup();
	}
});

test("CP-DPL-CLI-11 a declared Workspace package manager that is unavailable fails closed", async () => {
	const w = await workspace();
	try {
		await w.manifest({ private: true, packageManager: "yarn@4.9.2" });
		const driver = createWorkspacePackageManagerDriver({
			workspaceRoot: w.root,
			executableAvailable: () => false,
			runner: {
				async run() {
					return "";
				},
			},
		});
		await assert.rejects(
			driver.install(moduleFixture()),
			(error: unknown) =>
				error instanceof PlatformError &&
				error.code === "PACKAGE_MANAGER_UNAVAILABLE",
		);
	} finally {
		await w.cleanup();
	}
});

test("installer preflight bounds the registry ping with a timeout instead of hanging", async () => {
	const w = await workspace();
	try {
		await w.manifest({ private: true });
		const calls: Array<{ args: readonly string[]; timeoutMs?: number }> = [];
		const result = await preflightInstallerEnvironment({
			workspaceRoot: w.root,
			runner: {
				async run(args, _cwd, timeoutMs) {
					calls.push({
						args: [...args],
						...(timeoutMs === undefined ? {} : { timeoutMs }),
					});
					if (args[0] === "--version") {
						return { stdout: "11.17.0\n", stderr: "" };
					}
					if (args[0] === "config") {
						return { stdout: "https://registry.npmjs.org/\n", stderr: "" };
					}
					return { stdout: "{}", stderr: "" };
				},
			},
		});
		const ping = calls.find((call) => call.args[0] === "ping");
		assert.ok(ping, "expected a registry ping call");
		assert.equal(ping.timeoutMs, 10_000);
		assert.equal(
			result.findings.some((finding) => finding.code === "REGISTRY_READY"),
			true,
		);
	} finally {
		await w.cleanup();
	}
});
