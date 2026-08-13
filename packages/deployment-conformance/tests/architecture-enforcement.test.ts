import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runRepositoryArchitecture } from "../src/architecture.ts";

async function packageFixture(
	root: string,
	directory: string,
	metadata: object,
	source: string,
): Promise<void> {
	const target = join(root, "packages", directory);
	await mkdir(join(target, "src"), { recursive: true });
	await writeFile(
		join(target, "package.json"),
		`${JSON.stringify(metadata, null, 2)}\n`,
	);
	await writeFile(join(target, "src/index.ts"), source);
}

test("platform conventions gate covers current repository and future package discovery", async (context) => {
	assert.equal((await runRepositoryArchitecture(process.cwd())).status, "PASS");
	const root = await mkdtemp(join(tmpdir(), "proflow-architecture-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(
		join(root, "package.json"),
		`${JSON.stringify({ name: "proflow", private: true })}\n`,
	);
	await packageFixture(
		root,
		"bad-name",
		{
			name: "@tomflow/bad-name",
			version: "1.0.0",
			type: "module",
			exports: { ".": "./src/index.ts" },
			publishConfig: { access: "public" },
		},
		"export {};\n",
	);
	const result = await runRepositoryArchitecture(root);
	assert.equal(result.status, "FAIL");
	assert.ok(
		result.issues.some((issue) => issue.code === "PACKAGE_NAME_INVALID"),
	);
});

test("architecture rejects deep imports, undeclared dependencies, cycles, dumping grounds, and secrets", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-architecture-broken-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(
		join(root, "package.json"),
		`${JSON.stringify({ name: "proflow", private: true })}\n`,
	);
	await packageFixture(
		root,
		"alpha",
		{
			name: "@tomflow/proflow-alpha",
			version: "1.0.0",
			type: "module",
			exports: { ".": "./src/index.ts" },
			publishConfig: { access: "public" },
			dependencies: { "@tomflow/proflow-beta": "workspace:*" },
		},
		'import "@tomflow/proflow-beta/src/internal/secret.ts";\nimport "@tomflow/proflow-undeclared";\nconst computed = "@tomflow/proflow-hidden";\nvoid import(computed);\nexport const apiToken = "plaintext";\n',
	);
	await packageFixture(
		root,
		"beta",
		{
			name: "@tomflow/proflow-beta",
			version: "1.0.0",
			type: "module",
			exports: { ".": "./src/index.ts" },
			publishConfig: { access: "public" },
			dependencies: { "@tomflow/proflow-alpha": "workspace:*" },
		},
		"export {};\n",
	);
	await packageFixture(
		root,
		"shared",
		{
			name: "@tomflow/proflow-shared",
			version: "1.0.0",
			type: "module",
			exports: { ".": "./src/index.ts" },
			publishConfig: { access: "public" },
		},
		"export {};\n",
	);
	const codes = new Set(
		(await runRepositoryArchitecture(root)).issues.map((issue) => issue.code),
	);
	for (const code of [
		"DEEP_IMPORT",
		"UNDECLARED_DEPENDENCY",
		"DEPENDENCY_CYCLE",
		"DUMPING_GROUND_PACKAGE",
		"PLAINTEXT_SECRET",
		"UNRESOLVED_DYNAMIC_IMPORT",
	]) {
		assert.equal(codes.has(code), true, code);
	}
});

test("production imports cannot be satisfied only by devDependencies", async (context) => {
	const root = await mkdtemp(
		join(tmpdir(), "proflow-architecture-dependency-class-"),
	);
	context.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(
		join(root, "package.json"),
		`${JSON.stringify({ name: "proflow", private: true })}\n`,
	);
	await packageFixture(
		root,
		"consumer",
		{
			name: "@tomflow/proflow-consumer",
			version: "1.0.0",
			type: "module",
			exports: { ".": "./src/index.ts" },
			publishConfig: { access: "public" },
			devDependencies: { "@tomflow/proflow-provider": "workspace:^" },
		},
		'import "@tomflow/proflow-provider";\n',
	);
	await packageFixture(
		root,
		"provider",
		{
			name: "@tomflow/proflow-provider",
			version: "1.0.0",
			type: "module",
			exports: { ".": "./src/index.ts" },
			publishConfig: { access: "public" },
		},
		"export {};\n",
	);
	const result = await runRepositoryArchitecture(root);
	assert.equal(
		result.issues.some(
			(issue) => issue.code === "PRODUCTION_DEPENDENCY_ONLY_DEV",
		),
		true,
	);
});
