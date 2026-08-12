import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
	type ModuleKind,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";
import { assessTemplateMigration, materializeModule } from "../src/index.ts";

const execFileAsync = promisify(execFile);
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
			packageName: `@tomflow/${moduleRef}`,
			kind,
		});
		assert.equal(parseModuleDescriptor(result.descriptor).kind, kind);
		assert.equal(
			await exists(join(result.packageDirectory, "src/lifecycle.ts")),
			kind === "service",
		);
		assert.equal(
			await exists(join(result.packageDirectory, "src/cli.ts")),
			kind === "cli",
		);
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

test("CP-DPL-TPL-02 emits minimum metadata and verification without fake lifecycle", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-template-minimum-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	for (const kind of kinds) {
		const moduleRef = `minimum-${kind}`;
		const result = await materializeModule({
			targetDirectory: root,
			moduleRef,
			packageName: `@tomflow/${moduleRef}`,
			kind,
		});
		for (const relative of [
			"package.json",
			"README.md",
			"src/index.ts",
			"tests/smoke.test.ts",
			"deployment/descriptor.ts",
			"deployment/requirements.ts",
			"deployment/verification.ts",
			"conformance.json",
		]) {
			assert.equal(
				await exists(join(result.packageDirectory, relative)),
				true,
				`${kind}: ${relative}`,
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

test("CP-DPL-TPL-03 generated TypeScript packages pass strict tsc with no any", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-template-typecheck-"));
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
			packageName: `@tomflow/${moduleRef}`,
			kind,
		});
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
