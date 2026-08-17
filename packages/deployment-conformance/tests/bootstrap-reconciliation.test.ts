import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import type { ModuleDescriptor } from "@tomflow/proflow-module-contract";
import { materializeModule } from "@tomflow/proflow-module-template";
import {
	runGeneratedPackageConformance,
	runPackageConformance,
	runStaticConformance,
} from "../src/index.ts";

const execFileAsync = promisify(execFile);
const tsc = resolve(
	import.meta.dirname,
	"../../../node_modules/typescript/bin/tsc",
);

const repositoryRoot = resolve(import.meta.dirname, "../../..");

async function generatedRoot(prefix: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), prefix));
	await symlink(
		join(repositoryRoot, "node_modules"),
		join(root, "node_modules"),
		"dir",
	);
	return root;
}

test("Bootstrap closure generates, typechecks, validates, and conforms all six profiles", async (context) => {
	const root = await generatedRoot("proflow-bootstrap-closure-");
	context.after(() => rm(root, { recursive: true, force: true }));
	const kinds: ModuleDescriptor["kind"][] = [
		"library",
		"service",
		"cli",
		"browser-extension",
		"agent-package",
		"external-resource",
	];
	for (const kind of kinds) {
		const moduleRef = `bootstrap-${kind}`;
		const generated = await materializeModule({
			targetDirectory: root,
			moduleRef,
			packageName: `@tomflow/proflow-${moduleRef}`,
			kind,
			installClass: "optional",
			domain: "deployment-governance",
			summary: "Generated test fixture",
		});
		await execFileAsync(process.execPath, [
			tsc,
			"-p",
			join(generated.packageDirectory, "tsconfig.build.json"),
		]);
		assert.deepEqual(
			(await runGeneratedPackageConformance(generated.packageDirectory)).map(
				(result) => result.status,
			),
			["PASS", "PASS", "PASS"],
		);
		await execFileAsync(process.execPath, [
			tsc,
			"--noEmit",
			"-p",
			generated.packageDirectory,
		]);
	}
});

test("Bootstrap closure deterministically rejects intentional C1, C2, and C3 breakage", async (context) => {
	const root = await generatedRoot("proflow-bootstrap-broken-");
	context.after(() => rm(root, { recursive: true, force: true }));
	const generated = await materializeModule({
		targetDirectory: root,
		moduleRef: "bootstrap-broken",
		packageName: "@tomflow/proflow-bootstrap-broken",
		kind: "service",
		installClass: "optional",
		domain: "deployment-governance",
		summary: "Generated test fixture",
	});
	assert.equal(
		runStaticConformance({ ...generated.descriptor, contractVersion: "2.0.0" })
			.status,
		"FAIL",
	);

	const packagePath = join(generated.packageDirectory, "package.json");
	const metadata = JSON.parse(await readFile(packagePath, "utf8")) as Record<
		string,
		unknown
	>;
	await writeFile(
		packagePath,
		`${JSON.stringify({ ...metadata, version: "8.8.8" }, null, 2)}\n`,
	);
	assert.equal(
		(
			await runPackageConformance(
				generated.packageDirectory,
				generated.descriptor,
			)
		).status,
		"FAIL",
	);

	const brokenBehavior = await materializeModule({
		targetDirectory: root,
		moduleRef: "bootstrap-broken-behavior",
		packageName: "@tomflow/proflow-bootstrap-broken-behavior",
		kind: "service",
		installClass: "optional",
		domain: "deployment-governance",
		summary: "Generated test fixture",
	});
	await writeFile(
		join(brokenBehavior.packageDirectory, "deployment/adapter.ts"),
		"export const behaviorAdapter = {};\n",
	);
	await execFileAsync(process.execPath, [
		tsc,
		"-p",
		join(brokenBehavior.packageDirectory, "tsconfig.build.json"),
	]);
	assert.equal(
		(await runGeneratedPackageConformance(brokenBehavior.packageDirectory))[2]
			.status,
		"FAIL",
	);
});

test("Bootstrap packages reconcile with their own Module Contract and Package gates", async () => {
	for (const directory of [
		"module-contract",
		"module-template",
		"deployment-conformance",
	]) {
		assert.deepEqual(
			(
				await runGeneratedPackageConformance(
					join(repositoryRoot, "packages", directory),
				)
			).map((result) => result.status),
			["PASS", "PASS", "PASS"],
		);
	}
});
