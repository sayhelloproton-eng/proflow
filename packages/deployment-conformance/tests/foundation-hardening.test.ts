import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

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

async function buildGenerated(packageDirectory: string) {
	await execFileAsync(process.execPath, [
		tsc,
		"-p",
		join(packageDirectory, "tsconfig.build.json"),
	]);
}

test("P1-1..P1-5 generated package own adapters pass C1/C2/C3 and break at the owning gate", async (context) => {
	const root = await generatedRoot("proflow-foundation-hardening-");
	context.after(() => rm(root, { recursive: true, force: true }));
	for (const kind of [
		"library",
		"service",
		"cli",
		"browser-extension",
		"agent-package",
		"external-resource",
	] as const) {
		const generated = await materializeModule({
			targetDirectory: root,
			moduleRef: `closure-${kind}`,
			packageName: `@tomflow/proflow-closure-${kind}`,
			kind,
			domain: "deployment-governance",
			summary: "Generated test fixture",
		});
		await buildGenerated(generated.packageDirectory);
		const result = await runGeneratedPackageConformance(
			generated.packageDirectory,
		);
		assert.deepEqual(
			result.map((item) => item.status),
			["PASS", "PASS", "PASS"],
		);
	}

	const c1 = await materializeModule({
		targetDirectory: root,
		moduleRef: "broken-c1",
		packageName: "@tomflow/proflow-broken-c1",
		kind: "library",
		domain: "deployment-governance",
		summary: "Generated test fixture",
	});
	assert.equal(
		runStaticConformance({ ...c1.descriptor, packageName: "@tomflow/broken" })
			.status,
		"FAIL",
	);

	const c2 = await materializeModule({
		targetDirectory: root,
		moduleRef: "broken-c2",
		packageName: "@tomflow/proflow-broken-c2",
		kind: "library",
		domain: "deployment-governance",
		summary: "Generated test fixture",
	});
	const packagePath = join(c2.packageDirectory, "package.json");
	const metadata = JSON.parse(await readFile(packagePath, "utf8")) as Record<
		string,
		unknown
	>;
	await writeFile(
		packagePath,
		`${JSON.stringify({ ...metadata, private: true }, null, 2)}\n`,
	);
	assert.equal(
		(await runPackageConformance(c2.packageDirectory, c2.descriptor)).status,
		"FAIL",
	);

	const c3 = await materializeModule({
		targetDirectory: root,
		moduleRef: "broken-c3",
		packageName: "@tomflow/proflow-broken-c3",
		kind: "service",
		domain: "deployment-governance",
		summary: "Generated test fixture",
	});
	await writeFile(
		join(c3.packageDirectory, "deployment/adapter.ts"),
		"export const behaviorAdapter = {};\n",
	);
	await buildGenerated(c3.packageDirectory);
	assert.equal(
		(await runGeneratedPackageConformance(c3.packageDirectory))[2]?.status,
		"FAIL",
	);
});
