import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	type ConfigSlot,
	type ModuleDescriptor,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";

import { rebuildCurrentAssumptions } from "../src/apply/current.ts";
import type { ResolvedModule } from "../src/contracts.ts";
import type { ModuleCatalog, ModuleSource } from "../src/modules.ts";
import { type WorkspacePaths, workspacePaths } from "../src/paths.ts";
import {
	loadConfig,
	loadPlan,
	materializeConfig,
	savePlan,
} from "../src/persistence/index.ts";
import {
	checkPlanStale,
	computeFingerprint,
	planDeployment,
} from "../src/planner/index.ts";
import { redactDeep, SECRET_REDACTED } from "../src/security/index.ts";

const RAW_SECRET_SENTINEL = "RAW_SECRET_SHOULD_NEVER_APPEAR_42f9";
const REF_A = "secret://model-provider/default";
const REF_B = "credential-ref:local-platform";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function descriptor(
	overrides: Partial<ModuleDescriptor> = {},
): ModuleDescriptor {
	return parseModuleDescriptor({
		contract: "module",
		contractVersion: "1.0.0",
		moduleRef: "fixture",
		packageName: "@tomflow/proflow-fixture",
		moduleVersion: "1.0.0",
		kind: "service",
		templateVersion: "1.0.0",
		platformCompatibility: ">=1.0.0 <2.0.0",
		provides: [],
		requires: [],
		requirements: [],
		configSlots: [],
		lifecycle: { supported: ["describe", "preflight", "verify", "doctor"] },
		verification: {
			checks: [
				{ id: "health", description: "Observed health", lifecycle: "verify" },
			],
		},
		effects: [],
		...overrides,
	});
}

function moduleFixture(input: {
	moduleRef: string;
	moduleVersion?: string;
	configSlots?: ConfigSlot[];
}): ResolvedModule {
	return {
		moduleRef: input.moduleRef,
		packageName: `@tomflow/proflow-${input.moduleRef}`,
		moduleVersion: input.moduleVersion ?? "1.0.0",
		kind: "service",
		provides: [],
		requires: [],
		requirements: [],
		configSlots: input.configSlots ?? [],
		lifecycle: ["describe", "verify", "doctor"],
		verification: {
			checks: [
				{ id: "health", description: "Observed health", lifecycle: "verify" },
			],
		},
		effects: [],
		source: { type: "workspace" },
	};
}

function secretSlot(): ConfigSlot {
	return {
		key: "apiKey",
		type: "secretRef",
		required: true,
		sensitive: true,
		description: "api credential reference",
	};
}

function installedCatalog(
	descriptors: readonly ModuleDescriptor[],
): ModuleCatalog {
	return {
		async sources(): Promise<ModuleSource[]> {
			return descriptors.map((item) => ({
				type: "installed",
				packageName: item.packageName,
			}));
		},
		async loadDescriptor(source: ModuleSource) {
			return descriptors.find(
				(item) => item.packageName === source.packageName,
			);
		},
		async loadAdapter() {
			return {};
		},
	};
}

async function tmpWorkspace(): Promise<{
	root: string;
	paths: WorkspacePaths;
	cleanup(): Promise<void>;
}> {
	const root = await mkdtemp(join(tmpdir(), "proflow-cli-stale-secret-"));
	return {
		root,
		paths: workspacePaths(root),
		async cleanup() {
			await rm(root, { recursive: true, force: true });
		},
	};
}

// ---------------------------------------------------------------------------
// secretRef persistence + materialization
// ---------------------------------------------------------------------------

test("secretRef reference persists verbatim through savePlan/loadPlan", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const modules = [
			moduleFixture({ moduleRef: "a", configSlots: [secretSlot()] }),
		];
		const plan = planDeployment({
			intent: "install",
			modules,
			config: { a: { apiKey: REF_A } },
		});
		await savePlan(paths, plan);

		const raw = await readFile(
			join(paths.plans, `${plan.planRef}.json`),
			"utf8",
		);
		assert.ok(raw.includes(REF_A));
		assert.ok(!raw.includes(SECRET_REDACTED));

		const loaded = await loadPlan(paths, plan.planRef);
		assert.equal(loaded?.moduleTargets[0]?.config?.apiKey, REF_A);
	} finally {
		await cleanup();
	}
});

test("secretRef reference materializes to public config verbatim, not .secrets.json", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		await materializeConfig(paths, {
			moduleRef: "mod-a",
			values: { apiKey: REF_A, endpoint: "https://example.com" },
			secretRefs: ["apiKey"],
		});

		const publicRaw = await readFile(join(paths.config, "mod-a.json"), "utf8");
		assert.ok(publicRaw.includes(REF_A));

		const secretRaw = await readFile(
			join(paths.config, "mod-a.secrets.json"),
			"utf8",
		);
		assert.ok(!secretRaw.includes(REF_A));

		const loaded = await loadConfig(paths, "mod-a");
		assert.equal(loaded?.publicValues.apiKey, REF_A);
		assert.equal(loaded?.secretValues.apiKey, undefined);
	} finally {
		await cleanup();
	}
});

// ---------------------------------------------------------------------------
// fingerprint + staleness
// ---------------------------------------------------------------------------

test("secretRef reference A→B changes the fingerprint and marks the plan stale", () => {
	const modules = [
		moduleFixture({ moduleRef: "a", configSlots: [secretSlot()] }),
	];
	const planA = planDeployment({
		intent: "install",
		modules,
		config: { a: { apiKey: REF_A } },
	});
	const planB = planDeployment({
		intent: "install",
		modules,
		config: { a: { apiKey: REF_B } },
	});

	assert.notEqual(computeFingerprint(planA), computeFingerprint(planB));

	const staleness = checkPlanStale(planA, {
		intent: "install",
		modules,
		config: { a: { apiKey: REF_B } },
	});
	assert.equal(staleness.stale, true);
	assert.ok(staleness.reasons.includes("targets changed"));
});

test("unchanged secretRef reference does not mark the plan stale", () => {
	const modules = [
		moduleFixture({ moduleRef: "a", configSlots: [secretSlot()] }),
	];
	const plan = planDeployment({
		intent: "install",
		modules,
		config: { a: { apiKey: REF_A } },
	});

	const staleness = checkPlanStale(plan, {
		intent: "install",
		modules,
		config: { a: { apiKey: REF_A } },
	});
	assert.equal(staleness.stale, false);
});

// ---------------------------------------------------------------------------
// raw-secret leak scan (defense-in-depth)
// ---------------------------------------------------------------------------

test("raw secret sentinel is scrubbed by redactDeep and never survives", () => {
	const scrubbed = redactDeep(
		{
			config: { apiKey: RAW_SECRET_SENTINEL },
			nested: { deep: { value: `prefix-${RAW_SECRET_SENTINEL}-suffix` } },
			list: [RAW_SECRET_SENTINEL, 42],
		},
		[RAW_SECRET_SENTINEL],
	);
	const serialized = JSON.stringify(scrubbed);
	assert.ok(!serialized.includes(RAW_SECRET_SENTINEL));
	assert.ok(serialized.includes(SECRET_REDACTED));
});

test("redactDeep leaves non-secret strings untouched", () => {
	const out = redactDeep({ region: "us-east", apiKey: REF_A }, [
		RAW_SECRET_SENTINEL,
	]);
	assert.deepEqual(out, { region: "us-east", apiKey: REF_A });
});

// ---------------------------------------------------------------------------
// rebuildCurrentAssumptions
// ---------------------------------------------------------------------------

test("rebuildCurrentAssumptions re-discovers modules from the catalog, not the old plan", async () => {
	const module = moduleFixture({ moduleRef: "a", moduleVersion: "1.0.0" });
	const plan = planDeployment({ intent: "install", modules: [module] });

	const catalog = installedCatalog([
		descriptor({
			moduleRef: "a",
			packageName: "@tomflow/proflow-a",
			moduleVersion: "2.0.0",
		}),
	]);

	const current = await rebuildCurrentAssumptions(catalog, plan);
	assert.equal(
		current.modules?.find((item) => item.moduleRef === "a")?.moduleVersion,
		"2.0.0",
	);

	// the re-discovered module version makes the stored plan stale
	const staleness = checkPlanStale(plan, current);
	assert.equal(staleness.stale, true);
	assert.ok(staleness.reasons.includes("modules changed"));
});
