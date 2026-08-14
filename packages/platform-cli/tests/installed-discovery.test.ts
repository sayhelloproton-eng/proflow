import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	AutoModuleCatalog,
	discoverModules,
	InstalledModuleCatalog,
} from "../src/discovery/index.ts";

interface FixtureDescriptor {
	moduleRef: string;
	packageName: string;
}

function descriptorFor({ moduleRef, packageName }: FixtureDescriptor) {
	return {
		contract: "module",
		contractVersion: "1.0.0",
		moduleRef,
		packageName,
		moduleVersion: "1.0.0",
		kind: "service",
		templateVersion: "1.0.0",
		platformCompatibility: ">=1.0.0 <2.0.0",
		provides: [],
		requires: [],
		requirements: [],
		configSlots: [],
		lifecycle: { supported: ["describe", "preflight", "verify"] },
		verification: {
			checks: [
				{ id: "health", description: "observed health", lifecycle: "verify" },
			],
		},
		effects: [],
	};
}

function adapterSource(moduleRef: string): string {
	return `export const behaviorAdapter = {
	preflight: () => ({
		result: {
			contract: "deployment.result.v1",
			ok: true,
			status: "SUCCEEDED",
			moduleRef: ${JSON.stringify(moduleRef)},
			moduleVersion: "1.0.0",
		},
		observedEffects: [],
	}),
};
`;
}

async function writeWorkspacePackage(
	root: string,
	{ moduleRef, packageName }: FixtureDescriptor,
): Promise<void> {
	const pkgDir = join(root, "packages", moduleRef);
	await mkdir(join(pkgDir, "deployment"), { recursive: true });
	await writeFile(
		join(pkgDir, "package.json"),
		JSON.stringify({ name: packageName, version: "1.0.0" }),
	);
	await writeFile(
		join(pkgDir, "deployment", "descriptor.ts"),
		`export const descriptor = ${JSON.stringify(descriptorFor({ moduleRef, packageName }))};\n`,
	);
	await writeFile(
		join(pkgDir, "deployment", "adapter.ts"),
		adapterSource(moduleRef),
	);
}

async function writeInstalledPackage(
	root: string,
	{ moduleRef, packageName }: FixtureDescriptor,
): Promise<void> {
	const pkgDir = join(
		root,
		"node_modules",
		"@tomflow",
		packageName.slice("@tomflow/".length),
	);
	await mkdir(join(pkgDir, "deployment"), { recursive: true });
	await writeFile(
		join(pkgDir, "package.json"),
		JSON.stringify({
			name: packageName,
			version: "1.0.0",
			type: "module",
			exports: {
				"./deployment/descriptor": "./deployment/descriptor.js",
				"./deployment/adapter": "./deployment/adapter.js",
			},
		}),
	);
	await writeFile(
		join(pkgDir, "deployment", "descriptor.js"),
		`export const descriptor = ${JSON.stringify(descriptorFor({ moduleRef, packageName }))};\n`,
	);
	await writeFile(
		join(pkgDir, "deployment", "adapter.js"),
		adapterSource(moduleRef),
	);
}

async function tempWorkspace(): Promise<string> {
	return mkdtemp(join(tmpdir(), "proflow-product-"));
}

test("InstalledModuleCatalog discovers declared governed installed modules", async () => {
	const root = await tempWorkspace();
	try {
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				name: "product-repo",
				dependencies: { "@tomflow/proflow-fixture-provider": "1.0.0" },
			}),
		);
		await writeInstalledPackage(root, {
			moduleRef: "fixture-provider",
			packageName: "@tomflow/proflow-fixture-provider",
		});

		const catalog = new InstalledModuleCatalog(root);
		const sources = await catalog.sources();

		assert.equal(sources.length, 1);
		assert.equal(sources[0]?.type, "installed");
		assert.equal(sources[0]?.packageName, "@tomflow/proflow-fixture-provider");
		assert.equal(sources[0]?.path, undefined);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("InstalledModuleCatalog ignores undeclared and ungoverned packages", async () => {
	const root = await tempWorkspace();
	try {
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				name: "product-repo",
				dependencies: {
					"@tomflow/proflow-fixture-provider": "1.0.0",
					"left-pad": "1.0.0",
				},
			}),
		);
		await writeInstalledPackage(root, {
			moduleRef: "fixture-provider",
			packageName: "@tomflow/proflow-fixture-provider",
		});
		// Declared but has no deployment artifacts → not governed.
		const leftPadDir = join(root, "node_modules", "left-pad");
		await mkdir(leftPadDir, { recursive: true });
		await writeFile(
			join(leftPadDir, "package.json"),
			JSON.stringify({ name: "left-pad", version: "1.0.0" }),
		);
		// Present in node_modules with deployment artifacts but NOT declared → ignored.
		await writeInstalledPackage(root, {
			moduleRef: "ghost",
			packageName: "@tomflow/proflow-ghost",
		});

		const catalog = new InstalledModuleCatalog(root);
		const sources = await catalog.sources();

		assert.deepEqual(
			sources.map((source) => source.packageName),
			["@tomflow/proflow-fixture-provider"],
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("discoverModules resolves installed modules through real Node resolution", async () => {
	const root = await tempWorkspace();
	try {
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				name: "product-repo",
				dependencies: { "@tomflow/proflow-fixture-provider": "1.0.0" },
			}),
		);
		await writeInstalledPackage(root, {
			moduleRef: "fixture-provider",
			packageName: "@tomflow/proflow-fixture-provider",
		});

		const modules = await discoverModules({
			catalog: new InstalledModuleCatalog(root),
		});

		assert.equal(modules.length, 1);
		const module = modules[0];
		assert.equal(module?.moduleRef, "fixture-provider");
		assert.equal(module?.packageName, "@tomflow/proflow-fixture-provider");
		assert.equal(module?.source.type, "installed");
		assert.equal(module?.source.path, undefined);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("discoverModules finds installed modules in a product repo without pnpm-workspace.yaml", async () => {
	const root = await tempWorkspace();
	try {
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				name: "product-repo",
				dependencies: { "@tomflow/proflow-fixture-provider": "1.0.0" },
			}),
		);
		await writeInstalledPackage(root, {
			moduleRef: "fixture-provider",
			packageName: "@tomflow/proflow-fixture-provider",
		});

		// discoverModules auto-composes workspace + installed; a bare product repo
		// has no pnpm-workspace.yaml, so the workspace side contributes nothing and
		// the installed side must still resolve the governed module.
		const modules = await discoverModules({ workspaceRoot: root });

		assert.equal(modules.length, 1);
		assert.equal(modules[0]?.moduleRef, "fixture-provider");
		assert.equal(modules[0]?.source.type, "installed");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("AutoModuleCatalog combines workspace and installed sources", async () => {
	const root = await tempWorkspace();
	try {
		await writeFile(
			join(root, "pnpm-workspace.yaml"),
			'packages:\n  - "packages/*"\n',
		);
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				name: "product-repo",
				dependencies: { "@tomflow/proflow-fixture-extra": "1.0.0" },
			}),
		);
		await writeWorkspacePackage(root, {
			moduleRef: "fixture-provider",
			packageName: "@tomflow/proflow-fixture-provider",
		});
		await writeInstalledPackage(root, {
			moduleRef: "fixture-extra",
			packageName: "@tomflow/proflow-fixture-extra",
		});

		const modules = await discoverModules({
			catalog: new AutoModuleCatalog(root),
		});
		const byRef = new Map(modules.map((module) => [module.moduleRef, module]));

		assert.equal(modules.length, 2);
		assert.equal(byRef.get("fixture-provider")?.source.type, "workspace");
		assert.equal(byRef.get("fixture-extra")?.source.type, "installed");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("AutoModuleCatalog prefers workspace over installed on packageName collision", async () => {
	const root = await tempWorkspace();
	try {
		await writeFile(
			join(root, "pnpm-workspace.yaml"),
			'packages:\n  - "packages/*"\n',
		);
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				name: "product-repo",
				dependencies: { "@tomflow/proflow-fixture-provider": "1.0.0" },
			}),
		);
		await writeWorkspacePackage(root, {
			moduleRef: "fixture-provider",
			packageName: "@tomflow/proflow-fixture-provider",
		});
		await writeInstalledPackage(root, {
			moduleRef: "fixture-provider",
			packageName: "@tomflow/proflow-fixture-provider",
		});

		// Both the workspace package and the installed dependency carry the same
		// packageName; workspace must win deterministically without throwing
		// DUPLICATE_IDENTITY.
		const modules = await discoverModules({
			catalog: new AutoModuleCatalog(root),
		});

		assert.equal(modules.length, 1);
		assert.equal(modules[0]?.moduleRef, "fixture-provider");
		assert.equal(modules[0]?.source.type, "workspace");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("InstalledModuleCatalog resolves a real built package via symlink", async () => {
	const here = dirname(fileURLToPath(import.meta.url));
	const moduleContractDir = resolve(here, "../../module-contract");

	const root = await tempWorkspace();
	try {
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				name: "product-repo",
				dependencies: { "@tomflow/proflow-module-contract": "0.1.0" },
			}),
		);
		await mkdir(join(root, "node_modules", "@tomflow"), { recursive: true });
		await symlink(
			moduleContractDir,
			join(root, "node_modules", "@tomflow", "proflow-module-contract"),
			"dir",
		);

		const modules = await discoverModules({
			catalog: new InstalledModuleCatalog(root),
		});

		assert.equal(modules.length, 1);
		assert.equal(modules[0]?.moduleRef, "module-contract");
		assert.equal(modules[0]?.packageName, "@tomflow/proflow-module-contract");
		assert.equal(modules[0]?.source.type, "installed");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
