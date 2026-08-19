import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import type { ModuleKind } from "@tomflow/proflow-module-contract";
import {
	loadGeneratedBehaviorAdapter,
	materializeModule,
} from "../src/index.ts";

const kinds: ModuleKind[] = [
	"library",
	"service",
	"cli",
	"browser-extension",
	"agent-package",
	"external-resource",
];
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

test("P1-1/P1-2 all six profiles load and execute their own generated adapter", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-own-adapter-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	for (const kind of kinds) {
		const generated = await materializeModule({
			targetDirectory: root,
			moduleRef: `own-adapter-${kind}`,
			packageName: `@tomflow/proflow-own-adapter-${kind}`,
			kind,
			domain: "deployment-governance",
			summary: "Generated test fixture",
		});
		const adapter = await loadGeneratedBehaviorAdapter(
			generated.packageDirectory,
		);
		for (const primitive of generated.descriptor.lifecycle.supported) {
			assert.equal(
				typeof adapter[primitive],
				"function",
				`${kind}:${primitive}`,
			);
			const observation = await adapter[primitive]?.();
			assert.equal(observation?.result.contract, "deployment.result.v1");
		}
		if (kind === "service") {
			assert.equal(typeof adapter.start, "function");
			assert.equal(typeof adapter.stop, "function");
			assert.equal(typeof adapter.restart, "undefined");
		}
		assert.equal(adapter.verify, undefined);
		if (kind === "cli") assert.equal(generated.machineEntry, "dist/src/cli.js");
		if (kind === "agent-package") {
			const status = await adapter.status?.();
			assert.equal(status?.result.status, "SUCCEEDED");
		}
		if (kind === "external-resource") {
			const status = await adapter.status?.();
			assert.deepEqual(status?.result.data, {
				configStatus: "INCOMPLETE",
				missingConfig: ["resourceUrl"],
				runtimeStatus: "UNKNOWN",
			});
		}
	}
});

test("P1-4/P1-5 template enforces formal names and creates publishable public packages", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-publishable-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(
		materializeModule({
			targetDirectory: root,
			moduleRef: "invalid-name",
			packageName: "@tomflow/invalid-name",
			kind: "library",
			domain: "deployment-governance",
			summary: "Generated test fixture",
		}),
	);
	const generated = await materializeModule({
		targetDirectory: root,
		moduleRef: "publishable",
		packageName: "@tomflow/proflow-publishable",
		kind: "library",
		domain: "deployment-governance",
		summary: "Generated test fixture",
	});
	assert.equal(generated.packageMetadata.private, undefined);
	assert.deepEqual(generated.packageMetadata.publishConfig, {
		access: "public",
	});
});

test("FND-P1-01 generated Module builds JS and declarations, packs, and imports from an isolated consumer", async (context) => {
	const root = await generatedToolchainRoot("proflow-template-publish-e2e-");
	context.after(() => rm(root, { recursive: true, force: true }));
	const generated = await materializeModule({
		targetDirectory: root,
		moduleRef: "published-module",
		packageName: "@tomflow/proflow-published-module",
		kind: "library",
		domain: "deployment-governance",
		summary: "Generated test fixture",
	});
	const metadata = JSON.parse(
		await readFile(join(generated.packageDirectory, "package.json"), "utf8"),
	) as {
		exports: Record<string, string>;
		files: string[];
	};
	assert.equal(metadata.exports["."], "./dist/src/index.js");
	assert.deepEqual(metadata.files, [
		"dist",
		"conformance.json",
		"README.md",
		"proflow.module.json",
	]);
	assert.equal(
		Object.values(metadata.exports).some((entry) => entry.endsWith(".ts")),
		false,
	);

	await execFileAsync("pnpm", ["run", "typecheck"], {
		cwd: generated.packageDirectory,
	});
	await execFileAsync("pnpm", ["run", "build"], {
		cwd: generated.packageDirectory,
	});
	await stat(join(generated.packageDirectory, "dist/src/index.js"));
	await stat(join(generated.packageDirectory, "dist/src/index.d.ts"));

	const tarballDirectory = join(root, "tarballs");
	await execFileAsync(
		"pnpm",
		["pack", "--pack-destination", tarballDirectory],
		{
			cwd: generated.packageDirectory,
		},
	);
	const tarball = (await readdir(tarballDirectory)).find((entry) =>
		entry.endsWith(".tgz"),
	);
	assert.ok(tarball);
	// Import the built module directly from its dist output (no package install).
	const builtModule = await import(
		pathToFileURL(join(generated.packageDirectory, "dist/src/index.js")).href
	);
	assert.equal(builtModule.moduleRef, "published-module");
});
