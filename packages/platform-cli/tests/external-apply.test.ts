import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type {
	ConfigSlot,
	ModuleOperationResult,
} from "@tomflow/proflow-module-contract";

import { applyPlan } from "../src/apply/index.ts";
import type { DeploymentPlan, ResolvedModule } from "../src/contracts.ts";
import type { ModuleCatalog, ModuleSource } from "../src/modules.ts";
import { type WorkspacePaths, workspacePaths } from "../src/paths.ts";
import { loadDeploymentState, savePlan } from "../src/persistence/index.ts";
import { type PlanInput, planDeployment } from "../src/planner/index.ts";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

async function tmpWorkspace(): Promise<{
	root: string;
	paths: WorkspacePaths;
	cleanup(): Promise<void>;
}> {
	const root = await mkdtemp(join(tmpdir(), "proflow-cli-external-"));
	return {
		root,
		paths: workspacePaths(root),
		async cleanup() {
			await rm(root, { recursive: true, force: true });
		},
	};
}

function configSlot(
	key: string,
	options: { type?: ConfigSlot["type"]; required?: boolean } = {},
): ConfigSlot {
	return {
		key,
		type: options.type ?? "string",
		required: options.required ?? false,
		description: `slot ${key}`,
		...(options.type === "secretRef" ? { sensitive: true } : {}),
	};
}

const NO_START_LIFECYCLE = [
	"describe",
	"preflight",
	"status",
	"verify",
	"doctor",
] as const;

const TUNNEL_LIFECYCLE = [
	"describe",
	"preflight",
	"status",
	"verify",
	"doctor",
	"start",
	"stop",
	"restart",
] as const;

function externalResourceFixture(input: {
	moduleRef: string;
	lifecycle?: string[];
	configSlots?: ResolvedModule["configSlots"];
	requirements?: ResolvedModule["requirements"];
}): ResolvedModule {
	return {
		moduleRef: input.moduleRef,
		packageName: `@tomflow/proflow-${input.moduleRef}`,
		moduleVersion: "1.0.0",
		kind: "external-resource",
		provides: [],
		requires: [],
		requirements: input.requirements ?? [],
		configSlots: input.configSlots ?? [],
		lifecycle: input.lifecycle ?? [...NO_START_LIFECYCLE],
		verification: {
			checks: [
				{ id: "status", description: "Observed status", lifecycle: "status" },
			],
		},
		effects: [],
		source: { type: "workspace" },
	};
}

function ok(moduleRef: string, data?: unknown): ModuleOperationResult {
	return {
		contract: "deployment.result.v1",
		ok: true,
		status: "SUCCEEDED",
		moduleRef,
		moduleVersion: "1.0.0",
		...(data === undefined ? {} : { data }),
	};
}

function failed(moduleRef: string, message: string): ModuleOperationResult {
	return {
		contract: "deployment.result.v1",
		ok: false,
		status: "FAILED",
		moduleRef,
		moduleVersion: "1.0.0",
		error: { code: "APPLY_FAILED", message, retryable: false },
	};
}

function blocked(moduleRef: string): ModuleOperationResult {
	return {
		contract: "deployment.result.v1",
		ok: false,
		status: "BLOCKED",
		moduleRef,
		moduleVersion: "1.0.0",
	};
}

function actionRequired(
	moduleRef: string,
	action: string,
	description: string,
): ModuleOperationResult {
	return {
		contract: "deployment.result.v1",
		ok: false,
		status: "ACTION_REQUIRED",
		moduleRef,
		moduleVersion: "1.0.0",
		actionRequired: { action, description },
	};
}

interface FakeAdapterSpec {
	module: ResolvedModule;
	primitives: Record<string, () => unknown>;
}

interface Recording {
	calls: { moduleRef: string; primitive: string }[];
	catalog: ModuleCatalog;
}

function makeCatalog(specs: FakeAdapterSpec[]): Recording {
	const calls: { moduleRef: string; primitive: string }[] = [];
	const byPackage = new Map(
		specs.map((spec) => [spec.module.packageName, spec] as const),
	);
	const catalog: ModuleCatalog = {
		async sources() {
			return [];
		},
		async loadDescriptor() {
			return {};
		},
		async loadAdapter(source: ModuleSource) {
			const spec = byPackage.get(source.packageName);
			if (spec === undefined) return { behaviorAdapter: {} };
			const wrapped: Record<string, unknown> = {};
			for (const [primitive, fn] of Object.entries(spec.primitives)) {
				wrapped[primitive] = () => {
					calls.push({ moduleRef: spec.module.moduleRef, primitive });
					return fn();
				};
			}
			return { behaviorAdapter: wrapped };
		},
	};
	return { calls, catalog };
}

// ---------------------------------------------------------------------------
// planner: no fake start for status/verify-only external resources
// ---------------------------------------------------------------------------

test("install plan generates no start mutation step for status/verify-only external resources", () => {
	const modules = [
		externalResourceFixture({
			moduleRef: "chatgpt-carrier",
			requirements: [
				{
					kind: "human",
					action: "Materialize and verify the Custom GPT carrier",
				},
			],
		}),
		externalResourceFixture({
			moduleRef: "chrome-runtime",
			requirements: [
				{
					kind: "human",
					action:
						"Load and verify the unpacked MV3 extension in the real Chrome profile",
				},
			],
		}),
		externalResourceFixture({
			moduleRef: "model-provider-api",
			configSlots: [
				configSlot("providerBaseUrl", { type: "url", required: true }),
			],
		}),
	];

	for (const module of modules) {
		const plan: DeploymentPlan = planDeployment({
			intent: "install",
			modules: [module],
		});
		assert.ok(
			plan.steps.every((step) => step.kind !== "external-resource"),
			`${module.moduleRef} must not generate an external-resource activation step`,
		);
		assert.ok(
			plan.steps.every(
				(step) => step.executeStrategy !== "external-resource:configure",
			),
			`${module.moduleRef} must not generate a configure strategy`,
		);
	}
});

test("install plan still generates an activation step for a start-capable external resource", () => {
	const tunnel = externalResourceFixture({
		moduleRef: "dev-tunnel",
		lifecycle: [...TUNNEL_LIFECYCLE],
	});
	const plan: DeploymentPlan = planDeployment({
		intent: "install",
		modules: [tunnel],
	});
	assert.ok(
		plan.steps.some(
			(step) =>
				step.kind === "external-resource" &&
				step.executeStrategy === "external-resource:configure",
		),
		"a start-capable external resource must generate its activation step",
	);
});

// ---------------------------------------------------------------------------
// execute: structured lifecycle results are preserved, never downgraded
// ---------------------------------------------------------------------------

test("external-resource start reporting ACTION_REQUIRED keeps ACTION_REQUIRED and persists a structured pending action", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const tunnel = externalResourceFixture({
			moduleRef: "dev-tunnel",
			lifecycle: [...TUNNEL_LIFECYCLE],
			configSlots: [
				configSlot("publicBaseUrl", { type: "url", required: true }),
			],
		});
		const plan: DeploymentPlan = planDeployment({
			intent: "install",
			modules: [tunnel],
			config: { "dev-tunnel": { publicBaseUrl: "https://tunnel.example" } },
		});
		await savePlan(paths, plan);

		const { catalog } = makeCatalog([
			{
				module: tunnel,
				primitives: {
					status: () => ({
						result: ok("dev-tunnel", { resourceConfigured: false }),
						observedEffects: [],
					}),
					start: () => ({
						result: actionRequired(
							"dev-tunnel",
							"login",
							"Complete Microsoft Dev Tunnel login",
						),
						observedEffects: [],
					}),
				},
			},
		]);
		const current: PlanInput = {
			intent: "install",
			modules: [tunnel],
			config: { "dev-tunnel": { publicBaseUrl: "https://tunnel.example" } },
		};

		const result = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			current,
		});

		assert.equal(result.outcome, "ACTION_REQUIRED");
		const tunnelStep = result.stepResults.find(
			(step) =>
				step.moduleRef === "dev-tunnel" && step.status === "ACTION_REQUIRED",
		);
		assert.ok(
			tunnelStep,
			"the external-resource start must report ACTION_REQUIRED",
		);

		const state = await loadDeploymentState(paths);
		assert.equal(state?.pendingActions.length, 1);
		const pending = state?.pendingActions[0];
		assert.equal(pending?.planRef, plan.planRef);
		assert.equal(pending?.moduleRef, "dev-tunnel");
		assert.equal(pending?.action, "login");
		assert.equal(pending?.description, "Complete Microsoft Dev Tunnel login");
		assert.ok((pending?.stepRef ?? "").length > 0);
		assert.deepEqual(state?.lastAppliedPlans ?? [], []);
	} finally {
		await cleanup();
	}
});

test("external-resource start reporting BLOCKED stops the apply with BLOCKED", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const tunnel = externalResourceFixture({
			moduleRef: "dev-tunnel",
			lifecycle: [...TUNNEL_LIFECYCLE],
		});
		const plan: DeploymentPlan = planDeployment({
			intent: "install",
			modules: [tunnel],
		});
		await savePlan(paths, plan);

		const { catalog } = makeCatalog([
			{
				module: tunnel,
				primitives: {
					status: () => ({
						result: ok("dev-tunnel", { resourceConfigured: false }),
						observedEffects: [],
					}),
					start: () => ({
						result: blocked("dev-tunnel"),
						observedEffects: [],
					}),
				},
			},
		]);
		const current: PlanInput = { intent: "install", modules: [tunnel] };

		const result = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			current,
		});

		assert.equal(result.outcome, "BLOCKED");
		assert.equal(result.stepResults.at(-1)?.moduleRef, "dev-tunnel");

		const state = await loadDeploymentState(paths);
		assert.deepEqual(state?.lastAppliedPlans ?? [], []);
	} finally {
		await cleanup();
	}
});

test("external-resource start reporting FAILED stops the apply with FAILED", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const tunnel = externalResourceFixture({
			moduleRef: "dev-tunnel",
			lifecycle: [...TUNNEL_LIFECYCLE],
		});
		const plan: DeploymentPlan = planDeployment({
			intent: "install",
			modules: [tunnel],
		});
		await savePlan(paths, plan);

		const { catalog } = makeCatalog([
			{
				module: tunnel,
				primitives: {
					status: () => ({
						result: ok("dev-tunnel", { resourceConfigured: false }),
						observedEffects: [],
					}),
					start: () => ({
						result: failed("dev-tunnel", "start exploded"),
						observedEffects: [],
					}),
				},
			},
		]);
		const current: PlanInput = { intent: "install", modules: [tunnel] };

		const result = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			current,
		});

		assert.equal(result.outcome, "FAILED");
		assert.equal(result.stepResults.at(-1)?.status, "FAILED");

		const state = await loadDeploymentState(paths);
		assert.deepEqual(state?.lastAppliedPlans ?? [], []);
	} finally {
		await cleanup();
	}
});

test("a pending action for an external-resource step is cleared once the step is satisfied on resume", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const tunnel = externalResourceFixture({
			moduleRef: "dev-tunnel",
			lifecycle: [...TUNNEL_LIFECYCLE],
		});
		const plan: DeploymentPlan = planDeployment({
			intent: "install",
			modules: [tunnel],
		});
		await savePlan(paths, plan);

		let configured = false;
		const { catalog } = makeCatalog([
			{
				module: tunnel,
				primitives: {
					status: () => ({
						result: ok("dev-tunnel", { resourceConfigured: configured }),
						observedEffects: [],
					}),
					start: () => ({
						result: actionRequired(
							"dev-tunnel",
							"login",
							"Complete Microsoft Dev Tunnel login",
						),
						observedEffects: [],
					}),
				},
			},
		]);
		const current: PlanInput = { intent: "install", modules: [tunnel] };

		const first = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			current,
		});
		assert.equal(first.outcome, "ACTION_REQUIRED");
		assert.equal((await loadDeploymentState(paths))?.pendingActions.length, 1);

		// reality now reports the resource configured → resume skips the step
		configured = true;
		const resumed = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			current,
		});
		assert.equal(resumed.outcome, "COMPLETE");

		const state = await loadDeploymentState(paths);
		assert.equal(
			state?.pendingActions.length,
			0,
			"the pending action must be cleared once the step is satisfied",
		);
		assert.deepEqual(
			state?.lastAppliedPlans.map((entry) => entry.planRef),
			[plan.planRef],
		);
	} finally {
		await cleanup();
	}
});
