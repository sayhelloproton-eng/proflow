import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type {
	DeploymentCheck,
	LifecyclePrimitive,
	ModuleDescriptor,
	ModuleOperationResult,
} from "@tomflow/proflow-module-contract";

import type { ResolvedModule, VerificationRecord } from "../src/contracts.ts";
import { generateInstallDoc, renderInstallDoc } from "../src/install/index.ts";
import type { LifecycleRunResult } from "../src/lifecycle/index.ts";
import { buildManifest } from "../src/manifest/index.ts";
import type { ModuleCatalog, ModuleSource } from "../src/modules.ts";
import { type WorkspacePaths, workspacePaths } from "../src/paths.ts";
import { materializeConfig } from "../src/persistence/config.ts";
import { appendVerification } from "../src/persistence/index.ts";
import { assessPlatformReady } from "../src/ready/index.ts";
import { SECRET_REDACTED } from "../src/security/index.ts";

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
	provides?: ModuleDescriptor["provides"];
	requires?: ModuleDescriptor["requires"];
	requirements?: ModuleDescriptor["requirements"];
	configSlots?: ModuleDescriptor["configSlots"];
	effects?: ModuleDescriptor["effects"];
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
		provides: input.provides ?? [],
		requires: input.requires ?? [],
		requirements: input.requirements ?? [],
		configSlots: input.configSlots ?? [],
		lifecycle: input.lifecycle ?? SERVICE_LIFECYCLE,
		verification: {
			checks: [
				{ id: "health", description: "Observed health", lifecycle: "verify" },
			],
		},
		effects: input.effects ?? [],
		source: { type: "workspace", path: "/fixture" },
	};
}

function check(
	id: string,
	status: DeploymentCheck["status"],
	message = `${id} ${status}`,
): DeploymentCheck {
	return { id, status, message };
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

function failed(moduleRef: string, version = "1.0.0"): ModuleOperationResult {
	return {
		contract: "deployment.result.v1",
		ok: false,
		status: "FAILED",
		moduleRef,
		moduleVersion: version,
		error: { code: "VERIFY_FAILED", message: "verify failed", retryable: true },
	};
}

function blocked(moduleRef: string, version = "1.0.0"): ModuleOperationResult {
	return {
		contract: "deployment.result.v1",
		ok: false,
		status: "BLOCKED",
		moduleRef,
		moduleVersion: version,
	};
}

function actionRequired(
	moduleRef: string,
	version = "1.0.0",
	action = "bind-resource",
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

function statusUnavailable(moduleRef: string): LifecycleRunResult {
	return {
		moduleRef,
		primitive: "status",
		status: "SKIP_UNSUPPORTED",
		result: undefined,
		observedEffects: [],
	};
}

function verificationRecord(
	moduleRef: string,
	moduleVersion: string,
	result: "PASS" | "FAIL",
): VerificationRecord {
	return {
		verificationRef: `verify-${moduleRef}-${moduleVersion}-${result}`,
		moduleRef,
		moduleVersion,
		result,
		summary: `${result}`,
		evidenceRefs: [],
		verifiedAt: VERIFIED_AT,
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
	const root = await mkdtemp(join(tmpdir(), "proflow-cli-mri-"));
	return {
		root,
		paths: workspacePaths(root),
		async cleanup() {
			await rm(root, { recursive: true, force: true });
		},
	};
}

// ---- Platform READY aggregation ----

test("assessPlatformReady returns READY when all required reality is satisfied", () => {
	const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
	const result = assessPlatformReady({
		modules: [svc],
		status: [statusRun("svc", ok("svc", "1.0.0", [check("health", "PASS")]))],
		verification: [verificationRecord("svc", "1.0.0", "PASS")],
	});
	assert.equal(result.state, "READY");
	assert.equal(result.findings.length, 0);
});

test("READY requires a current-version verification record — a stale version is NOT_READY", () => {
	const svc = moduleFixture({
		moduleRef: "svc",
		kind: "service",
		moduleVersion: "1.0.1",
	});
	const result = assessPlatformReady({
		modules: [svc],
		status: [statusRun("svc", ok("svc", "1.0.1"))],
		verification: [verificationRecord("svc", "1.0.0", "PASS")],
	});
	assert.equal(result.state, "NOT_READY");
	assert.ok(result.findings.some((f) => f.code === "VERIFICATION_STALE"));
});

test("last verify PASS + current status unavailable cannot be READY (RF-DPL-CLI-05)", () => {
	const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
	const result = assessPlatformReady({
		modules: [svc],
		status: [statusUnavailable("svc")],
		verification: [verificationRecord("svc", "1.0.0", "PASS")],
	});
	assert.equal(result.state, "NOT_READY");
	assert.ok(
		result.findings.some((f) => f.code === "RUNTIME_STATUS_UNAVAILABLE"),
	);
});

test("an operation reporting SUCCEEDED while its checks FAIL cannot be READY", () => {
	const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
	const result = assessPlatformReady({
		modules: [svc],
		status: [statusRun("svc", ok("svc", "1.0.0", [check("health", "FAIL")]))],
		verification: [verificationRecord("svc", "1.0.0", "PASS")],
	});
	assert.equal(result.state, "NOT_READY");
	assert.ok(result.findings.some((f) => f.code === "RUNTIME_CHECK_FAIL"));
});

test("an operation reporting SUCCEEDED while its checks WARN is DEGRADED, not READY", () => {
	const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
	const result = assessPlatformReady({
		modules: [svc],
		status: [statusRun("svc", ok("svc", "1.0.0", [check("health", "WARN")]))],
		verification: [verificationRecord("svc", "1.0.0", "PASS")],
	});
	assert.equal(result.state, "DEGRADED");
	assert.ok(result.findings.some((f) => f.code === "RUNTIME_CHECK_WARN"));
});

test("a structured result that is not SUCCEEDED is not READY (BLOCKED)", () => {
	const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
	const result = assessPlatformReady({
		modules: [svc],
		status: [statusRun("svc", blocked("svc", "1.0.0"))],
		verification: [verificationRecord("svc", "1.0.0", "PASS")],
	});
	assert.equal(result.state, "NOT_READY");
	assert.ok(result.findings.some((f) => f.code === "RUNTIME_NOT_READY"));
});

test("NOT_READY when a required runtime is FAILED", () => {
	const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
	const result = assessPlatformReady({
		modules: [svc],
		status: [statusRun("svc", failed("svc", "1.0.0"))],
		verification: [verificationRecord("svc", "1.0.0", "PASS")],
	});
	assert.equal(result.state, "NOT_READY");
	assert.ok(result.findings.some((f) => f.code === "RUNTIME_NOT_READY"));
});

test("DEGRADED never masks a required failure", () => {
	const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
	const result = assessPlatformReady({
		modules: [svc],
		status: [statusRun("svc", ok("svc", "1.0.0", [check("health", "WARN")]))],
		verification: [verificationRecord("svc", "1.0.0", "FAIL")],
	});
	assert.equal(result.state, "NOT_READY");
	assert.ok(result.findings.some((f) => f.code === "VERIFICATION_FAIL"));
	assert.ok(result.findings.some((f) => f.code === "RUNTIME_CHECK_WARN"));
});

test("blocking human action yields ACTION_REQUIRED", () => {
	const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
	const result = assessPlatformReady({
		modules: [svc],
		status: [statusRun("svc", ok("svc", "1.0.0"))],
		verification: [verificationRecord("svc", "1.0.0", "PASS")],
		blockingActions: [
			{
				moduleRef: "svc",
				action: "bind-resource",
				description: "bind the tunnel",
			},
		],
	});
	assert.equal(result.state, "ACTION_REQUIRED");
	assert.ok(result.findings.some((f) => f.code === "BLOCKING_ACTION"));
});

test("runtime status ACTION_REQUIRED yields ACTION_REQUIRED", () => {
	const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
	const result = assessPlatformReady({
		modules: [svc],
		status: [statusRun("svc", actionRequired("svc", "1.0.0", "bind-resource"))],
		verification: [verificationRecord("svc", "1.0.0", "PASS")],
	});
	assert.equal(result.state, "ACTION_REQUIRED");
	assert.ok(result.findings.some((f) => f.code === "RUNTIME_ACTION_REQUIRED"));
});

test("NOT_READY on unresolvable required dependency", () => {
	const consumer = moduleFixture({
		moduleRef: "consumer",
		kind: "service",
		requires: [{ contractRef: "missing-cap", versionRange: ">=1.0.0" }],
	});
	const result = assessPlatformReady({
		modules: [consumer],
		status: [statusRun("consumer", ok("consumer", "1.0.0"))],
		verification: [verificationRecord("consumer", "1.0.0", "PASS")],
	});
	assert.equal(result.state, "NOT_READY");
	assert.ok(result.findings.some((f) => f.code === "DEPENDENCY_UNRESOLVED"));
});

test("NOT_READY on missing required config", () => {
	const svc = moduleFixture({
		moduleRef: "svc",
		kind: "service",
		configSlots: [
			{
				key: "token",
				type: "secretRef",
				required: true,
				sensitive: true,
				description: "api token",
			},
		],
	});
	const result = assessPlatformReady({
		modules: [svc],
		status: [statusRun("svc", ok("svc", "1.0.0"))],
		verification: [verificationRecord("svc", "1.0.0", "PASS")],
	});
	assert.equal(result.state, "NOT_READY");
	assert.ok(result.findings.some((f) => f.code === "CONFIG_MISSING"));
});

test("NOT_READY on unresolvable moduleRef binding", () => {
	const svc = moduleFixture({
		moduleRef: "svc",
		kind: "service",
		configSlots: [
			{
				key: "dep",
				type: "moduleRef",
				required: false,
				default: "missing-module",
				description: "dependency module",
			},
		],
	});
	const result = assessPlatformReady({
		modules: [svc],
		status: [statusRun("svc", ok("svc", "1.0.0"))],
		verification: [verificationRecord("svc", "1.0.0", "PASS")],
	});
	assert.equal(result.state, "NOT_READY");
	assert.ok(result.findings.some((f) => f.code === "MODULE_REF_UNRESOLVED"));
});

test("NOT_READY when current-version verification is FAIL", () => {
	const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
	const result = assessPlatformReady({
		modules: [svc],
		status: [statusRun("svc", ok("svc", "1.0.0"))],
		verification: [verificationRecord("svc", "1.0.0", "FAIL")],
	});
	assert.equal(result.state, "NOT_READY");
	assert.ok(result.findings.some((f) => f.code === "VERIFICATION_FAIL"));
});

test("NOT_READY when verification is missing", () => {
	const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
	const result = assessPlatformReady({
		modules: [svc],
		status: [statusRun("svc", ok("svc", "1.0.0"))],
		verification: [],
	});
	assert.equal(result.state, "NOT_READY");
	assert.ok(result.findings.some((f) => f.code === "VERIFICATION_MISSING"));
});

// ---- Manifest dynamic composition ----

test("buildManifest composes live status, verification summary, secretRef references, and pending actions", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({
			moduleRef: "svc",
			kind: "service",
			configSlots: [
				{
					key: "token",
					type: "secretRef",
					required: true,
					sensitive: true,
					description: "api token",
				},
				{
					key: "region",
					type: "string",
					required: false,
					description: "region",
				},
			],
		});
		await appendVerification(paths, verificationRecord("svc", "1.0.0", "PASS"));
		await materializeConfig(paths, {
			moduleRef: "svc",
			values: { token: "secret://model-provider/default", region: "us-east" },
			secretRefs: ["token"],
		});
		const { calls, catalog } = makeCatalog([
			{ module: svc, primitives: { status: () => ok("svc", "1.0.0") } },
		]);

		const manifest = await buildManifest({
			catalog,
			modules: [svc],
			paths,
		});

		assert.equal(manifest.contract, "proflow.manifest.v1");
		assert.equal(manifest.status, "READY");
		assert.equal(manifest.modules.length, 1);
		assert.equal(manifest.modules[0]?.moduleRef, "svc");
		assert.equal(manifest.modules[0]?.runtimeObserved, true);
		assert.equal(manifest.modules[0]?.runtimeStatus, "SUCCEEDED");
		assert.equal(manifest.verification[0]?.historyCount, 1);
		assert.equal(manifest.verification[0]?.latest?.result, "PASS");

		const config = manifest.config[0];
		assert.ok(config !== undefined);
		assert.equal(config.values.token, "secret://model-provider/default");
		assert.equal(config.values.region, "us-east");
		assert.ok(config.secretRefs.includes("token"));
		assert.deepEqual(config.missing, []);

		assert.ok(Date.parse(manifest.observedAt) > 0);
		assert.deepEqual(
			calls.map((call) => call.primitive),
			["status"],
		);
	} finally {
		await cleanup();
	}
});

test("manifest status reflects live reality, not persisted PASS history", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
		await appendVerification(paths, verificationRecord("svc", "1.0.0", "PASS"));
		const { catalog } = makeCatalog([
			{
				module: svc,
				primitives: {
					status: () => actionRequired("svc", "1.0.0", "bind-resource"),
				},
			},
		]);

		const manifest = await buildManifest({
			catalog,
			modules: [svc],
			paths,
		});

		assert.equal(manifest.status, "ACTION_REQUIRED");
		assert.equal(manifest.pendingActions.length, 1);
		assert.equal(manifest.pendingActions[0]?.action, "bind-resource");
		assert.equal(manifest.modules[0]?.runtimeStatus, "ACTION_REQUIRED");
	} finally {
		await cleanup();
	}
});

test("a doctor SUCCEEDED with FAIL checks cannot rescue a verify FAIL", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({ moduleRef: "svc", kind: "service" });
		await appendVerification(paths, verificationRecord("svc", "1.0.0", "FAIL"));
		const { calls, catalog } = makeCatalog([
			{
				module: svc,
				primitives: {
					status: () => ok("svc", "1.0.0"),
					doctor: () => ok("svc", "1.0.0", [check("health", "FAIL")]),
				},
			},
		]);

		const manifest = await buildManifest({
			catalog,
			modules: [svc],
			paths,
		});

		assert.equal(manifest.status, "NOT_READY");
		// doctor is diagnose-only: it is never consulted for platform readiness
		assert.deepEqual(
			calls.map((call) => call.primitive),
			["status"],
		);
	} finally {
		await cleanup();
	}
});

// ---- Generated INSTALL ----

test("renderInstallDoc includes module set, requirements, config slots, effects, verification plan, and never leaks raw secrets", () => {
	const svc = moduleFixture({
		moduleRef: "svc",
		kind: "service",
		requirements: [
			{ kind: "runtime", runtime: "node", versionRange: ">=24.0.0" },
		],
		configSlots: [
			{
				key: "token",
				type: "secretRef",
				required: true,
				sensitive: true,
				description: "api token",
			},
			{
				key: "region",
				type: "string",
				required: false,
				description: "region",
			},
		],
		effects: [
			{
				kind: "process",
				description: "runs a server",
				retention: "preserve",
			},
		],
	});

	const doc = renderInstallDoc({
		modules: [svc],
		config: {
			svc: { token: "secret://model-provider/default", region: "us-east" },
		},
	});

	assert.ok(doc.includes("svc"));
	assert.ok(doc.includes("1.0.0"));
	assert.ok(doc.includes("token"));
	assert.ok(doc.includes("region"));
	assert.ok(doc.includes("node"));
	assert.ok(doc.includes("secret://model-provider/default"));
	assert.ok(doc.includes("us-east"));
	assert.ok(doc.includes("## Configure Before Start"));
	assert.ok(doc.includes("platform preflight --intent start"));
});

test("renderInstallDoc gives an executable configure → apply → preflight loop for missing required config", () => {
	const svc = moduleFixture({
		moduleRef: "svc",
		kind: "service",
		configSlots: [
			{
				key: "endpoint",
				type: "url",
				required: true,
				description: "service endpoint",
			},
			{
				key: "credential",
				type: "secretRef",
				required: true,
				sensitive: true,
				description: "credential reference",
			},
		],
	});

	const doc = renderInstallDoc({ modules: [svc] });

	assert.ok(doc.includes('"modules"'));
	assert.ok(doc.includes('"svc"'));
	assert.ok(doc.includes('"endpoint": "https://example.invalid"'));
	assert.ok(doc.includes('"credential": "secret://provider/name"'));
	assert.ok(
		doc.includes(
			"platform plan --intent configure --config ./proflow-config.json",
		),
	);
	assert.ok(doc.includes("platform apply <planRef>"));
	assert.ok(doc.includes("platform preflight --intent start"));
});

test("renderInstallDoc redacts a non-secretRef sensitive raw value", () => {
	const svc = moduleFixture({
		moduleRef: "svc",
		kind: "service",
		configSlots: [
			{
				key: "credential",
				type: "string",
				required: true,
				sensitive: true,
				description: "raw credential",
			},
		],
	});

	const doc = renderInstallDoc({
		modules: [svc],
		config: { svc: { credential: "abc-SECRET-xyz" } },
	});

	assert.ok(!doc.includes("abc-SECRET-xyz"));
	assert.ok(doc.includes(SECRET_REDACTED));
});

test("generateInstallDoc writes INSTALL.md and redacts a non-secretRef sensitive raw value", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({
			moduleRef: "svc",
			kind: "service",
			configSlots: [
				{
					key: "credential",
					type: "string",
					required: true,
					sensitive: true,
					description: "raw credential",
				},
			],
		});

		await generateInstallDoc({
			paths,
			modules: [svc],
			config: { svc: { credential: "super-secret-token-123" } },
		});

		const content = await readFile(paths.installMd, "utf8");
		assert.ok(!content.includes("super-secret-token-123"));
		assert.ok(content.includes(SECRET_REDACTED));
		assert.ok(content.includes("svc"));
	} finally {
		await cleanup();
	}
});

test("PRESMOKE-B6-MANIFEST-01 config readiness requires materialized config, not caller-supplied intent", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({
			moduleRef: "svc",
			kind: "service",
			configSlots: [
				{
					key: "token",
					type: "secretRef",
					required: true,
					sensitive: true,
					description: "api token",
				},
			],
		});
		await appendVerification(paths, verificationRecord("svc", "1.0.0", "PASS"));
		const { catalog } = makeCatalog([
			{ module: svc, primitives: { status: () => ok("svc", "1.0.0") } },
		]);

		// Caller-supplied config intent alone must not manufacture READY.
		const notMaterialized = await buildManifest({
			catalog,
			modules: [svc],
			paths,
			config: { svc: { token: "secret://model-provider/default" } },
		});
		assert.equal(notMaterialized.status, "NOT_READY");
		assert.ok(notMaterialized.config[0]?.missing.includes("token"));

		await materializeConfig(paths, {
			moduleRef: "svc",
			values: { token: "secret://model-provider/default" },
			secretRefs: ["token"],
		});
		const materialized = await buildManifest({
			catalog,
			modules: [svc],
			paths,
		});
		assert.equal(materialized.status, "READY");
		assert.deepEqual(materialized.config[0]?.missing, []);
	} finally {
		await cleanup();
	}
});
