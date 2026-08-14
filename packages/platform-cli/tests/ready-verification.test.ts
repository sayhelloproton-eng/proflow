import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type {
	DeploymentCheck,
	LifecyclePrimitive,
	ModuleDescriptor,
	ModuleOperationResult,
} from "@tomflow/proflow-module-contract";

import type {
	DeploymentState,
	ResolvedModule,
	VerificationRecord,
} from "../src/contracts.ts";
import type { LifecycleRunResult } from "../src/lifecycle/index.ts";
import { buildManifest } from "../src/manifest/index.ts";
import type { ModuleCatalog, ModuleSource } from "../src/modules.ts";
import { type WorkspacePaths, workspacePaths } from "../src/paths.ts";
import {
	DEPLOYMENT_STATE_CONTRACT,
	isDeploymentState,
} from "../src/persistence/guards.ts";
import {
	appendVerification,
	emptyDeploymentState,
	saveDeploymentState,
} from "../src/persistence/index.ts";
import {
	clearCompletedPendingActions,
	clearPendingActions,
} from "../src/persistence/state.ts";
import { assessPlatformReady } from "../src/ready/index.ts";
import { configFingerprint } from "../src/verification/index.ts";

const SERVICE_LIFECYCLE: LifecyclePrimitive[] = [
	"describe",
	"preflight",
	"status",
	"verify",
	"doctor",
	"start",
	"stop",
];

const VERIFIED_AT = "2026-01-01T00:00:00.000Z";

interface FixtureInput {
	moduleRef: string;
	kind: ModuleDescriptor["kind"];
	moduleVersion?: string;
	lifecycle?: LifecyclePrimitive[];
	configSlots?: ModuleDescriptor["configSlots"];
}

function moduleFixture(input: FixtureInput): ResolvedModule {
	return {
		moduleRef: input.moduleRef,
		packageName: `@tomflow/proflow-${input.moduleRef}`,
		moduleVersion: input.moduleVersion ?? "1.0.0",
		kind: input.kind,
		provides: [],
		requires: [],
		requirements: [],
		configSlots: input.configSlots ?? [],
		lifecycle: input.lifecycle ?? SERVICE_LIFECYCLE,
		verification: {
			checks: [
				{ id: "health", description: "Observed health", lifecycle: "verify" },
			],
		},
		effects: [],
		source: { type: "workspace", path: "/fixture" },
	};
}

function ok(
	moduleRef: string,
	version = "1.0.0",
	checks?: DeploymentCheck[],
): ModuleOperationResult {
	return {
		contract: "deployment.result.v1",
		ok: true,
		status: "SUCCEEDED",
		moduleRef,
		moduleVersion: version,
		...(checks !== undefined ? { checks } : {}),
	};
}

function okExternal(
	moduleRef: string,
	version: string,
	resourceVersion: string,
): ModuleOperationResult {
	return {
		contract: "deployment.result.v1",
		ok: true,
		status: "SUCCEEDED",
		moduleRef,
		moduleVersion: version,
		resourceVersion,
		checks: [{ id: "reachable", status: "PASS", message: "reachable" }],
	};
}

function statusRun(
	moduleRef: string,
	result: ModuleOperationResult,
): LifecycleRunResult {
	return {
		moduleRef,
		primitive: "status",
		status: "EXECUTED",
		result,
		observedEffects: [],
	};
}

function verificationRecord(
	moduleRef: string,
	moduleVersion: string,
	result: "PASS" | "FAIL",
	extra: Partial<
		Pick<VerificationRecord, "resourceIdentity" | "resourceVersion">
	> = {},
): VerificationRecord {
	return {
		verificationRef: `verify-${moduleRef}-${moduleVersion}-${result}`,
		moduleRef,
		moduleVersion,
		result,
		summary: `${result}`,
		evidenceRefs: [],
		verifiedAt: VERIFIED_AT,
		...(extra.resourceIdentity !== undefined
			? { resourceIdentity: extra.resourceIdentity }
			: {}),
		...(extra.resourceVersion !== undefined
			? { resourceVersion: extra.resourceVersion }
			: {}),
	};
}

interface FakeAdapterDef {
	module: ResolvedModule;
	primitives: Record<string, () => unknown>;
}

interface Recording {
	calls: { moduleRef: string; primitive: string }[];
	catalog: ModuleCatalog;
}

function makeCatalog(defs: FakeAdapterDef[]): Recording {
	const calls: { moduleRef: string; primitive: string }[] = [];
	const byPackage = new Map(
		defs.map((def) => [def.module.packageName, def] as const),
	);
	const catalog: ModuleCatalog = {
		async sources() {
			return [];
		},
		async loadDescriptor() {
			return {};
		},
		async loadAdapter(source: ModuleSource) {
			const def = byPackage.get(source.packageName);
			if (def === undefined) return { behaviorAdapter: {} };
			const wrapped: Record<string, unknown> = {};
			for (const primitive of Object.keys(def.primitives)) {
				const fn = def.primitives[primitive];
				if (fn === undefined) continue;
				wrapped[primitive] = () => {
					calls.push({ moduleRef: def.module.moduleRef, primitive });
					return fn();
				};
			}
			return { behaviorAdapter: wrapped };
		},
	};
	return { calls, catalog };
}

async function tmpWorkspace(): Promise<{
	root: string;
	paths: WorkspacePaths;
	cleanup(): Promise<void>;
}> {
	const root = await mkdtemp(join(tmpdir(), "proflow-cli-rv-"));
	return {
		root,
		paths: workspacePaths(root),
		async cleanup() {
			await rm(root, { recursive: true, force: true });
		},
	};
}

function pendingAction(
	overrides: Partial<DeploymentState["pendingActions"][number]> = {},
) {
	return {
		planRef: "plan-1",
		stepRef: "step-human",
		moduleRef: "svc",
		action: "approve-external-resource",
		createdAt: VERIFIED_AT,
		...overrides,
	};
}

// ---- External Resource current verification ----

test("an old-resource PASS cannot READY a new resource — resourceIdentity mismatch is VERIFICATION_STALE", () => {
	const tunnel = moduleFixture({
		moduleRef: "tunnel",
		kind: "external-resource",
	});
	const result = assessPlatformReady({
		modules: [tunnel],
		status: [statusRun("tunnel", ok("tunnel", "1.0.0"))],
		verification: [
			verificationRecord("tunnel", "1.0.0", "PASS", {
				resourceIdentity: "fp-old-identity",
			}),
		],
		resources: [{ moduleRef: "tunnel", resourceIdentity: "fp-new-identity" }],
	});
	assert.equal(result.state, "NOT_READY");
	assert.ok(result.findings.some((f) => f.code === "VERIFICATION_STALE"));
});

test("a matching resource identity is required for READY", () => {
	const tunnel = moduleFixture({
		moduleRef: "tunnel",
		kind: "external-resource",
	});
	const result = assessPlatformReady({
		modules: [tunnel],
		status: [statusRun("tunnel", ok("tunnel", "1.0.0"))],
		verification: [
			verificationRecord("tunnel", "1.0.0", "PASS", {
				resourceIdentity: "fp-current",
			}),
		],
		resources: [{ moduleRef: "tunnel", resourceIdentity: "fp-current" }],
	});
	assert.equal(result.state, "READY");
	assert.equal(result.findings.length, 0);
});

test("resourceVersion mismatch against live reality is VERIFICATION_STALE", () => {
	const tunnel = moduleFixture({
		moduleRef: "tunnel",
		kind: "external-resource",
	});
	const result = assessPlatformReady({
		modules: [tunnel],
		status: [statusRun("tunnel", okExternal("tunnel", "1.0.0", "r-2"))],
		verification: [
			verificationRecord("tunnel", "1.0.0", "PASS", {
				resourceIdentity: "fp-current",
				resourceVersion: "r-1",
			}),
		],
		resources: [
			{
				moduleRef: "tunnel",
				resourceIdentity: "fp-current",
				resourceVersion: "r-2",
			},
		],
	});
	assert.equal(result.state, "NOT_READY");
	assert.ok(result.findings.some((f) => f.code === "VERIFICATION_STALE"));
});

test("a current resource with matching identity and version is READY", () => {
	const tunnel = moduleFixture({
		moduleRef: "tunnel",
		kind: "external-resource",
	});
	const result = assessPlatformReady({
		modules: [tunnel],
		status: [statusRun("tunnel", okExternal("tunnel", "1.0.0", "r-2"))],
		verification: [
			verificationRecord("tunnel", "1.0.0", "PASS", {
				resourceIdentity: "fp-current",
				resourceVersion: "r-2",
			}),
		],
		resources: [
			{
				moduleRef: "tunnel",
				resourceIdentity: "fp-current",
				resourceVersion: "r-2",
			},
		],
	});
	assert.equal(result.state, "READY");
	assert.equal(result.findings.length, 0);
});

test("non-external modules require only a current-version PASS (no resource reality)", () => {
	const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
	const result = assessPlatformReady({
		modules: [svc],
		status: [statusRun("svc", ok("svc", "1.0.0"))],
		verification: [verificationRecord("svc", "1.0.0", "PASS")],
	});
	assert.equal(result.state, "READY");
});

// ---- resource identity: secretRef reference identity ----

test("configFingerprint includes secretRef reference identity without raw secret values", () => {
	const publicValues = { url: "https://a.example.com" };
	const none = configFingerprint(publicValues);
	const one = configFingerprint(publicValues, ["token"]);
	const two = configFingerprint(publicValues, ["token", "region-secret"]);
	assert.notEqual(none, one);
	assert.notEqual(one, two);
	// stable for identical inputs
	assert.equal(one, configFingerprint(publicValues, ["token"]));
});

// ---- pending ACTION_REQUIRED blocks READY ----

test("a persisted pending action blocks READY as a BLOCKING_ACTION", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
		const state = emptyDeploymentState();
		state.pendingActions = [pendingAction()];
		await saveDeploymentState(paths, state);
		await appendVerification(paths, verificationRecord("svc", "1.0.0", "PASS"));
		const { catalog } = makeCatalog([
			{ module: svc, primitives: { status: () => ok("svc", "1.0.0") } },
		]);

		const manifest = await buildManifest({
			catalog,
			modules: [svc],
			paths,
		});

		assert.equal(manifest.status, "ACTION_REQUIRED");
		assert.ok(
			manifest.pendingActions.some(
				(action) => action.action === "approve-external-resource",
			),
		);
	} finally {
		await cleanup();
	}
});

test("a pending action whose plan is COMPLETE no longer blocks READY", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
		const state = emptyDeploymentState();
		state.pendingActions = [pendingAction()];
		state.lastAppliedPlans = [
			{ planRef: "plan-1", intent: "install", appliedAt: VERIFIED_AT },
		];
		await saveDeploymentState(paths, state);
		await appendVerification(paths, verificationRecord("svc", "1.0.0", "PASS"));
		const { catalog } = makeCatalog([
			{ module: svc, primitives: { status: () => ok("svc", "1.0.0") } },
		]);

		const manifest = await buildManifest({
			catalog,
			modules: [svc],
			paths,
		});

		assert.equal(manifest.status, "READY");
		assert.deepEqual(manifest.pendingActions, []);
	} finally {
		await cleanup();
	}
});

test("clearCompletedPendingActions removes only COMPLETE-plan actions", () => {
	const state = emptyDeploymentState();
	state.pendingActions = [
		pendingAction({ planRef: "plan-done" }),
		pendingAction({ planRef: "plan-open" }),
	];
	state.lastAppliedPlans = [
		{ planRef: "plan-done", intent: "install", appliedAt: VERIFIED_AT },
	];

	const cleared = clearCompletedPendingActions(state);

	assert.deepEqual(
		cleared.pendingActions.map((action) => action.planRef),
		["plan-open"],
	);
	// input is not mutated
	assert.equal(state.pendingActions.length, 2);
});

test("clearPendingActions removes only actions matched by the resolver", () => {
	const state = emptyDeploymentState();
	state.pendingActions = [
		pendingAction({ stepRef: "step-a" }),
		pendingAction({ stepRef: "step-b" }),
	];

	const cleared = clearPendingActions(
		state,
		(action) => action.stepRef === "step-a",
	);

	assert.deepEqual(
		cleared.pendingActions.map((action) => action.stepRef),
		["step-b"],
	);
});

// ---- guards: new PendingActionRecord structure ----

test("isDeploymentState validates the new PendingActionRecord structure", () => {
	const base = {
		contract: DEPLOYMENT_STATE_CONTRACT,
		selectedModules: [],
		lastAppliedPlans: [],
		verificationIndex: [],
		updatedAt: VERIFIED_AT,
	};

	assert.equal(
		isDeploymentState({ ...base, pendingActions: [pendingAction()] }),
		true,
	);

	// old structure missing stepRef/moduleRef is rejected, never trusted
	assert.equal(
		isDeploymentState({
			...base,
			pendingActions: [
				{ planRef: "plan-1", action: "a", createdAt: VERIFIED_AT },
			],
		}),
		false,
	);

	// a record with a non-string description is rejected
	assert.equal(
		isDeploymentState({
			...base,
			pendingActions: [{ ...pendingAction(), description: 42 }],
		}),
		false,
	);
});

// ---- READY aggregation via blockingActions still enforced ----

test("assessPlatformReady yields ACTION_REQUIRED for a blocking action", () => {
	const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
	const result = assessPlatformReady({
		modules: [svc],
		status: [statusRun("svc", ok("svc", "1.0.0"))],
		verification: [verificationRecord("svc", "1.0.0", "PASS")],
		blockingActions: [
			{ moduleRef: "svc", action: "approve-external-resource" },
		],
	});
	assert.equal(result.state, "ACTION_REQUIRED");
	assert.ok(result.findings.some((f) => f.code === "BLOCKING_ACTION"));
});
