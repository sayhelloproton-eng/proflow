import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type {
	LifecyclePrimitive,
	ModuleDescriptor,
	ModuleOperationResult,
} from "@tomflow/proflow-module-contract";

import type { ResolvedModule } from "../src/contracts.ts";
import { doctorModule, doctorModules } from "../src/doctor/index.ts";
import { PlatformError } from "../src/errors.ts";
import type { ModuleCatalog, ModuleSource } from "../src/modules.ts";
import { type WorkspacePaths, workspacePaths } from "../src/paths.ts";
import {
	appendVerification,
	loadVerificationHistory,
	materializeConfig,
} from "../src/persistence/index.ts";
import {
	configFingerprint,
	verificationRefOf,
	verifyModule,
	verifyModules,
} from "../src/verification/index.ts";

const SERVICE_LIFECYCLE: LifecyclePrimitive[] = [
	"describe",
	"preflight",
	"status",
	"verify",
	"doctor",
	"start",
	"stop",
];

interface FixtureInput {
	moduleRef: string;
	kind: ModuleDescriptor["kind"];
	moduleVersion?: string;
	lifecycle?: LifecyclePrimitive[];
}

function moduleFixture(input: FixtureInput): ResolvedModule {
	return {
		moduleRef: input.moduleRef,
		packageName: `@tomflow/proflow-${input.moduleRef}`,
		moduleVersion: input.moduleVersion ?? "1.0.0",
		kind: input.kind,
		installClass: "optional",
		identity: {
			domain: "deployment-governance",
			summary: "Platform CLI test fixture",
		},
		documentation: [],
		provides: [],
		requires: [],
		requirements: [],
		configSlots: [],
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

function ok(moduleRef: string, version = "1.0.0"): ModuleOperationResult {
	return {
		contract: "deployment.result.v1",
		ok: true,
		status: "SUCCEEDED",
		moduleRef,
		moduleVersion: version,
		checks: [{ id: "health", status: "PASS", message: "observed healthy" }],
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
		checks: [
			{ id: "reachable", status: "PASS", message: "resource reachable" },
		],
	};
}

function failed(
	moduleRef: string,
	version: string,
	code: "VERIFY_FAILED" | "DOCTOR_FAILED",
): ModuleOperationResult {
	return {
		contract: "deployment.result.v1",
		ok: false,
		status: "FAILED",
		moduleRef,
		moduleVersion: version,
		error: { code, message: `${code} observed`, retryable: true },
	};
}

function actionRequired(
	moduleRef: string,
	version: string,
	action: string,
): ModuleOperationResult {
	return {
		contract: "deployment.result.v1",
		ok: false,
		status: "ACTION_REQUIRED",
		moduleRef,
		moduleVersion: version,
		actionRequired: { action, description: `${action} required` },
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
	const root = await mkdtemp(join(tmpdir(), "proflow-cli-verify-"));
	return {
		root,
		paths: workspacePaths(root),
		async cleanup() {
			await rm(root, { recursive: true, force: true });
		},
	};
}

function platformError(code: string): (error: unknown) => boolean {
	return (error: unknown): boolean =>
		error instanceof PlatformError && error.code === code;
}

// ---- Verify: reads current reality from the live adapter ----

test("verifyModule dispatches the live verify primitive and persists a PASS record", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
		const { calls, catalog } = makeCatalog([
			{ module: svc, primitives: { verify: () => ok("svc", "1.0.0") } },
		]);

		const result = await verifyModule(catalog, svc, paths);

		assert.deepEqual(calls, [{ moduleRef: "svc", primitive: "verify" }]);
		assert.equal(result.record.moduleRef, "svc");
		assert.equal(result.record.moduleVersion, "1.0.0");
		assert.equal(result.record.result, "PASS");
		assert.deepEqual(result.record.evidenceRefs, ["check:health:PASS"]);

		const history = await loadVerificationHistory(paths, "svc");
		assert.equal(history.length, 1);
		assert.equal(history[0]?.result, "PASS");
		assert.equal(history[0]?.verificationRef, result.record.verificationRef);
	} finally {
		await cleanup();
	}
});

test("verifyModule records FAIL when the adapter reports FAILED", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
		const { catalog } = makeCatalog([
			{
				module: svc,
				primitives: { verify: () => failed("svc", "1.0.0", "VERIFY_FAILED") },
			},
		]);

		const result = await verifyModule(catalog, svc, paths);

		assert.equal(result.record.result, "FAIL");
		assert.equal(
			(await loadVerificationHistory(paths, "svc"))[0]?.result,
			"FAIL",
		);
	} finally {
		await cleanup();
	}
});

test("verifyModule never records ACTION_REQUIRED as PASS", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
		const { catalog } = makeCatalog([
			{
				module: svc,
				primitives: {
					verify: () => actionRequired("svc", "1.0.0", "bind-resource"),
				},
			},
		]);

		const result = await verifyModule(catalog, svc, paths);

		assert.equal(result.result.status, "ACTION_REQUIRED");
		assert.equal(result.record.result, "FAIL");
		const history = await loadVerificationHistory(paths, "svc");
		assert.equal(history[0]?.result, "FAIL");
		assert.notEqual(history[0]?.result, "PASS");
	} finally {
		await cleanup();
	}
});

// ---- Verify: append/preserve history ----

test("verify history appends and preserves every version without overwrite", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const v100 = moduleFixture({
			moduleRef: "svc",
			kind: "service",
			moduleVersion: "1.0.0",
		});
		const v101 = moduleFixture({
			moduleRef: "svc",
			kind: "service",
			moduleVersion: "1.0.1",
		});
		const v102 = moduleFixture({
			moduleRef: "svc",
			kind: "service",
			moduleVersion: "1.0.2",
		});

		const pass100 = makeCatalog([
			{ module: v100, primitives: { verify: () => ok("svc", "1.0.0") } },
		]);
		await verifyModule(pass100.catalog, v100, paths);

		const fail101 = makeCatalog([
			{
				module: v101,
				primitives: { verify: () => failed("svc", "1.0.1", "VERIFY_FAILED") },
			},
		]);
		await verifyModule(fail101.catalog, v101, paths);

		const pass102 = makeCatalog([
			{ module: v102, primitives: { verify: () => ok("svc", "1.0.2") } },
		]);
		await verifyModule(pass102.catalog, v102, paths);

		const history = await loadVerificationHistory(paths, "svc");
		assert.deepEqual(
			history.map((record) => record.moduleVersion),
			["1.0.0", "1.0.1", "1.0.2"],
		);
		assert.deepEqual(
			history.map((record) => record.result),
			["PASS", "FAIL", "PASS"],
		);
	} finally {
		await cleanup();
	}
});

// ---- Verify: persisted history must never fake READY (RF-DPL-CLI-05) ----

test("persisted PASS history cannot fake a FAIL — verify reads current reality", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({
			moduleRef: "svc",
			kind: "service",
			moduleVersion: "1.0.0",
		});
		await appendVerification(paths, {
			verificationRef: "verify-svc-1.0.0-pass-old",
			moduleRef: "svc",
			moduleVersion: "1.0.0",
			result: "PASS",
			summary: "prior pass",
			evidenceRefs: [],
			verifiedAt: new Date().toISOString(),
		});
		assert.equal((await loadVerificationHistory(paths, "svc")).length, 1);

		const { catalog } = makeCatalog([
			{
				module: svc,
				primitives: { verify: () => failed("svc", "1.0.0", "VERIFY_FAILED") },
			},
		]);
		const result = await verifyModule(catalog, svc, paths);

		assert.equal(result.record.result, "FAIL");
		const history = await loadVerificationHistory(paths, "svc");
		assert.equal(history.length, 2);
		assert.equal(history[0]?.result, "PASS");
		assert.equal(history[1]?.result, "FAIL");
	} finally {
		await cleanup();
	}
});

// ---- Verify: external resource identity ----

test("external-resource verify carries resourceVersion and a config-fingerprint identity", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const tunnel = moduleFixture({
			moduleRef: "tunnel",
			kind: "external-resource",
		});
		await materializeConfig(paths, {
			moduleRef: "tunnel",
			values: { url: "https://tunnel.example.com", region: "us-east" },
			secretRefs: [],
		});
		const { catalog } = makeCatalog([
			{
				module: tunnel,
				primitives: { verify: () => okExternal("tunnel", "1.0.0", "r-7") },
			},
		]);

		const result = await verifyModule(catalog, tunnel, paths);

		assert.equal(result.record.resourceVersion, "r-7");
		assert.equal(
			result.record.resourceIdentity,
			configFingerprint({
				url: "https://tunnel.example.com",
				region: "us-east",
			}),
		);
		assert.match(result.record.verificationRef, /^verify-tunnel-/);
	} finally {
		await cleanup();
	}
});

test("non-external verify omits resource identity/version", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
		const { catalog } = makeCatalog([
			{ module: svc, primitives: { verify: () => ok("svc", "1.0.0") } },
		]);

		const result = await verifyModule(catalog, svc, paths);

		assert.equal(result.record.resourceIdentity, undefined);
		assert.equal(result.record.resourceVersion, undefined);
	} finally {
		await cleanup();
	}
});

// ---- Verify: deterministic verificationRef ----

test("verificationRef is deterministic and unique per verifiedAt", () => {
	const base = {
		moduleRef: "svc",
		moduleVersion: "1.0.0",
		result: "PASS" as const,
		summary: "ok",
		evidenceRefs: [],
		verifiedAt: "2026-01-01T00:00:00.000Z",
	};
	const ref = verificationRefOf(base);
	assert.equal(ref, verificationRefOf(base));
	assert.match(ref, /^verify-svc-[0-9a-f]{16}$/);
	assert.notEqual(
		ref,
		verificationRefOf({ ...base, verifiedAt: "2026-01-01T00:00:01.000Z" }),
	);
});

// ---- Verify: unsupported primitive + batch skip ----

test("verifyModule rejects undeclared verify with LIFECYCLE_UNSUPPORTED and writes nothing", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const lib = moduleFixture({
			moduleRef: "lib",
			kind: "library",
			lifecycle: ["describe", "preflight"],
		});
		const { calls, catalog } = makeCatalog([
			{ module: lib, primitives: { verify: () => ok("lib", "1.0.0") } },
		]);

		await assert.rejects(
			() => verifyModule(catalog, lib, paths),
			platformError("LIFECYCLE_UNSUPPORTED"),
		);
		assert.equal(calls.length, 0);
		assert.equal((await loadVerificationHistory(paths, "lib")).length, 0);
	} finally {
		await cleanup();
	}
});

test("verifyModules skips modules that do not declare verify", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
		const lib = moduleFixture({
			moduleRef: "lib",
			kind: "library",
			lifecycle: ["describe", "preflight"],
		});
		const { calls, catalog } = makeCatalog([
			{ module: svc, primitives: { verify: () => ok("svc", "1.0.0") } },
			{ module: lib, primitives: { verify: () => ok("lib", "1.0.0") } },
		]);

		const results = await verifyModules(catalog, [svc, lib], paths);

		assert.equal(results.length, 1);
		assert.equal(results[0]?.moduleRef, "svc");
		assert.deepEqual(calls, [{ moduleRef: "svc", primitive: "verify" }]);
		assert.equal((await loadVerificationHistory(paths, "svc")).length, 1);
		assert.equal((await loadVerificationHistory(paths, "lib")).length, 0);
	} finally {
		await cleanup();
	}
});

// ---- Doctor: diagnose only, never repair ----

test("doctor diagnoses a failure, recommends a repair plan, and never repairs", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
		const { calls, catalog } = makeCatalog([
			{
				module: svc,
				primitives: {
					doctor: () => failed("svc", "1.0.0", "DOCTOR_FAILED"),
					start: () => ok("svc", "1.0.0"),
					stop: () => ok("svc", "1.0.0"),
				},
			},
		]);

		const report = await doctorModule(catalog, svc);

		assert.equal(report.status, "FAILED");
		assert.equal(report.errors.length, 1);
		assert.equal(report.errors[0]?.code, "DOCTOR_FAILED");
		assert.equal(report.nextAction.kind, "repair-plan");
		// only the doctor primitive ran; no start/stop/repair side effects
		assert.deepEqual(calls, [{ moduleRef: "svc", primitive: "doctor" }]);
		assert.equal(report.observedEffects.length, 0);
		// doctor never writes verification history
		assert.equal((await loadVerificationHistory(paths, "svc")).length, 0);
	} finally {
		await cleanup();
	}
});

test("doctor reports a human action for ACTION_REQUIRED and does not auto-act", async () => {
	const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
	const { calls, catalog } = makeCatalog([
		{
			module: svc,
			primitives: {
				doctor: () => actionRequired("svc", "1.0.0", "configure-tunnel"),
				start: () => ok("svc", "1.0.0"),
			},
		},
	]);

	const report = await doctorModule(catalog, svc);

	assert.equal(report.status, "ACTION_REQUIRED");
	assert.equal(report.nextAction.kind, "human-action");
	if (report.nextAction.kind === "human-action") {
		assert.equal(report.nextAction.action, "configure-tunnel");
	}
	assert.deepEqual(calls, [{ moduleRef: "svc", primitive: "doctor" }]);
});

test("doctor reports no next action when the module is healthy", async () => {
	const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
	const { catalog } = makeCatalog([
		{ module: svc, primitives: { doctor: () => ok("svc", "1.0.0") } },
	]);

	const report = await doctorModule(catalog, svc);

	assert.equal(report.status, "SUCCEEDED");
	assert.equal(report.nextAction.kind, "none");
	assert.deepEqual(report.errors, []);
	assert.equal(report.checks[0]?.status, "PASS");
});

test("doctorModules skips modules that do not declare doctor", async () => {
	const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
	const lib = moduleFixture({
		moduleRef: "lib",
		kind: "library",
		lifecycle: ["describe", "preflight"],
	});
	const { calls, catalog } = makeCatalog([
		{ module: svc, primitives: { doctor: () => ok("svc", "1.0.0") } },
		{ module: lib, primitives: { doctor: () => ok("lib", "1.0.0") } },
	]);

	const reports = await doctorModules(catalog, [svc, lib]);

	assert.equal(reports.length, 1);
	assert.equal(reports[0]?.moduleRef, "svc");
	assert.deepEqual(calls, [{ moduleRef: "svc", primitive: "doctor" }]);
});
