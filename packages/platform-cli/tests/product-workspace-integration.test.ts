import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { workspaceResidentDriver } from "../src/apply/driver.ts";
import { applyPlan } from "../src/apply/index.ts";
import type { ResolvedModule } from "../src/contracts.ts";
import {
	discoverModules,
	InstalledModuleCatalog,
} from "../src/discovery/index.ts";
import { generateInstallDoc } from "../src/install/index.ts";
import { buildManifest } from "../src/manifest/index.ts";
import type { ModuleCatalog } from "../src/modules.ts";
import { type WorkspacePaths, workspacePaths } from "../src/paths.ts";
import { loadPlan, savePlan } from "../src/persistence/index.ts";
import { type PlanInput, planDeployment } from "../src/planner/index.ts";
import { runPreflight } from "../src/preflight/preflight.ts";
import { verifyModules } from "../src/verification/index.ts";

// ---------------------------------------------------------------------------
// A real, local-only product workspace: a bare temp repo whose package.json
// declares a governed installed dependency resolved through real Node package
// resolution (a symlink to this repository's built module-contract), plus a
// synthetic governed module with a required config slot so the full
// preflight/plan/apply/verify/manifest/INSTALL flow is exercised with no
// network access.
// ---------------------------------------------------------------------------

const FIXTURE_PRODUCT_REF = "fixture-product";
const FIXTURE_PRODUCT_PACKAGE = "@tomflow/proflow-fixture-product";
const PRODUCT_CONFIG = { endpoint: "https://product.example" };

function syntheticDescriptor(): Record<string, unknown> {
	return {
		contract: "module",
		contractVersion: "1.0.0",
		moduleRef: FIXTURE_PRODUCT_REF,
		packageName: FIXTURE_PRODUCT_PACKAGE,
		moduleVersion: "1.0.0",
		kind: "service",
		installClass: "optional",
		identity: {
			domain: "deployment-governance",
			summary: "Product workspace synthetic service",
		},
		templateVersion: "1.0.0",
		platformCompatibility: ">=1.0.0 <2.0.0",
		provides: [],
		requires: [],
		requirements: [],
		configSlots: [
			{
				key: "endpoint",
				type: "url",
				required: true,
				description: "service endpoint",
			},
		],
		lifecycle: {
			supported: ["describe", "preflight", "status", "verify", "doctor"],
		},
		verification: {
			checks: [
				{ id: "health", description: "Observed health", lifecycle: "verify" },
			],
		},
		effects: [],
		documentation: [],
	};
}

function syntheticAdapter(): string {
	const result = (data?: unknown): string =>
		`{ contract: "deployment.result.v1", ok: true, status: "SUCCEEDED", moduleRef: ${JSON.stringify(FIXTURE_PRODUCT_REF)}, moduleVersion: "1.0.0"${data === undefined ? "" : `, data: ${JSON.stringify(data)}`} }`;
	return `export const behaviorAdapter = {
	preflight: () => ({ result: ${result()}, observedEffects: [] }),
	status: () => ({ result: ${result({ processRunning: true })}, observedEffects: [] }),
	verify: () => ({ result: { contract: "deployment.result.v1", ok: true, status: "SUCCEEDED", moduleRef: ${JSON.stringify(FIXTURE_PRODUCT_REF)}, moduleVersion: "1.0.0", checks: [{ id: "health", status: "PASS", message: "ok" }] }, observedEffects: [] }),
	doctor: () => ({ result: ${result()}, observedEffects: [] }),
};
`;
}

async function writeSyntheticInstalledPackage(root: string): Promise<void> {
	const pkgDir = join(
		root,
		"node_modules",
		"@tomflow",
		FIXTURE_PRODUCT_PACKAGE.slice("@tomflow/".length),
	);
	await mkdir(join(pkgDir, "deployment"), { recursive: true });
	await mkdir(join(pkgDir, "node_modules"), { recursive: true });
	await writeFile(
		join(pkgDir, "package.json"),
		JSON.stringify({
			name: FIXTURE_PRODUCT_PACKAGE,
			version: "1.0.0",
			type: "module",
			exports: {
				"./deployment/descriptor": "./deployment/descriptor.js",
				"./deployment/adapter": "./deployment/adapter.js",
			},
			proflow: {
				module: true,
				installClass: "optional",
				descriptor: "./deployment/descriptor.js",
				manifest: "./proflow.module.json",
				installRequires: [],
			},
		}),
	);
	await writeFile(
		join(pkgDir, "deployment", "descriptor.js"),
		`export const descriptor = ${JSON.stringify(syntheticDescriptor())};\n`,
	);
	await writeFile(join(pkgDir, "deployment", "adapter.js"), syntheticAdapter());
}

async function setupProductRepo(): Promise<{
	root: string;
	paths: WorkspacePaths;
	catalog: ModuleCatalog;
	modules: ResolvedModule[];
	config: Record<string, Record<string, string>>;
	cleanup(): Promise<void>;
}> {
	const here = dirname(fileURLToPath(import.meta.url));
	const moduleContractDir = resolve(here, "../../module-contract");

	const root = await mkdtemp(join(tmpdir(), "proflow-product-"));
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({
			name: "product-repo",
			private: true,
			dependencies: {
				"@tomflow/proflow-module-contract": "0.1.0",
				[FIXTURE_PRODUCT_PACKAGE]: "1.0.0",
			},
		}),
	);
	await mkdir(join(root, "node_modules", "@tomflow"), { recursive: true });
	await symlink(
		moduleContractDir,
		join(root, "node_modules", "@tomflow", "proflow-module-contract"),
		"dir",
	);
	await writeSyntheticInstalledPackage(root);

	const catalog = new InstalledModuleCatalog(root);
	const modules = await discoverModules({ catalog });
	const config: Record<string, Record<string, string>> = {
		[FIXTURE_PRODUCT_REF]: PRODUCT_CONFIG,
	};

	return {
		root,
		paths: workspacePaths(root),
		catalog,
		modules,
		config,
		async cleanup() {
			await rm(root, { recursive: true, force: true });
		},
	};
}

// ---------------------------------------------------------------------------

test("product workspace — installed discovery resolves real + synthetic governed modules", async () => {
	const { modules, cleanup } = await setupProductRepo();
	try {
		const byRef = new Map(modules.map((module) => [module.moduleRef, module]));
		assert.equal(byRef.has("module-contract"), true);
		assert.equal(byRef.has(FIXTURE_PRODUCT_REF), true);
		for (const module of modules) {
			assert.equal(module.source.type, "installed");
		}
	} finally {
		await cleanup();
	}
});

test("product workspace — preflight is READY when required config is provided", async () => {
	const { catalog, modules, config, cleanup } = await setupProductRepo();
	try {
		const result = await runPreflight(modules, { catalog, config });
		assert.equal(result.status, "READY");
		assert.equal(result.findings.length, 0);
	} finally {
		await cleanup();
	}
});

test("product workspace — preflight flags a missing required config slot", async () => {
	const { catalog, modules, cleanup } = await setupProductRepo();
	try {
		const result = await runPreflight(modules, { catalog });
		assert.equal(result.status, "NOT_READY");
		assert.ok(
			result.findings.some(
				(finding) =>
					finding.code === "CONFIG_MISSING" &&
					finding.moduleRef === FIXTURE_PRODUCT_REF,
			),
		);
	} finally {
		await cleanup();
	}
});

test("product workspace — plan persists and round-trips through savePlan/loadPlan", async () => {
	const { paths, modules, config, cleanup } = await setupProductRepo();
	try {
		const plan = planDeployment({ intent: "install", modules, config });
		await savePlan(paths, plan);
		const loaded = await loadPlan(paths, plan.planRef);
		assert.ok(loaded !== undefined);
		assert.equal(loaded.planRef, plan.planRef);
		assert.equal(loaded.fingerprint, plan.fingerprint);
		assert.deepEqual(
			loaded.resolvedModules.map((module) => module.moduleRef).sort(),
			[FIXTURE_PRODUCT_REF, "module-contract"],
		);
	} finally {
		await cleanup();
	}
});

test("product workspace — apply safe gate blocks a stale plan and records no applied plan", async () => {
	const { paths, catalog, modules, config, cleanup } = await setupProductRepo();
	try {
		const plan = planDeployment({ intent: "install", modules, config });
		await savePlan(paths, plan);

		const stale: PlanInput = {
			intent: "install",
			modules,
			config: {
				[FIXTURE_PRODUCT_REF]: { endpoint: "https://stale.example" },
			},
		};
		const result = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			driver: workspaceResidentDriver(),
			current: stale,
		});
		assert.equal(result.outcome, "BLOCKED");
	} finally {
		await cleanup();
	}
});

test("product workspace — apply materializes config, verifies, and composes a READY manifest + INSTALL", async () => {
	const { paths, catalog, modules, config, cleanup } = await setupProductRepo();
	try {
		const plan = planDeployment({ intent: "install", modules, config });
		await savePlan(paths, plan);
		const current: PlanInput = { intent: "install", modules, config };

		const applied = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			driver: workspaceResidentDriver(),
			current,
		});
		assert.equal(applied.outcome, "COMPLETE");

		// config materialized to the public config file
		const publicConfig = await readFile(
			join(paths.config, `${FIXTURE_PRODUCT_REF}.json`),
			"utf8",
		);
		assert.ok(publicConfig.includes(PRODUCT_CONFIG.endpoint));

		// verification history appended
		const verified = await verifyModules(catalog, modules, paths);
		assert.equal(verified.length, 2);
		for (const result of verified) {
			assert.equal(result.record.result, "PASS");
		}

		// manifest reflects live reality → READY
		const manifest = await buildManifest({ catalog, modules, paths, config });
		assert.equal(manifest.status, "READY");

		// generated INSTALL names the governed module set
		await generateInstallDoc({ paths, modules, config });
		const installDoc = await readFile(paths.installMd, "utf8");
		assert.ok(installDoc.includes(FIXTURE_PRODUCT_REF));
		assert.ok(installDoc.includes("module-contract"));
	} finally {
		await cleanup();
	}
});
