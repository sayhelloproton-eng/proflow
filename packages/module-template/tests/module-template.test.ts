import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
	type ModuleKind,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";
import { assessTemplateMigration, materializeModule } from "../src/index.ts";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../../..");

async function generatedToolchainRoot(prefix: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), prefix));
	await symlink(
		join(repositoryRoot, "node_modules"),
		join(root, "node_modules"),
		"dir",
	);
	return root;
}
const kinds: ModuleKind[] = [
	"library",
	"service",
	"cli",
	"browser-extension",
	"agent-package",
	"external-resource",
];

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

test("CP-DPL-TPL-01 materializes six profiles with only their real responsibilities", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-template-profiles-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	for (const kind of kinds) {
		const moduleRef = `fixture-${kind}`;
		const result = await materializeModule({
			targetDirectory: root,
			moduleRef,
			packageName: `@tomflow/proflow-${moduleRef}`,
			kind,
			domain: "deployment-governance",
			summary: "Generated test fixture",
		});
		assert.equal(parseModuleDescriptor(result.descriptor).kind, kind);
		assert.equal(
			await exists(join(result.packageDirectory, "src/lifecycle.ts")),
			false,
		);
		assert.equal(
			await exists(join(result.packageDirectory, "src/cli.ts")),
			kind === "cli" || kind === "service",
		);
		if (kind === "service") {
			const adapter = await readFile(
				join(result.packageDirectory, "deployment/adapter.ts"),
				"utf8",
			);
			assert.match(adapter, /createProductionBinding/);
			assert.doesNotMatch(adapter, /createServiceProcessBinding/);
			for (const primitive of ["status", "start", "stop"] as const) {
				assert.equal(
					result.descriptor.lifecycle.supported.includes(primitive),
					true,
				);
			}
			for (const primitive of ["restart", "uninstall"] as const) {
				assert.equal(
					result.descriptor.lifecycle.supported.includes(primitive),
					false,
				);
			}
		}
		assert.equal(
			await exists(
				join(result.packageDirectory, "deployment/browser-extension.json"),
			),
			kind === "browser-extension",
		);
		assert.equal(
			await exists(
				join(result.packageDirectory, "deployment/agent-package.md"),
			),
			kind === "agent-package",
		);
		assert.equal(
			await exists(join(result.packageDirectory, "src/resource-adapter.ts")),
			kind === "external-resource",
		);
	}
});

test("CP-DPL-TPL-02 + CP-DPL-TPL-05 + RF-DPL-TPL-05 emits minimum metadata and honest package-owned lifecycle", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-template-minimum-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	for (const kind of kinds) {
		const moduleRef = `minimum-${kind}`;
		const result = await materializeModule({
			targetDirectory: root,
			moduleRef,
			packageName: `@tomflow/proflow-${moduleRef}`,
			kind,
			domain: "deployment-governance",
			summary: "Generated test fixture",
		});
		for (const relative of [
			"package.json",
			"README.md",
			"src/index.ts",
			"tests/smoke.test.ts",
			"deployment/descriptor.ts",
			"deployment/requirements.ts",
			"deployment/verification.ts",
			"proflow.module.json",
			"conformance.json",
		]) {
			assert.equal(
				await exists(join(result.packageDirectory, relative)),
				true,
				`${kind}: ${relative}`,
			);
		}
		assert.equal(
			await exists(join(result.packageDirectory, "self-install.mjs")),
			false,
		);
		assert.equal(
			await exists(join(result.packageDirectory, "CONFIGURATION.md")),
			kind === "external-resource",
		);
		if (kind === "service") {
			const serviceCli = await readFile(
				join(result.packageDirectory, "src/cli.ts"),
				"utf8",
			);
			assert.match(serviceCli, /OWNER_IMPLEMENTATION_REQUIRED/);
			assert.doesNotMatch(
				serviceCli,
				/platform\.cmd|GLOBAL_PLATFORM_CLI_REQUIRED/,
			);
		}
		if (kind !== "service") {
			assert.equal(
				result.descriptor.lifecycle.supported.includes("start"),
				false,
			);
			assert.equal(
				result.descriptor.lifecycle.supported.includes("stop"),
				false,
			);
		}
	}
});

test("CP-DPL-TPL-03 generated TypeScript packages pass strict tsc with typed public boundaries", async (context) => {
	const root = await generatedToolchainRoot("proflow-template-typecheck-");
	context.after(() => rm(root, { recursive: true, force: true }));
	const tsc = join(
		import.meta.dirname,
		"../../../node_modules/typescript/bin/tsc",
	);
	for (const kind of kinds) {
		const moduleRef = `typed-${kind}`;
		const result = await materializeModule({
			targetDirectory: root,
			moduleRef,
			packageName: `@tomflow/proflow-${moduleRef}`,
			kind,
			domain: "deployment-governance",
			summary: "Generated test fixture",
		});
		const generatedTsconfig = JSON.parse(
			await readFile(join(result.packageDirectory, "tsconfig.json"), "utf8"),
		) as { compilerOptions?: { types?: string[] } };
		assert.deepEqual(generatedTsconfig.compilerOptions?.types, ["node"]);
		const generatedPackage = JSON.parse(
			await readFile(join(result.packageDirectory, "package.json"), "utf8"),
		) as { devDependencies?: Record<string, string> };
		assert.equal(generatedPackage.devDependencies?.["@types/node"], "24.10.1");
		await execFileAsync(process.execPath, [
			tsc,
			"--noEmit",
			"-p",
			result.packageDirectory,
		]);
		const source = await readFile(
			join(result.packageDirectory, "src/index.ts"),
			"utf8",
		);
		assert.doesNotMatch(source, /\bany\b/);
	}
});

test("CP-DPL-TPL-04 migration is conditional and always requires re-conformance", () => {
	assert.deepEqual(
		assessTemplateMigration({
			currentVersion: "1.0.0",
			targetVersion: "1.1.0",
			contractCompatible: true,
			platformCompatible: true,
			mandatoryRequirement: false,
		}),
		{ required: false, reasons: [], reconformanceRequired: false },
	);
	assert.deepEqual(
		assessTemplateMigration({
			currentVersion: "1.0.0",
			targetVersion: "2.0.0",
			contractCompatible: false,
			platformCompatible: true,
			mandatoryRequirement: false,
		}),
		{
			required: true,
			reasons: ["contract incompatibility"],
			reconformanceRequired: true,
		},
	);
});
