import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type ModuleDescriptor,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";

import type { ResolvedModule } from "../src/contracts.ts";
import {
	assessUpgrade,
	CheckStrategy,
	checkPlanStale,
	computeFingerprint,
	ExecuteStrategy,
	evaluateStepCheck,
	type PlanInput,
	planDeployment,
	planRepair,
	type RepairFact,
} from "../src/planner/index.ts";

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
	kind?: ResolvedModule["kind"];
	provides?: ResolvedModule["provides"];
	requires?: ResolvedModule["requires"];
	requirements?: ResolvedModule["requirements"];
	configSlots?: ResolvedModule["configSlots"];
	lifecycle?: string[];
}): ResolvedModule {
	return {
		moduleRef: input.moduleRef,
		packageName: `@tomflow/proflow-${input.moduleRef}`,
		moduleVersion: "1.0.0",
		kind: input.kind ?? "service",
		provides: input.provides ?? [],
		requires: input.requires ?? [],
		requirements: input.requirements ?? [],
		configSlots: input.configSlots ?? [],
		lifecycle: input.lifecycle ?? ["describe", "verify", "doctor"],
		verification: {
			checks: [
				{ id: "health", description: "Observed health", lifecycle: "verify" },
			],
		},
		effects: [],
		source: { type: "workspace" },
	};
}

function configSlot(
	key: string,
	options: { type?: "string" | "secretRef"; required?: boolean } = {},
) {
	return {
		key,
		type: options.type ?? "string",
		required: options.required ?? false,
		description: `slot ${key}`,
		...(options.type === "secretRef" ? { sensitive: true } : {}),
	};
}

// ---------------------------------------------------------------------------
// planDeployment / fingerprint / stale
// ---------------------------------------------------------------------------

test("planDeployment produces an immutable, dependency-ordered plan", () => {
	const modules = [
		moduleFixture({
			moduleRef: "consumer",
			requires: [{ contractRef: "cap", versionRange: ">=1.0.0" }],
		}),
		moduleFixture({
			moduleRef: "provider",
			provides: [{ contractRef: "cap", version: "1.0.0" }],
		}),
	];
	const plan = planDeployment({ intent: "install", modules });

	assert.ok(plan.planRef.length > 0);
	assert.ok(plan.fingerprint.length > 0);
	assert.ok(plan.createdAt.length > 0);

	// dependency-first: provider before consumer
	const refs = plan.steps.map((step) => step.moduleRef);
	const providerIndex = refs.indexOf("provider");
	const consumerIndex = refs.indexOf("consumer");
	assert.ok(providerIndex >= 0);
	assert.ok(consumerIndex >= 0);
	assert.ok(providerIndex < consumerIndex);

	// immutable (deep frozen)
	assert.equal(Object.isFrozen(plan), true);
	assert.equal(Object.isFrozen(plan.steps), true);
	assert.throws(() => {
		(plan as { intent: string }).intent = "repair";
	}, TypeError);
});

test("planDeployment covers config/package/human/external-resource/lifecycle kinds", () => {
	const modules = [
		moduleFixture({
			moduleRef: "svc",
			configSlots: [configSlot("host", { required: true })],
			requirements: [{ kind: "human", action: "grant access" }],
			lifecycle: ["describe", "verify", "doctor", "start"],
		}),
		moduleFixture({
			moduleRef: "ext",
			kind: "external-resource",
			lifecycle: ["describe", "verify", "doctor", "start"],
		}),
	];
	const plan = planDeployment({ intent: "install", modules });
	const kinds = new Set(plan.steps.map((step) => step.kind));

	assert.ok(kinds.has("package"));
	assert.ok(kinds.has("config"));
	assert.ok(kinds.has("human"));
	assert.ok(kinds.has("external-resource"));

	// lifecycle coverage via configure + restart declaration
	const restart = moduleFixture({
		moduleRef: "svc",
		configSlots: [configSlot("host", { required: true })],
		lifecycle: ["describe", "verify", "doctor", "start", "restart"],
	});
	const configurePlan = planDeployment({
		intent: "configure",
		modules: [restart],
	});
	assert.ok(configurePlan.steps.some((step) => step.kind === "lifecycle"));
});

test("computeFingerprint is stable for the same plan and reacts to intent/targets/modules", () => {
	const modules = [moduleFixture({ moduleRef: "a" })];
	const plan = planDeployment({ intent: "install", modules });

	assert.equal(computeFingerprint(plan), plan.fingerprint);
	assert.equal(computeFingerprint(plan), computeFingerprint(plan));

	const differentIntent = planDeployment({ intent: "configure", modules });
	assert.notEqual(computeFingerprint(differentIntent), plan.fingerprint);

	const differentVersion = planDeployment({
		intent: "install",
		modules: [
			{
				...moduleFixture({ moduleRef: "a" }),
				moduleVersion: "2.0.0",
			},
		],
	});
	assert.notEqual(computeFingerprint(differentVersion), plan.fingerprint);

	const differentTarget = planDeployment({
		intent: "install",
		modules,
		targets: [{ moduleRef: "a", targetVersion: "1.5.0" }],
	});
	assert.notEqual(computeFingerprint(differentTarget), plan.fingerprint);
});

test("checkPlanStale flags stable assumption change but not volatile reality change", () => {
	const modules = [moduleFixture({ moduleRef: "a" })];
	const plan = planDeployment({ intent: "install", modules });

	// unchanged → not stale
	const same = checkPlanStale(plan, { intent: "install", modules });
	assert.equal(same.stale, false);

	// module version change → stale (stable assumption)
	const versionChanged = checkPlanStale(plan, {
		intent: "install",
		modules: [{ ...moduleFixture({ moduleRef: "a" }), moduleVersion: "2.0.0" }],
	});
	assert.equal(versionChanged.stale, true);

	// config intention change → stale (stable assumption)
	const configModule = moduleFixture({
		moduleRef: "a",
		configSlots: [configSlot("host", { required: true })],
	});
	const configPlan = planDeployment({
		intent: "install",
		modules: [configModule],
		config: { a: { host: "one" } },
	});
	const configChanged = checkPlanStale(configPlan, {
		intent: "install",
		modules: [configModule],
		config: { a: { host: "two" } },
	});
	assert.equal(configChanged.stale, true);

	// volatile reality (login/process state) is not a plan input → never stale
	const volatile = checkPlanStale(plan, { intent: "install", modules });
	assert.equal(volatile.stale, false);
});

test("fingerprint includes secretRef references verbatim so A→B changes it", () => {
	const modules = [
		moduleFixture({
			moduleRef: "a",
			configSlots: [
				configSlot("apiKey", { type: "secretRef", required: true }),
			],
		}),
	];
	const planA = planDeployment({
		intent: "install",
		modules,
		config: { a: { apiKey: "secret://model-provider/default" } },
	});
	const planB = planDeployment({
		intent: "install",
		modules,
		config: { a: { apiKey: "credential-ref:local-platform" } },
	});

	// secretRef values are opaque reference identities: a reference change
	// (A→B) is a stable-assumption change and must change the fingerprint.
	assert.notEqual(planB.fingerprint, planA.fingerprint);
});

// ---------------------------------------------------------------------------
// step check semantics
// ---------------------------------------------------------------------------

test("evaluateStepCheck returns SATISFIED only from current reality, not history", () => {
	const modules = [moduleFixture({ moduleRef: "a" })];
	const plan = planDeployment({ intent: "install", modules });
	const packageStep = plan.steps.find(
		(step) => step.kind === "package" && step.moduleRef === "a",
	);
	assert.ok(packageStep);

	// reality missing → NOT_SATISFIED (no fake skip, even if historically success)
	const missing = evaluateStepCheck(packageStep, plan, {});
	assert.equal(missing.status, "NOT_SATISFIED");

	// reality matches → SATISFIED
	const satisfied = evaluateStepCheck(packageStep, plan, {
		installedVersion: "1.0.0",
	});
	assert.equal(satisfied.status, "SATISFIED");

	// reality mismatches → NOT_SATISFIED
	const wrong = evaluateStepCheck(packageStep, plan, {
		installedVersion: "0.9.0",
	});
	assert.equal(wrong.status, "NOT_SATISFIED");
});

test("evaluateStepCheck for config requires materialized required config", () => {
	const modules = [
		moduleFixture({
			moduleRef: "a",
			configSlots: [configSlot("host", { required: true })],
		}),
	];
	const plan = planDeployment({ intent: "install", modules });
	const configStep = plan.steps.find(
		(step) => step.kind === "config" && step.moduleRef === "a",
	);
	assert.ok(configStep);

	assert.equal(evaluateStepCheck(configStep, plan, {}).status, "NOT_SATISFIED");
	assert.equal(
		evaluateStepCheck(configStep, plan, { configValues: {} }).status,
		"NOT_SATISFIED",
	);
	assert.equal(
		evaluateStepCheck(configStep, plan, {
			configValues: { host: "example" },
		}).status,
		"SATISFIED",
	);
});

test("evaluateStepCheck for human requires current verification", () => {
	const modules = [
		moduleFixture({
			moduleRef: "a",
			requirements: [{ kind: "human", action: "perform the login" }],
		}),
	];
	const plan = planDeployment({ intent: "install", modules });
	const humanStep = plan.steps.find((step) => step.kind === "human");
	assert.ok(humanStep);
	assert.equal(humanStep.checkStrategy, CheckStrategy.humanVerified);

	assert.equal(evaluateStepCheck(humanStep, plan, {}).status, "NOT_SATISFIED");
	assert.equal(
		evaluateStepCheck(humanStep, plan, { humanActionVerified: true }).status,
		"SATISFIED",
	);
});

// ---------------------------------------------------------------------------
// upgrade
// ---------------------------------------------------------------------------

test("assessUpgrade reports compatible upgrades with no migration", () => {
	const current = descriptor({ moduleRef: "m" });
	const target = descriptor({ moduleRef: "m", moduleVersion: "1.0.1" });
	const assessment = assessUpgrade(current, target);

	assert.equal(assessment.compatible, true);
	assert.deepEqual(assessment.breakingChanges, []);
	assert.equal(assessment.migrationRequired, false);
});

test("assessUpgrade: template version change alone does not force migration", () => {
	const current = descriptor({ moduleRef: "m", templateVersion: "1.0.0" });
	const target = descriptor({
		moduleRef: "m",
		templateVersion: "2.0.0",
		lifecycle: {
			supported: ["describe", "preflight", "verify", "doctor", "migrate"],
		},
	});
	const assessment = assessUpgrade(current, target);

	assert.equal(assessment.compatible, true);
	assert.equal(assessment.templateVersionChanged, true);
	assert.equal(assessment.migrationDeclared, true);
	assert.equal(assessment.migrationRequired, false);
});

test("assessUpgrade requires migration only when declared and breaking", () => {
	// breaking change + migrate declared → migration required
	const breakingCurrent = descriptor({
		moduleRef: "m",
		provides: [{ contractRef: "cap", version: "1.0.0" }],
	});
	const breakingTarget = descriptor({
		moduleRef: "m",
		provides: [{ contractRef: "cap", version: "2.0.0" }],
		lifecycle: {
			supported: ["describe", "preflight", "verify", "doctor", "migrate"],
		},
	});
	const declared = assessUpgrade(breakingCurrent, breakingTarget);
	assert.equal(declared.compatible, false);
	assert.equal(declared.migrationRequired, true);

	// breaking change but migrate NOT declared → never migrate
	const noMigrateTarget = descriptor({
		moduleRef: "m",
		provides: [{ contractRef: "cap", version: "2.0.0" }],
		lifecycle: { supported: ["describe", "verify", "doctor"] },
	});
	const notDeclared = assessUpgrade(breakingCurrent, noMigrateTarget);
	assert.equal(notDeclared.compatible, false);
	assert.equal(notDeclared.migrationDeclared, false);
	assert.equal(notDeclared.migrationRequired, false);
});

test("planDeployment upgrade includes migrate step only when required, and verify, and no rollback", () => {
	const current = [
		descriptor({
			moduleRef: "m",
			moduleVersion: "1.0.0",
			provides: [{ contractRef: "cap", version: "1.0.0" }],
		}),
	];
	const target = [
		descriptor({
			moduleRef: "m",
			moduleVersion: "2.0.0",
			provides: [{ contractRef: "cap", version: "2.0.0" }],
			lifecycle: {
				supported: ["describe", "preflight", "verify", "doctor", "migrate"],
			},
		}),
	];
	const input: PlanInput = {
		intent: "upgrade",
		currentDescriptors: current,
		targetDescriptors: target,
	};
	const plan = planDeployment(input);

	assert.ok(plan.steps.some((step) => step.kind === "package"));
	assert.ok(
		plan.steps.some(
			(step) =>
				step.kind === "lifecycle" &&
				step.executeStrategy === ExecuteStrategy.lifecycleMigrate,
		),
	);
	assert.ok(plan.verification.length > 0);

	// no transactional rollback step
	const strategies = plan.steps
		.map((step) => step.executeStrategy)
		.filter((strategy): strategy is string => strategy !== undefined);
	assert.ok(!strategies.includes("rollback"));
});

test("planDeployment upgrade with no migration does not emit a migrate step", () => {
	const current = [descriptor({ moduleRef: "m", moduleVersion: "1.0.0" })];
	const target = [
		descriptor({
			moduleRef: "m",
			moduleVersion: "2.0.0",
			lifecycle: {
				supported: ["describe", "preflight", "verify", "doctor", "migrate"],
			},
		}),
	];
	const plan = planDeployment({
		intent: "upgrade",
		currentDescriptors: current,
		targetDescriptors: target,
	});

	assert.ok(
		!plan.steps.some(
			(step) => step.executeStrategy === ExecuteStrategy.lifecycleMigrate,
		),
	);
});

// ---------------------------------------------------------------------------
// repair
// ---------------------------------------------------------------------------

test("planRepair maps facts to declared capabilities only", () => {
	const modules = [
		moduleFixture({
			moduleRef: "svc",
			configSlots: [configSlot("host", { required: true })],
			lifecycle: ["describe", "verify", "doctor", "start"],
		}),
	];
	const facts: RepairFact[] = [
		{ moduleRef: "svc", code: "CONFIG_MISSING", message: "host missing" },
		{ moduleRef: "svc", code: "LIFECYCLE_NOT_RUNNING", message: "not running" },
	];
	const plan = planRepair({ modules, facts });

	assert.ok(
		plan.steps.some(
			(step) => step.kind === "config" && step.moduleRef === "svc",
		),
	);
	assert.ok(
		plan.steps.some(
			(step) =>
				step.kind === "lifecycle" &&
				step.executeStrategy === ExecuteStrategy.lifecycleStart,
		),
	);
});

test("planRepair emits human step for actionRequired and no arbitrary shell fixes", () => {
	const modules = [moduleFixture({ moduleRef: "m" })];
	const facts: RepairFact[] = [
		{ moduleRef: "m", code: "ACTION_REQUIRED", message: "login required" },
		// unmappable fact must not produce any step
		{ moduleRef: "m", code: "DEPENDENCY_UNRESOLVED", message: "no provider" },
	];
	const plan = planRepair({ modules, facts });

	assert.ok(plan.steps.some((step) => step.kind === "human"));
	assert.ok(!plan.steps.some((step) => step.kind === "package"));

	// every execute strategy is a declared primitive token (no shell invention)
	const strategies = plan.steps
		.map((step) => step.executeStrategy)
		.filter((strategy): strategy is string => strategy !== undefined);
	for (const strategy of strategies) {
		assert.ok(
			Object.values(ExecuteStrategy).includes(
				strategy as (typeof ExecuteStrategy)[keyof typeof ExecuteStrategy],
			),
		);
	}
});

test("planRepair ignores lifecycle facts for modules without that primitive", () => {
	const modules = [
		moduleFixture({
			moduleRef: "lib",
			kind: "library",
			lifecycle: ["describe", "verify", "doctor"],
		}),
	];
	const facts: RepairFact[] = [
		{ moduleRef: "lib", code: "LIFECYCLE_NOT_RUNNING", message: "not running" },
	];
	const plan = planRepair({ modules, facts });

	assert.ok(
		!plan.steps.some(
			(step) => step.kind === "lifecycle" && step.moduleRef === "lib",
		),
	);
});
