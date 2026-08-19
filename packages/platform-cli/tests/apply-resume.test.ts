import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	type ConfigSlot,
	type ModuleDescriptor,
	type ModuleOperationResult,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";
import { workspaceResidentDriver } from "../src/apply/driver.ts";
import { applyPlan, type PackageManagerDriver } from "../src/apply/index.ts";
import type { DeploymentPlan, ResolvedModule } from "../src/contracts.ts";
import { PlatformError } from "../src/errors.ts";
import type { ModuleCatalog, ModuleSource } from "../src/modules.ts";
import { type WorkspacePaths, workspacePaths } from "../src/paths.ts";
import {
	appendVerification,
	loadConfig,
	loadDeploymentState,
	materializeConfig,
	savePlan,
} from "../src/persistence/index.ts";
import { type PlanInput, planDeployment } from "../src/planner/index.ts";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

async function tmpWorkspace(): Promise<{
	root: string;
	paths: WorkspacePaths;
	cleanup(): Promise<void>;
}> {
	const root = await mkdtemp(join(tmpdir(), "proflow-cli-apply-"));
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

function moduleFixture(input: {
	moduleRef: string;
	kind?: ResolvedModule["kind"];
	moduleVersion?: string;
	configSlots?: ResolvedModule["configSlots"];
	requirements?: ResolvedModule["requirements"];
	lifecycle?: string[];
}): ResolvedModule {
	return {
		moduleRef: input.moduleRef,
		packageName: `@tomflow/proflow-${input.moduleRef}`,
		moduleVersion: input.moduleVersion ?? "1.0.0",
		kind: input.kind ?? "service",
		installClass: "optional",
		identity: {
			domain: "deployment-governance",
			summary: "Platform CLI test fixture",
		},
		documentation: [],
		provides: [],
		requires: [],
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

function descriptorFixture(input: {
	moduleRef: string;
	moduleVersion: string;
	configSlots?: ConfigSlot[];
}): ModuleDescriptor {
	return parseModuleDescriptor({
		contract: "module",
		contractVersion: "1.0.0",
		moduleRef: input.moduleRef,
		packageName: `@tomflow/proflow-${input.moduleRef}`,
		moduleVersion: input.moduleVersion,
		kind: "library",
		installClass: "optional",
		identity: {
			domain: "deployment-governance",
			summary: "Platform CLI apply refresh fixture",
		},
		templateVersion: "1.0.0",
		platformCompatibility: ">=1.0.0 <2.0.0",
		provides: [],
		requires: [],
		requirements: [],
		configSlots: input.configSlots ?? [],
		lifecycle: { supported: ["describe", "preflight", "verify", "doctor"] },
		verification: {
			checks: [
				{ id: "health", description: "Observed health", lifecycle: "verify" },
			],
		},
		effects: [],
		documentation: [],
	});
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
	materializeProductionConfig?: (input: {
		moduleRef: string;
		config: Record<string, string>;
		workspaceRoot: string;
	}) => unknown;
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
			return {
				behaviorAdapter: wrapped,
				...(spec.materializeProductionConfig === undefined
					? {}
					: {
							materializeProductionConfig: spec.materializeProductionConfig,
						}),
			};
		},
	};
	return { calls, catalog };
}

interface FakeDriver {
	driver: PackageManagerDriver;
	installed: Map<string, string>;
	installCounts: Map<string, number>;
	upgradeCounts: Map<string, number>;
}

function makeFakeDriver(): FakeDriver {
	const installed = new Map<string, string>();
	const installCounts = new Map<string, number>();
	const upgradeCounts = new Map<string, number>();
	const driver: PackageManagerDriver = {
		async observeInstalledVersion(module) {
			return installed.get(module.moduleRef);
		},
		async install(module) {
			installed.set(module.moduleRef, module.moduleVersion);
			installCounts.set(
				module.moduleRef,
				(installCounts.get(module.moduleRef) ?? 0) + 1,
			);
		},
		async upgrade(module) {
			installed.set(module.moduleRef, module.moduleVersion);
			upgradeCounts.set(
				module.moduleRef,
				(upgradeCounts.get(module.moduleRef) ?? 0) + 1,
			);
		},
		async remove(module) {
			installed.delete(module.moduleRef);
		},
	};
	return { driver, installed, installCounts, upgradeCounts };
}

// ---------------------------------------------------------------------------
// apply / resume
// ---------------------------------------------------------------------------

test("apply completes when every step is satisfied and records the applied plan", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({ moduleRef: "svc" });
		const plan: DeploymentPlan = planDeployment({
			intent: "install",
			modules: [svc],
		});
		await savePlan(paths, plan);
		const { catalog } = makeCatalog([]);

		const result = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			driver: workspaceResidentDriver(),
			current: { intent: "install", modules: [svc] },
		});

		assert.equal(result.outcome, "COMPLETE");
		assert.equal(result.planRef, plan.planRef);
		assert.equal(result.stepResults.length, 1);
		assert.equal(result.stepResults[0]?.status, "SKIP");

		const state = await loadDeploymentState(paths);
		assert.deepEqual(
			state?.lastAppliedPlans.map((entry) => entry.planRef),
			[plan.planRef],
		);
		assert.deepEqual(
			state?.selectedModules.map((fact) => fact.moduleRef),
			["svc"],
		);
	} finally {
		await cleanup();
	}
});

test("apply executes a package step and re-checks the postcondition", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({ moduleRef: "svc" });
		const plan: DeploymentPlan = planDeployment({
			intent: "install",
			modules: [svc],
		});
		await savePlan(paths, plan);
		const { catalog } = makeCatalog([]);
		const fake = makeFakeDriver();

		const result = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			current: { intent: "install", modules: [svc] },
			driver: fake.driver,
		});

		assert.equal(result.outcome, "COMPLETE");
		assert.equal(result.stepResults[0]?.status, "EXECUTED");
		assert.equal(fake.installCounts.get("svc"), 1);
		assert.equal(fake.installed.get("svc"), "1.0.0");
	} finally {
		await cleanup();
	}
});

test("CP-DPL-CLI-02 resume re-observes reality and skips already-satisfied steps without re-execution", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({ moduleRef: "svc" });
		const plan: DeploymentPlan = planDeployment({
			intent: "install",
			modules: [svc],
		});
		await savePlan(paths, plan);
		const { catalog } = makeCatalog([]);
		const fake = makeFakeDriver();
		const current: PlanInput = { intent: "install", modules: [svc] };

		const first = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			current,
			driver: fake.driver,
		});
		assert.equal(first.outcome, "COMPLETE");
		assert.equal(first.stepResults[0]?.status, "EXECUTED");
		assert.equal(fake.installCounts.get("svc"), 1);

		// same planRef again, reality now already satisfied → SKIP, no re-install
		const second = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			current,
			driver: fake.driver,
		});
		assert.equal(second.outcome, "COMPLETE");
		assert.equal(second.stepResults[0]?.status, "SKIP");
		assert.equal(fake.installCounts.get("svc"), 1);
	} finally {
		await cleanup();
	}
});

test("configure failure does not commit authoritative public config before the module materializer succeeds", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({
			moduleRef: "svc",
			configSlots: [configSlot("endpoint", { required: true })],
		});
		const current: PlanInput = {
			intent: "configure",
			modules: [svc],
			config: { svc: { endpoint: "rejected-target" } },
		};
		const plan = planDeployment(current);
		await savePlan(paths, plan);
		const { catalog } = makeCatalog([
			{
				module: svc,
				primitives: {},
				materializeProductionConfig() {
					throw new Error("module-owned config rejected");
				},
			},
		]);

		const result = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			current,
			driver: workspaceResidentDriver(),
		});

		assert.equal(result.outcome, "FAILED");
		assert.match(result.stepResults[0]?.message ?? "", /config rejected/);
		assert.equal(await loadConfig(paths, "svc"), undefined);
	} finally {
		await cleanup();
	}
});

test("configure resume re-executes when every required key exists but persisted values do not match the immutable target", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({
			moduleRef: "svc",
			configSlots: [configSlot("endpoint", { required: true })],
		});
		const current: PlanInput = {
			intent: "configure",
			modules: [svc],
			config: { svc: { endpoint: "planned-target" } },
		};
		const plan = planDeployment(current);
		await savePlan(paths, plan);
		await materializeConfig(paths, {
			moduleRef: "svc",
			values: { endpoint: "wrong-but-present" },
			secretRefs: [],
		});
		let materializeCalls = 0;
		const { catalog } = makeCatalog([
			{
				module: svc,
				primitives: {},
				materializeProductionConfig({ config }) {
					materializeCalls += 1;
					assert.equal(config.endpoint, "planned-target");
				},
			},
		]);

		const result = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			current,
			driver: workspaceResidentDriver(),
		});

		assert.equal(result.outcome, "COMPLETE");
		assert.equal(result.stepResults[0]?.status, "EXECUTED");
		assert.equal(materializeCalls, 1);
		assert.equal(
			(await loadConfig(paths, "svc"))?.publicValues.endpoint,
			"planned-target",
		);
	} finally {
		await cleanup();
	}
});

test("upgrade refreshes the catalog after package mutation before target config materialization", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const slot = configSlot("endpoint", { required: true });
		const currentDescriptor = descriptorFixture({
			moduleRef: "svc",
			moduleVersion: "1.0.0",
			configSlots: [slot],
		});
		const targetDescriptor = descriptorFixture({
			moduleRef: "svc",
			moduleVersion: "2.0.0",
			configSlots: [slot],
		});
		const current: PlanInput = {
			intent: "upgrade",
			currentDescriptors: [currentDescriptor],
			targetDescriptors: [targetDescriptor],
			config: { svc: { endpoint: "target-endpoint" } },
		};
		const plan = planDeployment(current);
		await savePlan(paths, plan);

		const targetModule = plan.resolvedModules[0];
		assert.ok(targetModule);
		let oldMaterializerCalls = 0;
		let targetMaterializerCalls = 0;
		const oldCatalog = makeCatalog([
			{
				module: targetModule,
				primitives: {},
				materializeProductionConfig() {
					oldMaterializerCalls += 1;
				},
			},
		]).catalog;
		const targetCatalog = makeCatalog([
			{
				module: targetModule,
				primitives: {},
				materializeProductionConfig({ config }) {
					targetMaterializerCalls += 1;
					assert.equal(config.endpoint, "target-endpoint");
				},
			},
		]).catalog;
		const fake = makeFakeDriver();
		fake.installed.set("svc", "1.0.0");

		const result = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog: oldCatalog,
			current,
			driver: fake.driver,
			refreshCatalog: async () => targetCatalog,
		});

		assert.equal(result.outcome, "COMPLETE");
		assert.equal(fake.upgradeCounts.get("svc"), 1);
		assert.equal(oldMaterializerCalls, 0);
		assert.equal(targetMaterializerCalls, 1);
	} finally {
		await cleanup();
	}
});

test("CP-DPL-CLI-02 a stale plan is BLOCKED and never applied", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({ moduleRef: "svc" });
		const plan: DeploymentPlan = planDeployment({
			intent: "install",
			modules: [svc],
		});
		await savePlan(paths, plan);
		const { catalog } = makeCatalog([]);

		// stable assumption changed: target version moved → stale
		const upgraded = moduleFixture({
			moduleRef: "svc",
			moduleVersion: "2.0.0",
		});
		const result = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			driver: workspaceResidentDriver(),
			current: { intent: "install", modules: [upgraded] },
		});

		assert.equal(result.outcome, "BLOCKED");
		assert.equal(result.stepResults.length, 0);

		const state = await loadDeploymentState(paths);
		assert.deepEqual(state?.lastAppliedPlans ?? [], []);
	} finally {
		await cleanup();
	}
});

test("a missing plan throws PLAN_NOT_FOUND", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const { catalog } = makeCatalog([]);
		const svc = moduleFixture({ moduleRef: "svc" });

		await assert.rejects(
			() =>
				applyPlan({
					paths,
					planRef: "plan-missing",
					catalog,
					driver: workspaceResidentDriver(),
					current: { intent: "install", modules: [svc] },
				}),
			(error: unknown): boolean =>
				error instanceof PlatformError && error.code === "PLAN_NOT_FOUND",
		);
	} finally {
		await cleanup();
	}
});

test("a human step persists a pendingAction, returns ACTION_REQUIRED, and stops", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const first = moduleFixture({
			moduleRef: "first",
			kind: "browser-extension",
			requirements: [{ kind: "human", action: "load the extension" }],
			lifecycle: ["status"],
		});
		const second = moduleFixture({ moduleRef: "second" });
		const plan: DeploymentPlan = planDeployment({
			intent: "install",
			modules: [first, second],
		});
		await savePlan(paths, plan);

		const { catalog } = makeCatalog([
			{
				module: first,
				primitives: {
					status: () => ({
						result: ok("first", { humanActionVerified: false }),
						observedEffects: [],
					}),
				},
			},
		]);
		const current: PlanInput = { intent: "install", modules: [first, second] };

		const result = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			driver: workspaceResidentDriver(),
			current,
		});

		assert.equal(result.outcome, "ACTION_REQUIRED");
		// package(first) SKIP, human(first) ACTION_REQUIRED, package(second) not reached
		assert.deepEqual(
			result.stepResults.map((step) => step.status),
			["SKIP", "ACTION_REQUIRED"],
		);

		const state = await loadDeploymentState(paths);
		assert.equal(state?.pendingActions.length, 1);
		assert.equal(state?.pendingActions[0]?.planRef, plan.planRef);
		assert.ok((state?.pendingActions[0]?.action ?? "").length > 0);
		assert.deepEqual(state?.lastAppliedPlans ?? [], []);
	} finally {
		await cleanup();
	}
});

test("resume after ACTION_REQUIRED skips the now-verified human step and completes", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const first = moduleFixture({
			moduleRef: "first",
			kind: "browser-extension",
			requirements: [{ kind: "human", action: "load the extension" }],
			lifecycle: ["status"],
		});
		const second = moduleFixture({ moduleRef: "second" });
		const plan: DeploymentPlan = planDeployment({
			intent: "install",
			modules: [first, second],
		});
		await savePlan(paths, plan);

		const { catalog } = makeCatalog([
			{
				module: first,
				primitives: {
					status: () => ({
						result: ok("first"),
						observedEffects: [],
					}),
				},
			},
		]);
		const current: PlanInput = { intent: "install", modules: [first, second] };

		const interrupted = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			driver: workspaceResidentDriver(),
			current,
		});
		assert.equal(interrupted.outcome, "ACTION_REQUIRED");

		// The production verification record is the durable current-reality proof
		// that the human prerequisite was completed; status need not expose a
		// package-specific humanActionVerified boolean.
		await appendVerification(paths, {
			verificationRef: "verify-first-human-pass",
			moduleRef: "first",
			moduleVersion: "1.0.0",
			result: "PASS",
			summary: "human prerequisite verified",
			evidenceRefs: ["check:human-prerequisite:PASS"],
			verifiedAt: new Date().toISOString(),
		});
		const resumed = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			driver: workspaceResidentDriver(),
			current,
		});

		assert.equal(resumed.outcome, "COMPLETE");
		const humanStep = resumed.stepResults.find(
			(step) => step.moduleRef === "first" && step.status === "SKIP",
		);
		assert.ok(humanStep, "the verified human step must be SKIPped on resume");

		const state = await loadDeploymentState(paths);
		assert.deepEqual(
			state?.lastAppliedPlans.map((entry) => entry.planRef),
			[plan.planRef],
		);
	} finally {
		await cleanup();
	}
});

test("a failing lifecycle step stops the apply, records FAILED, and persists nothing as applied", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({
			moduleRef: "svc",
			kind: "service",
			lifecycle: ["describe", "verify", "doctor", "status", "uninstall"],
		});
		const plan: DeploymentPlan = planDeployment({
			intent: "uninstall",
			modules: [svc],
		});
		await savePlan(paths, plan);

		const { calls, catalog } = makeCatalog([
			{
				module: svc,
				primitives: {
					status: () => ({
						result: ok("svc", { state: "RUNNING" }),
						observedEffects: [],
					}),
					uninstall: () => ({
						result: failed("svc", "uninstall exploded"),
						observedEffects: [],
					}),
				},
			},
		]);
		const fake = makeFakeDriver();
		fake.installed.set("svc", "1.0.0");

		const result = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			driver: fake.driver,
			current: { intent: "uninstall", modules: [svc] },
		});

		assert.equal(result.outcome, "FAILED");
		assert.deepEqual(
			result.stepResults.map((step) => step.status),
			["FAILED"],
		);
		assert.equal(
			calls.filter((call) => call.primitive === "uninstall").length,
			1,
		);
		assert.equal(fake.installed.has("svc"), true);

		const state = await loadDeploymentState(paths);
		assert.deepEqual(state?.lastAppliedPlans ?? [], []);
	} finally {
		await cleanup();
	}
});

test("lifecycle uninstall accepts the owner SUCCEEDED result when post-uninstall status is unbound", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({
			moduleRef: "svc",
			kind: "service",
			lifecycle: ["status", "uninstall"],
		});
		const plan: DeploymentPlan = planDeployment({
			intent: "uninstall",
			modules: [svc],
		});
		await savePlan(paths, plan);

		const { calls, catalog } = makeCatalog([
			{
				module: svc,
				primitives: {
					status: () => ({
						result: actionRequired(
							"svc",
							"bind-runtime",
							"No service is bound",
						),
						observedEffects: [],
					}),
					uninstall: () => ({
						result: ok("svc"),
						observedEffects: [],
					}),
				},
			},
		]);
		const fake = makeFakeDriver();
		fake.installed.set("svc", "1.0.0");

		const result = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			driver: fake.driver,
			current: { intent: "uninstall", modules: [svc] },
		});

		assert.equal(result.outcome, "COMPLETE");
		assert.deepEqual(
			result.stepResults.map((step) => step.status),
			["EXECUTED", "EXECUTED"],
		);
		assert.equal(
			calls.filter((call) => call.primitive === "uninstall").length,
			1,
		);
		assert.equal(
			calls.filter((call) => call.primitive === "status").length,
			1,
			"unbound status is observed before the mutation but not reinterpreted after owner-confirmed uninstall",
		);
		assert.equal(fake.installed.has("svc"), false);
	} finally {
		await cleanup();
	}
});

test("historical success with missing reality is re-executed, not faked as skip", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({ moduleRef: "svc" });
		const plan: DeploymentPlan = planDeployment({
			intent: "install",
			modules: [svc],
		});
		await savePlan(paths, plan);
		const { catalog } = makeCatalog([]);
		const fake = makeFakeDriver();
		const current: PlanInput = { intent: "install", modules: [svc] };

		const first = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			current,
			driver: fake.driver,
		});
		assert.equal(first.outcome, "COMPLETE");
		assert.equal(fake.installCounts.get("svc"), 1);

		// reality is now missing despite a recorded success → no fake skip
		fake.installed.delete("svc");
		const second = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			current,
			driver: fake.driver,
		});

		assert.equal(second.outcome, "COMPLETE");
		assert.equal(second.stepResults[0]?.status, "EXECUTED");
		assert.equal(fake.installCounts.get("svc"), 2);
	} finally {
		await cleanup();
	}
});

test("config step materializes real config and its postcondition reads from disk", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({
			moduleRef: "svc",
			configSlots: [configSlot("host", { required: true })],
		});
		const plan: DeploymentPlan = planDeployment({
			intent: "install",
			modules: [svc],
			config: { svc: { host: "example.com" } },
		});
		await savePlan(paths, plan);
		const { catalog } = makeCatalog([]);
		const fake = makeFakeDriver();
		const current: PlanInput = {
			intent: "install",
			modules: [svc],
			config: { svc: { host: "example.com" } },
		};

		const result = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			current,
			driver: fake.driver,
		});

		assert.equal(result.outcome, "COMPLETE");
		const configStep = result.stepResults.find(
			(step) => step.moduleRef === "svc" && step.status === "EXECUTED",
		);
		assert.ok(configStep, "the config step must be EXECUTED");

		const config = await loadConfig(paths, "svc");
		assert.equal(config?.publicValues.host, "example.com");
	} finally {
		await cleanup();
	}
});

test("external-resource configure dispatches the start primitive and observes resourceConfigured", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const tunnel = moduleFixture({
			moduleRef: "tunnel",
			kind: "external-resource",
			lifecycle: [
				"describe",
				"preflight",
				"status",
				"verify",
				"doctor",
				"start",
			],
		});
		const plan: DeploymentPlan = planDeployment({
			intent: "install",
			modules: [tunnel],
		});
		await savePlan(paths, plan);

		let configured = false;
		const { calls, catalog } = makeCatalog([
			{
				module: tunnel,
				primitives: {
					status: () => ({
						result: ok("tunnel", { resourceConfigured: configured }),
						observedEffects: [],
					}),
					start: () => {
						configured = true;
						return { result: ok("tunnel"), observedEffects: [] };
					},
				},
			},
		]);

		const result = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			driver: workspaceResidentDriver(),
			current: { intent: "install", modules: [tunnel] },
		});

		assert.equal(result.outcome, "COMPLETE");
		const executed = result.stepResults.find(
			(step) => step.moduleRef === "tunnel" && step.status === "EXECUTED",
		);
		assert.ok(executed, "the external-resource step must be EXECUTED");
		assert.equal(calls.filter((call) => call.primitive === "start").length, 1);
	} finally {
		await cleanup();
	}
});
