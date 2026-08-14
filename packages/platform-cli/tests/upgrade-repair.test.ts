import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	type DeploymentError,
	type ModuleDescriptor,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";

import type { ResolvedModule } from "../src/contracts.ts";
import type { DoctorReport } from "../src/doctor/doctor.ts";
import {
	diagnoseRepair,
	planRepair,
	type RepairFact,
	repairFactsFromDoctor,
} from "../src/planner/repair.ts";
import { ExecuteStrategy } from "../src/planner/steps.ts";
import { resolveTargetCatalog } from "../src/planner/target-catalog.ts";
import { planUpgrade } from "../src/planner/upgrade.ts";

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
	configSlots?: ResolvedModule["configSlots"];
	requirements?: ResolvedModule["requirements"];
	lifecycle?: string[];
}): ResolvedModule {
	return {
		moduleRef: input.moduleRef,
		packageName: `@tomflow/proflow-${input.moduleRef}`,
		moduleVersion: "1.0.0",
		kind: input.kind ?? "service",
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

function configSlot(
	key: string,
	options: { required?: boolean } = {},
): ResolvedModule["configSlots"][number] {
	return {
		key,
		type: "string",
		required: options.required ?? false,
		description: `slot ${key}`,
	};
}

function doctorError(
	code: DeploymentError["code"],
	message: string,
): DeploymentError {
	return { code, message, retryable: true };
}

function doctorReport(input: {
	moduleRef: string;
	status: DoctorReport["status"];
	errors?: DoctorReport["errors"];
	nextAction?: DoctorReport["nextAction"];
}): DoctorReport {
	return {
		moduleRef: input.moduleRef,
		moduleVersion: "1.0.0",
		status: input.status,
		checks: [],
		errors: input.errors ?? [],
		evidenceRefs: [],
		nextAction: input.nextAction ?? { kind: "none" },
		observedEffects: [],
	};
}

async function tempWorkspace(): Promise<string> {
	return mkdtemp(join(tmpdir(), "proflow-target-"));
}

async function writeTargetWorkspace(
	root: string,
	moduleRef: string,
	moduleVersion: string,
): Promise<void> {
	await writeFile(
		join(root, "pnpm-workspace.yaml"),
		'packages:\n  - "packages/*"\n',
	);
	const packageName = `@tomflow/proflow-${moduleRef}`;
	const pkgDir = join(root, "packages", moduleRef);
	await mkdir(join(pkgDir, "deployment"), { recursive: true });
	await writeFile(
		join(pkgDir, "package.json"),
		JSON.stringify({ name: packageName, version: moduleVersion }),
	);
	await writeFile(
		join(pkgDir, "deployment", "descriptor.ts"),
		`export const descriptor = ${JSON.stringify(
			descriptor({ moduleRef, packageName, moduleVersion }),
		)};\n`,
	);
	await writeFile(
		join(pkgDir, "deployment", "adapter.ts"),
		"export const behaviorAdapter = {};\n",
	);
}

// ---------------------------------------------------------------------------
// target catalog (real local descriptors, no registry / version invention)
// ---------------------------------------------------------------------------

test("resolveTargetCatalog loads real descriptors from a target workspace", async () => {
	const root = await tempWorkspace();
	try {
		await writeTargetWorkspace(root, "prov", "2.0.0");

		const { root: resolvedRoot, descriptors } =
			await resolveTargetCatalog(root);

		assert.equal(resolvedRoot, root);
		assert.equal(descriptors.length, 1);
		assert.equal(descriptors[0]?.moduleRef, "prov");
		assert.equal(descriptors[0]?.moduleVersion, "2.0.0");
		assert.equal(descriptors[0]?.packageName, "@tomflow/proflow-prov");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("resolveTargetCatalog returns no descriptors for a workspace without governed modules", async () => {
	const root = await tempWorkspace();
	try {
		const { descriptors } = await resolveTargetCatalog(root);
		assert.deepEqual(descriptors, []);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("resolveTargetCatalog rejects a workspace whose version mismatches package.json", async () => {
	const root = await tempWorkspace();
	try {
		await writeTargetWorkspace(root, "prov", "2.0.0");
		// Mutate package.json version so it no longer matches the descriptor.
		await writeFile(
			join(root, "packages", "prov", "package.json"),
			JSON.stringify({ name: "@tomflow/proflow-prov", version: "1.0.0" }),
		);

		await assert.rejects(
			() => resolveTargetCatalog(root),
			(error: unknown): boolean =>
				error instanceof Error && error.message.includes("does not match"),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// upgrade: current != target, no-op, real target catalog
// ---------------------------------------------------------------------------

test("planUpgrade treats identical current/target descriptors as a no-op", () => {
	const current = [descriptor({ moduleRef: "m", moduleVersion: "1.0.0" })];
	const target = [descriptor({ moduleRef: "m", moduleVersion: "1.0.0" })];

	const plan = planUpgrade({
		intent: "upgrade",
		currentDescriptors: current,
		targetDescriptors: target,
	});

	// Already satisfied: no pretend package/config/lifecycle mutation.
	assert.equal(plan.steps.length, 0);
	// The plan still documents the resolved target state and verification.
	assert.equal(plan.resolvedModules.length, 1);
	assert.equal(plan.resolvedModules[0]?.moduleVersion, "1.0.0");
	assert.ok(plan.verification.length > 0);
});

test("planUpgrade emits a real package upgrade when current != target", () => {
	const current = [descriptor({ moduleRef: "m", moduleVersion: "1.0.0" })];
	const target = [descriptor({ moduleRef: "m", moduleVersion: "2.0.0" })];

	const plan = planUpgrade({
		intent: "upgrade",
		currentDescriptors: current,
		targetDescriptors: target,
	});

	const packageStep = plan.steps.find((step) => step.kind === "package");
	assert.ok(packageStep);
	assert.equal(packageStep.executeStrategy, ExecuteStrategy.packageUpgrade);
	assert.equal(plan.resolvedModules[0]?.moduleVersion, "2.0.0");
});

test("planUpgrade plans an upgrade against descriptors resolved from a real target workspace", async () => {
	const root = await tempWorkspace();
	try {
		await writeTargetWorkspace(root, "m", "2.0.0");

		const { descriptors: target } = await resolveTargetCatalog(root);
		const current = [
			descriptor({
				moduleRef: "m",
				packageName: "@tomflow/proflow-m",
				moduleVersion: "1.0.0",
			}),
		];

		const plan = planUpgrade({
			intent: "upgrade",
			currentDescriptors: current,
			targetDescriptors: target,
		});

		const packageStep = plan.steps.find(
			(step) => step.kind === "package" && step.moduleRef === "m",
		);
		assert.ok(packageStep);
		assert.equal(packageStep.executeStrategy, ExecuteStrategy.packageUpgrade);
		assert.equal(plan.resolvedModules[0]?.moduleVersion, "2.0.0");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("planUpgrade is a no-op when the target workspace already equals current", async () => {
	const root = await tempWorkspace();
	try {
		await writeTargetWorkspace(root, "m", "1.0.0");

		const { descriptors: target } = await resolveTargetCatalog(root);
		const current = [
			descriptor({
				moduleRef: "m",
				packageName: "@tomflow/proflow-m",
				moduleVersion: "1.0.0",
			}),
		];

		const plan = planUpgrade({
			intent: "upgrade",
			currentDescriptors: current,
			targetDescriptors: target,
		});

		assert.equal(plan.steps.length, 0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// doctor → repair facts
// ---------------------------------------------------------------------------

test("repairFactsFromDoctor maps known error codes to known repair facts", () => {
	const cases: Array<[DeploymentError["code"], string]> = [
		["CONFIG_REQUIRED", "CONFIG_MISSING"],
		["DEPENDENCY_UNRESOLVED", "DEPENDENCY_UNRESOLVED"],
		["EXTERNAL_RESOURCE_UNAVAILABLE", "EXTERNAL_RESOURCE_UNAVAILABLE"],
		["VERIFY_FAILED", "VERIFY_FAILED"],
	];
	for (const [errorCode, factCode] of cases) {
		const report = doctorReport({
			moduleRef: "m",
			status: "FAILED",
			errors: [doctorError(errorCode, "observed failure")],
			nextAction: { kind: "repair-plan", summary: "repair" },
		});

		const { facts, blocked } = repairFactsFromDoctor(report);

		assert.deepEqual(
			facts.map((fact) => fact.code),
			[factCode],
		);
		assert.equal(facts[0]?.moduleRef, "m");
		assert.deepEqual(blocked, []);
	}
});

test("repairFactsFromDoctor emits ACTION_REQUIRED for a human-action next action", () => {
	const report = doctorReport({
		moduleRef: "m",
		status: "ACTION_REQUIRED",
		nextAction: {
			kind: "human-action",
			action: "configure-tunnel",
			description: "configure the tunnel",
		},
	});

	const { facts, blocked } = repairFactsFromDoctor(report);

	assert.deepEqual(
		facts.map((fact) => fact.code),
		["ACTION_REQUIRED"],
	);
	assert.equal(facts[0]?.message, "configure-tunnel");
	assert.deepEqual(blocked, []);
});

test("repairFactsFromDoctor emits no facts for a healthy module", () => {
	const report = doctorReport({ moduleRef: "m", status: "SUCCEEDED" });
	assert.deepEqual(repairFactsFromDoctor(report), { facts: [], blocked: [] });
});

test("repairFactsFromDoctor blocks unknown doctor errors without inventing facts", () => {
	const report = doctorReport({
		moduleRef: "m",
		status: "FAILED",
		errors: [doctorError("DOCTOR_FAILED", "unknown diagnosis")],
		nextAction: { kind: "repair-plan", summary: "doctor failed" },
	});

	const { facts, blocked } = repairFactsFromDoctor(report);

	assert.deepEqual(facts, []);
	assert.equal(blocked.length, 1);
	assert.equal(blocked[0]?.moduleRef, "m");
	assert.equal(blocked[0]?.code, "DOCTOR_FAILED");
});

test("repairFactsFromDoctor blocks a failed report with no typed error", () => {
	const report = doctorReport({ moduleRef: "m", status: "FAILED" });

	const { facts, blocked } = repairFactsFromDoctor(report);

	assert.deepEqual(facts, []);
	assert.equal(blocked.length, 1);
});

test("diagnoseRepair combines facts and blocked across reports", () => {
	const reports = [
		doctorReport({
			moduleRef: "a",
			status: "FAILED",
			errors: [doctorError("CONFIG_REQUIRED", "config missing")],
		}),
		doctorReport({
			moduleRef: "b",
			status: "FAILED",
			errors: [doctorError("DOCTOR_FAILED", "unknown")],
		}),
	];

	const { facts, blocked } = diagnoseRepair(reports);

	assert.deepEqual(
		facts.map((fact) => fact.moduleRef),
		["a"],
	);
	assert.deepEqual(
		blocked.map((item) => item.moduleRef),
		["b"],
	);
});

// ---------------------------------------------------------------------------
// repair → plan / apply preconditions
// ---------------------------------------------------------------------------

test("planRepair emits apply-able steps with preconditions from known facts", () => {
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

	const configStep = plan.steps.find((step) => step.kind === "config");
	assert.ok(configStep);
	// config repair requires the package to be installed before apply
	assert.ok(configStep.preconditions.some((p) => p.includes("installed")));

	const startStep = plan.steps.find((step) => step.kind === "lifecycle");
	assert.ok(startStep);
	assert.equal(startStep.executeStrategy, ExecuteStrategy.lifecycleStart);

	// every step is a real apply-able step with a known check strategy
	for (const step of plan.steps) {
		assert.ok(step.checkStrategy.length > 0);
		assert.ok(step.postcondition.length > 0);
	}
});

test("planRepair never invents a mutation for a blocked (unknown) diagnosis", () => {
	const modules = [moduleFixture({ moduleRef: "m" })];
	const report = doctorReport({
		moduleRef: "m",
		status: "FAILED",
		errors: [doctorError("DOCTOR_FAILED", "unknown")],
		nextAction: { kind: "repair-plan", summary: "doctor failed" },
	});

	const { facts } = repairFactsFromDoctor(report);
	assert.deepEqual(facts, []);

	const plan = planRepair({ modules, facts });
	assert.equal(plan.steps.length, 0);
});

test("planRepair produces no step for VERIFY_FAILED or DEPENDENCY_UNRESOLVED", () => {
	const modules = [moduleFixture({ moduleRef: "m" })];
	const facts: RepairFact[] = [
		{ moduleRef: "m", code: "VERIFY_FAILED", message: "verify failed" },
		{ moduleRef: "m", code: "DEPENDENCY_UNRESOLVED", message: "no provider" },
	];
	const plan = planRepair({ modules, facts });

	// Neither fact has a frozen automatic mutation: verify re-runs after repair
	// and dependency resolution requires a plan/human decision.
	assert.equal(plan.steps.length, 0);
});
