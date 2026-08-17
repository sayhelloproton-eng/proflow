import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	runBehaviorConformance,
	runGeneratedPackageConformance,
	runStaticConformance,
} from "@tomflow/proflow-deployment-conformance";
import {
	type ConfigSlot,
	type ModuleDescriptor,
	type ModuleOperationResult,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";
import {
	loadGeneratedBehaviorAdapter,
	materializeModule,
} from "@tomflow/proflow-module-template";
import { workspaceResidentDriver } from "../src/apply/driver.ts";
import { applyPlan } from "../src/apply/index.ts";
import { runCli } from "../src/cli.ts";
import type { ResolvedModule } from "../src/contracts.ts";
import { WorkspaceModuleCatalog } from "../src/discovery/catalog.ts";
import {
	AutoModuleCatalog,
	discoverModules,
} from "../src/discovery/discover.ts";
import { doctorModules } from "../src/doctor/index.ts";
import {
	buildDependencyGraph,
	ModuleRefUnresolvedError,
} from "../src/graph/index.ts";
import { generateInstallDoc, renderInstallDoc } from "../src/install/index.ts";
import {
	dispatchLifecycle,
	startModules,
	statusModules,
} from "../src/lifecycle/index.ts";
import { buildManifest } from "../src/manifest/index.ts";
import type { ModuleCatalog, ModuleSource } from "../src/modules.ts";
import { type WorkspacePaths, workspacePaths } from "../src/paths.ts";
import {
	loadDeploymentState,
	loadVerificationHistory,
	savePlan,
} from "../src/persistence/index.ts";
import {
	assessUpgrade,
	ExecuteStrategy,
	type PlanInput,
	planDeployment,
	planRepair,
	type RepairFact,
} from "../src/planner/index.ts";
import { runPreflight } from "../src/preflight/preflight.ts";
import { verifyModules } from "../src/verification/index.ts";

// ---------------------------------------------------------------------------
// shared fixtures
// ---------------------------------------------------------------------------

const RAW_SECRET_SENTINEL = "RAW_SECRET_SHOULD_NEVER_APPEAR_42f9";
const SECRET_REF = "secret://model-provider/default";

async function tmpWorkspace(): Promise<{
	root: string;
	paths: WorkspacePaths;
	cleanup(): Promise<void>;
}> {
	const root = await mkdtemp(join(tmpdir(), "proflow-cli-final-"));
	return {
		root,
		paths: workspacePaths(root),
		async cleanup() {
			await rm(root, { recursive: true, force: true });
		},
	};
}

function descriptor(
	overrides: Partial<ModuleDescriptor> = {},
): ModuleDescriptor {
	const moduleRef = overrides.moduleRef ?? "fixture";
	const packageName = overrides.packageName ?? `@tomflow/proflow-${moduleRef}`;
	return parseModuleDescriptor({
		contract: "module",
		contractVersion: "1.0.0",
		moduleRef,
		packageName,
		moduleVersion: "1.0.0",
		kind: "service",
		installClass: "optional",
		identity: {
			domain: "deployment-governance",
			summary: "Deployment final integration fixture",
		},
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
		documentation: [],
		...overrides,
	});
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

interface ModuleFixtureInput {
	moduleRef: string;
	kind?: ResolvedModule["kind"];
	moduleVersion?: string;
	provides?: ResolvedModule["provides"];
	requires?: ResolvedModule["requires"];
	requirements?: ResolvedModule["requirements"];
	configSlots?: ResolvedModule["configSlots"];
	lifecycle?: string[];
	verificationChecks?: ResolvedModule["verification"]["checks"];
}

function moduleFixture(input: ModuleFixtureInput): ResolvedModule {
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
		provides: input.provides ?? [],
		requires: input.requires ?? [],
		requirements: input.requirements ?? [],
		configSlots: input.configSlots ?? [],
		lifecycle: input.lifecycle ?? ["describe", "preflight", "verify", "doctor"],
		verification: {
			checks: input.verificationChecks ?? [
				{ id: "health", description: "Observed health", lifecycle: "verify" },
			],
		},
		effects: [],
		source: { type: "workspace" },
	};
}

function ok(
	moduleRef: string,
	version = "1.0.0",
	data?: unknown,
): ModuleOperationResult {
	return {
		contract: "deployment.result.v1",
		ok: true,
		status: "SUCCEEDED",
		moduleRef,
		moduleVersion: version,
		...(data === undefined ? {} : { data }),
	};
}

function failed(
	moduleRef: string,
	version = "1.0.0",
	message = "operation failed",
): ModuleOperationResult {
	return {
		contract: "deployment.result.v1",
		ok: false,
		status: "FAILED",
		moduleRef,
		moduleVersion: version,
		error: { code: "APPLY_FAILED", message, retryable: false },
	};
}

function actionRequired(
	moduleRef: string,
	version = "1.0.0",
	action: string,
	description = action,
): ModuleOperationResult {
	return {
		contract: "deployment.result.v1",
		ok: false,
		status: "ACTION_REQUIRED",
		moduleRef,
		moduleVersion: version,
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

async function collectText(root: string): Promise<string[]> {
	const files: string[] = [];
	async function walk(dir: string): Promise<void> {
		let entries: import("node:fs").Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) await walk(path);
			else if (entry.isFile()) files.push(path);
		}
	}
	await walk(root);
	const texts: string[] = [];
	for (const file of files) {
		try {
			texts.push(await readFile(file, "utf8"));
		} catch {
			// skip binary / unreadable
		}
	}
	return texts;
}

// ---------------------------------------------------------------------------
// D1~D6 Domain Gate mapping — each gate is bound to a machine check, not a
// markdown self-declaration. Every test below drives a real fixture.
// ---------------------------------------------------------------------------

test("D1 Contract Gate — parseModuleDescriptor enforces the frozen module contract", () => {
	const valid = descriptor({ moduleRef: "bound", moduleVersion: "1.2.3" });
	assert.equal(valid.moduleRef, "bound");
	assert.equal(valid.contract, "module");
	assert.equal(valid.contractVersion, "1.0.0");
	// contract drift must be rejected at the boundary
	assert.throws(
		() =>
			parseModuleDescriptor({
				...descriptor(),
				contractVersion: "2.0.0",
			}),
		/contractVersion/,
	);
	assert.throws(
		() =>
			parseModuleDescriptor({
				...descriptor(),
				packageName: "@tomflow/not-proflow",
			}),
		/packageName/,
	);
});

test("D2 Template + Conformance — module-template passes C1/C2/C3 and materialized descriptors conform", async () => {
	const here = dirname(fileURLToPath(import.meta.url));
	const templateDir = resolve(here, "../../module-template");
	const [c1, c2, c3] = await runGeneratedPackageConformance(templateDir);
	assert.deepEqual(
		[c1.status, c2.status, c3.status],
		["PASS", "PASS", "PASS"],
		"module-template must pass all three conformance gates",
	);

	const { paths, cleanup } = await tmpWorkspace();
	try {
		await writeFile(
			join(paths.root, "pnpm-workspace.yaml"),
			'packages:\n  - "d2-generated-service"\n',
		);
		const generated = await materializeModule({
			targetDirectory: paths.root,
			moduleRef: "d2-generated-service",
			packageName: "@tomflow/proflow-d2-generated-service",
			kind: "service",
			installClass: "optional",
			domain: "deployment-governance",
			summary: "Generated Service consumed by Platform CLI",
		});
		assert.equal(runStaticConformance(generated.descriptor).status, "PASS");
		const adapter = await loadGeneratedBehaviorAdapter(
			generated.packageDirectory,
		);
		assert.equal(
			(await runBehaviorConformance(generated.descriptor, adapter)).status,
			"PASS",
		);

		const modules = JSON.parse(
			await runCli([
				"modules",
				"d2-generated-service",
				"--workspace",
				paths.root,
			]),
		) as { status: string; data?: Array<{ moduleRef: string; kind: string }> };
		assert.equal(modules.status, "SUCCEEDED");
		assert.equal(modules.data?.length, 1);
		assert.equal(modules.data?.[0]?.moduleRef, "d2-generated-service");
		assert.equal(modules.data?.[0]?.kind, "service");

		const docs = JSON.parse(
			await runCli(["docs", "d2-generated-service", "--workspace", paths.root]),
		) as { status: string; data?: { moduleRef?: string; kind?: string } };
		assert.equal(docs.status, "SUCCEEDED");
		assert.equal(docs.data?.moduleRef, "d2-generated-service");
		assert.equal(docs.data?.kind, "service");

		const status = JSON.parse(
			await runCli([
				"status",
				"d2-generated-service",
				"--workspace",
				paths.root,
			]),
		) as { status: string; data?: Array<{ result?: { status?: string } }> };
		assert.equal(status.status, "ACTION_REQUIRED");
		assert.equal(status.data?.[0]?.result?.status, "ACTION_REQUIRED");

		const verify = JSON.parse(
			await runCli([
				"verify",
				"d2-generated-service",
				"--workspace",
				paths.root,
			]),
		) as {
			status: string;
			data?: Array<{ result?: { status?: string; error?: { code?: string } } }>;
		};
		assert.equal(verify.status, "FAILED");
		assert.equal(verify.data?.[0]?.result?.status, "FAILED");
		assert.equal(verify.data?.[0]?.result?.error?.code, "VERIFY_FAILED");
	} finally {
		await cleanup();
	}
});

test("D3 Platform CLI Offline — a fake module closes the loop with no network I/O", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({
			moduleRef: "offline",
			kind: "service",
			lifecycle: ["describe", "preflight", "status", "verify", "doctor"],
			configSlots: [configSlot("port", { required: true })],
		});
		const config = { offline: { port: "8080" } };
		const { calls, catalog } = makeCatalog([
			{
				module: svc,
				primitives: {
					preflight: () => ok("offline"),
					status: () => ok("offline", "1.0.0", { processRunning: true }),
					verify: () => ok("offline"),
					doctor: () => ok("offline"),
				},
			},
		]);

		const preflight = await runPreflight([svc], { catalog, config });
		assert.equal(preflight.status, "READY");

		const plan = planDeployment({ intent: "install", modules: [svc], config });
		await savePlan(paths, plan);
		const current: PlanInput = { intent: "install", modules: [svc], config };
		const applied = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			driver: workspaceResidentDriver(),
			current,
		});
		assert.equal(applied.outcome, "COMPLETE");

		await verifyModules(catalog, [svc], paths);
		const manifest = await buildManifest({
			catalog,
			modules: [svc],
			paths,
			config,
		});
		assert.equal(manifest.status, "READY");

		// no network primitive exists in the offline control flow
		assert.deepEqual(
			new Set(calls.map((call) => call.primitive)),
			new Set(["status", "verify", "preflight"]),
		);
	} finally {
		await cleanup();
	}
});

test("D4 External Resource Governance — real adapters report honest ACTION_REQUIRED, never fake READY", async () => {
	const here = dirname(fileURLToPath(import.meta.url));
	const repoRoot = resolve(here, "../../..");
	const catalog = new WorkspaceModuleCatalog(repoRoot);
	const modules = await discoverModules({ workspaceRoot: repoRoot });
	const external = modules.filter(
		(module) => module.kind === "external-resource",
	);

	assert.deepEqual(external.map((module) => module.moduleRef).sort(), [
		"chatgpt-carrier",
		"chrome-runtime",
		"dev-tunnel",
		"model-provider-api",
	]);
	for (const module of external) {
		const dispatched = await dispatchLifecycle(catalog, module, "status");
		assert.notEqual(
			dispatched.result.status,
			"SUCCEEDED",
			`${module.moduleRef} must not fabricate readiness without real evidence`,
		);
		assert.equal(dispatched.result.status, "ACTION_REQUIRED");
	}
});

test("D5 Cross-domain Deployment — a library + service + external-resource graph plans together", () => {
	const lib = moduleFixture({
		moduleRef: "d5-lib",
		kind: "library",
		provides: [{ contractRef: "d5.cap", version: "1.0.0" }],
	});
	const svc = moduleFixture({
		moduleRef: "d5-svc",
		kind: "service",
		requires: [{ contractRef: "d5.cap", versionRange: ">=1.0.0 <2.0.0" }],
	});
	const ext = moduleFixture({
		moduleRef: "d5-ext",
		kind: "external-resource",
		lifecycle: ["describe", "preflight", "status", "verify", "doctor"],
	});
	const modules = [lib, svc, ext];
	const graph = buildDependencyGraph(modules);
	assert.deepEqual(graph.order, ["d5-lib", "d5-svc", "d5-ext"].sort());
	assert.ok(graph.order.indexOf("d5-svc") > graph.order.indexOf("d5-lib"));

	const plan = planDeployment({ intent: "install", modules });
	assert.ok(
		plan.steps.some(
			(step) => step.moduleRef === "d5-svc" && step.kind === "package",
		),
	);
	// Track A (deterministic full chain) and Track B (real descriptors) prove the
	// cross-domain loop end-to-end below.
});

test("D6 Failure Injection — an injected FAILED stop never fakes success", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const ext = moduleFixture({
			moduleRef: "d6-ext",
			kind: "external-resource",
			lifecycle: [
				"describe",
				"preflight",
				"status",
				"verify",
				"doctor",
				"start",
				"stop",
			],
		});
		const plan = planDeployment({ intent: "install", modules: [ext] });
		await savePlan(paths, plan);

		const { catalog } = makeCatalog([
			{
				module: ext,
				primitives: {
					status: () => ok("d6-ext", "1.0.0", { resourceConfigured: false }),
					start: () => failed("d6-ext", "1.0.0", "injected start failure"),
				},
			},
		]);
		const current: PlanInput = { intent: "install", modules: [ext] };

		const applied = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			driver: workspaceResidentDriver(),
			current,
		});
		assert.equal(applied.outcome, "FAILED");
		assert.equal(applied.stepResults.at(-1)?.status, "FAILED");
		const state = await loadDeploymentState(paths);
		assert.deepEqual(state?.lastAppliedPlans ?? [], []);
	} finally {
		await cleanup();
	}
});

// ---------------------------------------------------------------------------
// D5 Track A — deterministic full-chain fixture
// preflight → plan → apply → ACTION_REQUIRED/resume → lifecycle → verify →
// manifest READY → upgrade history
// ---------------------------------------------------------------------------

const LIB_LIFECYCLE = ["describe", "preflight", "verify", "doctor"];
const SVC_LIFECYCLE = [
	"describe",
	"preflight",
	"status",
	"verify",
	"doctor",
	"start",
	"stop",
];
const EXT_LIFECYCLE = [
	"describe",
	"preflight",
	"status",
	"verify",
	"doctor",
	"start",
	"stop",
];
const AGENT_LIFECYCLE = ["describe", "preflight", "status", "verify", "doctor"];

test("Track A — deterministic full-chain closes preflight→apply→lifecycle→verify→manifest READY", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const lib = moduleFixture({
			moduleRef: "lib-a",
			kind: "library",
			lifecycle: LIB_LIFECYCLE,
			provides: [{ contractRef: "lib.a", version: "1.0.0" }],
		});
		const svc = moduleFixture({
			moduleRef: "svc-b",
			kind: "service",
			lifecycle: SVC_LIFECYCLE,
			requires: [{ contractRef: "lib.a", versionRange: ">=1.0.0 <2.0.0" }],
			configSlots: [configSlot("port", { required: true })],
		});
		const ext = moduleFixture({
			moduleRef: "ext-c",
			kind: "external-resource",
			lifecycle: EXT_LIFECYCLE,
			configSlots: [
				configSlot("publicBaseUrl", { type: "url", required: true }),
			],
			requirements: [{ kind: "human", action: "Complete tunnel login" }],
		});
		const agent = moduleFixture({
			moduleRef: "agent-d",
			kind: "agent-package",
			lifecycle: AGENT_LIFECYCLE,
			provides: [{ contractRef: "agent.observable", version: "1.0.0" }],
		});
		const modules = [lib, svc, ext, agent];
		const config = {
			"svc-b": { port: "8080" },
			"ext-c": { publicBaseUrl: "https://tunnel.example" },
		};

		// mutable reality driving the external-resource/human observation
		let resourceConfigured = false;
		let humanActionVerified = false;

		const { calls, catalog } = makeCatalog([
			{
				module: svc,
				primitives: {
					status: () => ok("svc-b", "1.0.0", { processRunning: true }),
					start: () => ok("svc-b", "1.0.0", { processRunning: true }),
					verify: () => ok("svc-b"),
				},
			},
			{
				module: ext,
				primitives: {
					status: () =>
						ok("ext-c", "1.0.0", { resourceConfigured, humanActionVerified }),
					start: () =>
						resourceConfigured
							? ok("ext-c", "1.0.0", { resourceConfigured: true })
							: actionRequired(
									"ext-c",
									"1.0.0",
									"login",
									"Complete tunnel login",
								),
					verify: () => ok("ext-c"),
				},
			},
			{
				module: lib,
				primitives: {
					verify: () => ok("lib-a"),
				},
			},
			{
				module: agent,
				primitives: {
					status: () => ok("agent-d"),
					verify: () => ok("agent-d"),
				},
			},
		]);

		// 1. preflight surfaces the honest human requirement
		const preflight = await runPreflight(modules, { catalog, config });
		assert.equal(preflight.status, "ACTION_REQUIRED");
		assert.ok(
			preflight.findings.some(
				(finding) =>
					finding.code === "HUMAN_ACTION" && finding.moduleRef === "ext-c",
			),
		);

		// 2. plan
		const plan = planDeployment({ intent: "install", modules, config });
		await savePlan(paths, plan);
		assert.ok(plan.steps.some((step) => step.kind === "external-resource"));
		assert.ok(plan.steps.some((step) => step.kind === "human"));

		const current: PlanInput = { intent: "install", modules, config };

		// 3. apply — first pass hits the external-resource start → ACTION_REQUIRED
		const first = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			driver: workspaceResidentDriver(),
			current,
		});
		assert.equal(first.outcome, "ACTION_REQUIRED");
		const pendingState = await loadDeploymentState(paths);
		assert.equal(pendingState?.pendingActions.length, 1);
		assert.equal(pendingState?.pendingActions[0]?.moduleRef, "ext-c");
		assert.deepEqual(pendingState?.lastAppliedPlans ?? [], []);

		// 4. resume — reality now reports the resource configured + action verified
		resourceConfigured = true;
		humanActionVerified = true;
		const resumed = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			driver: workspaceResidentDriver(),
			current,
		});
		assert.equal(resumed.outcome, "COMPLETE");
		const finalState = await loadDeploymentState(paths);
		assert.deepEqual(
			finalState?.lastAppliedPlans.map((entry) => entry.planRef),
			[plan.planRef],
		);
		assert.equal(finalState?.pendingActions.length, 0);
		assert.deepEqual(
			(finalState?.selectedModules ?? [])
				.map((entry) => entry.moduleRef)
				.sort(),
			["agent-d", "ext-c", "lib-a", "svc-b"],
		);

		// 5. lifecycle — forward start order, live status
		await startModules(catalog, modules);
		await statusModules(catalog, modules);
		assert.ok(calls.some((call) => call.primitive === "start"));

		// 6. verify → PASS records
		const verified = await verifyModules(catalog, modules, paths);
		assert.equal(verified.length, 4);
		for (const result of verified) {
			assert.equal(result.record.result, "PASS");
		}

		// 7. manifest → READY (live status + current-version PASS verification)
		const manifest = await buildManifest({ catalog, modules, paths, config });
		assert.equal(manifest.status, "READY");
		assert.ok(
			manifest.modules.every(
				(entry) => entry.runtimeObserved || entry.kind === "library",
			),
		);
	} finally {
		await cleanup();
	}
});

// ---------------------------------------------------------------------------
// D5 Track B — real ProFlow descriptor integration
// ---------------------------------------------------------------------------

function repoRoot(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	return resolve(here, "../../..");
}

test("Track B — discovery loads every real package descriptor + the 4 external adapters + platform-host", async () => {
	const modules = await discoverModules({ workspaceRoot: repoRoot() });
	const byRef = new Map(modules.map((module) => [module.moduleRef, module]));

	for (const ref of [
		"chatgpt-carrier",
		"chrome-runtime",
		"dev-tunnel",
		"model-provider-api",
		"platform-host",
	]) {
		assert.ok(byRef.has(ref), `missing real descriptor ${ref}`);
	}
	assert.equal(byRef.get("platform-host")?.kind, "service");
	assert.equal(byRef.get("chatgpt-carrier")?.kind, "external-resource");
});

test("Track B — a coherent platform-host subgraph resolves with correct order", async () => {
	const modules = await discoverModules({ workspaceRoot: repoRoot() });
	const byRef = new Map(modules.map((module) => [module.moduleRef, module]));
	const subset = [
		"platform-host",
		"task-orchestration",
		"agent-runtime",
		"execution-runtime",
		"execution-local",
		"model-runtime",
		"model-provider-api",
	].map((ref) => {
		const module = byRef.get(ref);
		assert.ok(module !== undefined, `missing ${ref}`);
		return module;
	});

	const graph = buildDependencyGraph(subset);
	assert.equal(graph.order.at(-1), "platform-host");
	assert.ok(
		graph.order.indexOf("platform-host") >
			graph.order.indexOf("task-orchestration"),
	);
});

test("Track B — moduleRef bindings resolve against the real model-provider module", async () => {
	const modules = await discoverModules({ workspaceRoot: repoRoot() });
	const byRef = new Map(modules.map((module) => [module.moduleRef, module]));
	const subset = ["model-runtime", "model-contracts", "model-provider-api"].map(
		(ref) => {
			const module = byRef.get(ref);
			assert.ok(module !== undefined, `missing ${ref}`);
			return module;
		},
	);

	const graph = buildDependencyGraph(subset, {
		config: { "model-runtime": { providerModuleRef: "model-provider-api" } },
	});
	assert.ok(graph.edges.some((edge) => edge.kind === "moduleRef"));

	assert.throws(
		() =>
			buildDependencyGraph(subset, {
				config: { "model-runtime": { providerModuleRef: "missing-module" } },
			}),
		ModuleRefUnresolvedError,
	);
});

test("Track B — unsupported lifecycle is rejected, never faked", async () => {
	const catalog = new WorkspaceModuleCatalog(repoRoot());
	const modules = await discoverModules({ workspaceRoot: repoRoot() });
	const carrier = modules.find(
		(module) => module.moduleRef === "chatgpt-carrier",
	);
	assert.ok(carrier !== undefined);

	await assert.rejects(
		dispatchLifecycle(catalog, carrier, "start"),
		(error: unknown) => {
			assert.ok(error instanceof Error);
			return (
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				error.code === "LIFECYCLE_UNSUPPORTED"
			);
		},
	);
});

test("Track B — unverified external resources yield a Manifest that is not fake READY", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const catalog = new WorkspaceModuleCatalog(repoRoot());
		const modules = (
			await discoverModules({ workspaceRoot: repoRoot() })
		).filter(
			(module) =>
				module.kind === "external-resource" ||
				module.moduleRef === "platform-host",
		);

		// no config → required slots missing, no real verification → not READY
		const manifest = await buildManifest({ catalog, modules, paths });
		assert.notEqual(manifest.status, "READY");
		assert.ok(
			manifest.config.some((entry) => entry.missing.length > 0),
			"external resources with required config must be missing it here",
		);
	} finally {
		await cleanup();
	}
});

// ---------------------------------------------------------------------------
// Upgrade integration — real current/target catalogs (v1 vs v2)
// ---------------------------------------------------------------------------

test("CP-DPL-CLI-06 upgrade — current != target drives a migrate step and never a rollback step", () => {
	const current = descriptor({
		moduleRef: "m",
		moduleVersion: "1.0.0",
		provides: [{ contractRef: "cap", version: "1.0.0" }],
		lifecycle: {
			supported: ["describe", "preflight", "verify", "doctor", "migrate"],
		},
	});
	const target = descriptor({
		moduleRef: "m",
		moduleVersion: "2.0.0",
		provides: [{ contractRef: "cap", version: "2.0.0" }],
		lifecycle: {
			supported: ["describe", "preflight", "verify", "doctor", "migrate"],
		},
	});

	assert.notEqual(current.moduleVersion, target.moduleVersion);
	const assessment = assessUpgrade(current, target);
	assert.equal(assessment.compatible, false);
	assert.equal(assessment.migrationRequired, true);

	const plan = planDeployment({
		intent: "upgrade",
		currentDescriptors: [current],
		targetDescriptors: [target],
	});
	assert.equal(plan.resolvedModules[0]?.moduleVersion, "2.0.0");
	assert.ok(
		plan.steps.some(
			(step) =>
				step.kind === "lifecycle" &&
				step.executeStrategy === ExecuteStrategy.lifecycleMigrate,
		),
	);
	assert.ok(
		plan.steps.some(
			(step) => step.executeStrategy === ExecuteStrategy.packageUpgrade,
		),
	);
	const strategies = plan.steps
		.map((step) => step.executeStrategy)
		.filter((strategy): strategy is string => strategy !== undefined);
	assert.ok(
		!strategies.includes("rollback"),
		"no auto rollback step may exist",
	);
});

test("upgrade — migration is emitted only when the target declares migrate", () => {
	const current = descriptor({ moduleRef: "m", moduleVersion: "1.0.0" });
	const target = descriptor({
		moduleRef: "m",
		moduleVersion: "1.0.1",
		lifecycle: { supported: ["describe", "preflight", "verify", "doctor"] },
	});
	const plan = planDeployment({
		intent: "upgrade",
		currentDescriptors: [current],
		targetDescriptors: [target],
	});
	assert.ok(
		!plan.steps.some(
			(step) => step.executeStrategy === ExecuteStrategy.lifecycleMigrate,
		),
	);
});

test("CP-DPL-CLI-06 upgrade — a verify FAIL during upgrade preserves prior PASS history (no erase)", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({
			moduleRef: "upgrade-svc",
			kind: "service",
			lifecycle: ["describe", "preflight", "status", "verify", "doctor"],
		});
		let verifyPasses = true;
		const { catalog } = makeCatalog([
			{
				module: svc,
				primitives: {
					status: () => ok("upgrade-svc"),
					verify: () =>
						verifyPasses
							? ok("upgrade-svc")
							: failed("upgrade-svc", "1.0.0", "verify failed after upgrade"),
				},
			},
		]);

		await verifyModules(catalog, [svc], paths);
		verifyPasses = false;
		await verifyModules(catalog, [svc], paths);

		const history = await loadVerificationHistory(paths, "upgrade-svc");
		assert.equal(history.length, 2);
		assert.equal(history[0]?.result, "PASS");
		assert.equal(history[1]?.result, "FAIL");
	} finally {
		await cleanup();
	}
});

// ---------------------------------------------------------------------------
// Repair integration — doctor facts → repair plan → apply; unknown facts never
// invent a mutation
// ---------------------------------------------------------------------------

test("repair — doctor FAILED flows into a repair plan and applies the declared capability", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({
			moduleRef: "repair-svc",
			kind: "service",
			lifecycle: [
				"describe",
				"preflight",
				"status",
				"verify",
				"doctor",
				"start",
			],
		});
		let running = false;
		const { catalog } = makeCatalog([
			{
				module: svc,
				primitives: {
					status: () => ok("repair-svc", "1.0.0", { processRunning: running }),
					start: () => {
						running = true;
						return ok("repair-svc", "1.0.0", { processRunning: true });
					},
					doctor: () => failed("repair-svc", "1.0.0", "process not running"),
					verify: () => ok("repair-svc"),
				},
			},
		]);

		const reports = await doctorModules(catalog, [svc]);
		assert.equal(reports.length, 1);
		assert.equal(reports[0]?.status, "FAILED");
		assert.equal(reports[0]?.nextAction.kind, "repair-plan");

		const facts: RepairFact[] = [
			{
				moduleRef: "repair-svc",
				code: "LIFECYCLE_NOT_RUNNING",
				message: "not running",
			},
		];
		const plan = planRepair({ modules: [svc], facts });
		assert.ok(
			plan.steps.some(
				(step) =>
					step.kind === "lifecycle" &&
					step.executeStrategy === ExecuteStrategy.lifecycleStart,
			),
		);
		await savePlan(paths, plan);

		const current: PlanInput = { intent: "repair", modules: [svc], facts };
		const applied = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			driver: workspaceResidentDriver(),
			current,
		});
		assert.equal(applied.outcome, "COMPLETE");
		assert.equal(running, true);
	} finally {
		await cleanup();
	}
});

test("repair — an unmappable fact (verify-failed / target-behind) never invents a mutation", () => {
	const svc = moduleFixture({
		moduleRef: "repair-svc",
		kind: "service",
		lifecycle: ["describe", "preflight", "verify", "doctor", "start"],
	});
	// A module whose only issue is being behind target must be routed to the
	// upgrade path, never a repair-mutated step; VERIFY_FAILED and
	// DEPENDENCY_UNRESOLVED are declared fact codes with no repair mapping.
	const plan = planRepair({
		modules: [svc],
		facts: [
			{
				moduleRef: "repair-svc",
				code: "VERIFY_FAILED",
				message: "verification failed",
			},
			{
				moduleRef: "repair-svc",
				code: "DEPENDENCY_UNRESOLVED",
				message: "no provider",
			},
		],
	});
	assert.equal(
		plan.steps.length,
		0,
		"no invented mutation for unmappable facts",
	);
});

// ---------------------------------------------------------------------------
// Secret integration — raw sentinel must never survive any artifact; secretRef
// identity must be preserved verbatim
// ---------------------------------------------------------------------------

test("secret — secretRef identity survives the full chain verbatim, raw sentinel appears zero times", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({
			moduleRef: "secret-svc",
			kind: "service",
			lifecycle: ["describe", "preflight", "status", "verify", "doctor"],
			configSlots: [
				configSlot("credential", { type: "secretRef", required: true }),
				configSlot("region", { required: false }),
			],
		});
		const config = {
			"secret-svc": { credential: SECRET_REF, region: "us-east" },
		};
		const { catalog } = makeCatalog([
			{
				module: svc,
				primitives: {
					status: () => ok("secret-svc"),
					verify: () => ok("secret-svc"),
				},
			},
		]);

		const plan = planDeployment({ intent: "install", modules: [svc], config });
		await savePlan(paths, plan);
		const current: PlanInput = { intent: "install", modules: [svc], config };
		const applied = await applyPlan({
			paths,
			planRef: plan.planRef,
			catalog,
			driver: workspaceResidentDriver(),
			current,
		});
		assert.equal(applied.outcome, "COMPLETE");

		await verifyModules(catalog, [svc], paths);
		const manifest = await buildManifest({
			catalog,
			modules: [svc],
			paths,
			config,
		});
		await generateInstallDoc({ paths, modules: [svc], config });

		// secretRef identity is preserved verbatim, never destroyed by <redacted>
		const planRaw = await readFile(
			join(paths.plans, `${plan.planRef}.json`),
			"utf8",
		);
		assert.ok(planRaw.includes(SECRET_REF));
		assert.ok(!planRaw.includes("<redacted>"));
		const publicConfig = await readFile(
			join(paths.config, "secret-svc.json"),
			"utf8",
		);
		assert.ok(publicConfig.includes(SECRET_REF));
		const manifestJson = JSON.stringify(manifest);
		assert.ok(manifestJson.includes(SECRET_REF));

		// defense-in-depth: the raw sentinel appears zero times across every artifact
		const artifacts = await collectText(paths.proflow);
		assert.ok(artifacts.length > 0);
		for (const text of artifacts) {
			assert.equal(
				text.includes(RAW_SECRET_SENTINEL),
				false,
				"raw secret sentinel leaked into a persisted artifact",
			);
		}
	} finally {
		await cleanup();
	}
});

test("secret — generated INSTALL deep-redacts a raw secret sentinel", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const svc = moduleFixture({
			moduleRef: "secret-install",
			kind: "service",
			lifecycle: ["describe", "preflight", "verify", "doctor"],
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
			config: { "secret-install": { credential: RAW_SECRET_SENTINEL } },
		});
		const doc = await readFile(paths.installMd, "utf8");
		assert.ok(!doc.includes(RAW_SECRET_SENTINEL));
		assert.ok(doc.includes("<redacted>"));
	} finally {
		await cleanup();
	}
});

test("secret — generated INSTALL preserves a secretRef identity verbatim (frozen design: identity, not raw secret)", () => {
	const svc = moduleFixture({
		moduleRef: "secret-install-identity",
		kind: "service",
		lifecycle: ["describe", "preflight", "verify", "doctor"],
		configSlots: [
			configSlot("credential", { type: "secretRef", required: true }),
		],
	});
	const doc = renderInstallDoc({
		modules: [svc],
		config: { "secret-install-identity": { credential: SECRET_REF } },
	});
	// A secretRef value is an opaque reference identity, not a raw token; the
	// frozen design (spec §Secret, security/redact.ts, planner/fingerprint.ts)
	// requires it to survive verbatim, never substituted with <redacted>.
	assert.ok(doc.includes(SECRET_REF), "secretRef identity must be preserved");
	assert.ok(!doc.includes("<redacted>"));
});

test("PRESMOKE-B6-BINDER-01 shipped AutoModuleCatalog binds a real local service adapter over the unbound default", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-cli-binder-"));
	try {
		await mkdir(join(root, "packages", "svc", "deployment"), {
			recursive: true,
		});
		await writeFile(
			join(root, "pnpm-workspace.yaml"),
			'packages:\n  - "packages/*"\n',
		);
		await writeFile(
			join(root, "packages", "svc", "package.json"),
			JSON.stringify({
				name: "@tomflow/proflow-svc",
				version: "1.0.0",
				proflow: {
					module: true,
					installClass: "optional",
					descriptor: "./deployment/descriptor.ts",
					manifest: "./proflow.module.json",
					installRequires: [],
				},
			}),
		);
		await writeFile(
			join(root, "packages", "svc", "deployment", "descriptor.ts"),
			`export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "svc",
	packageName: "@tomflow/proflow-svc",
	moduleVersion: "1.0.0",
	kind: "service",
	installClass: "optional",
	identity: { domain: "deployment-governance", summary: "Platform binding test service" },
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	provides: [],
	requires: [],
	requirements: [],
	configSlots: [],
	lifecycle: { supported: ["describe", "preflight", "status", "verify", "doctor", "start", "stop", "restart"] },
	verification: { checks: [{ id: "health", description: "Observed health", lifecycle: "verify" }] },
	effects: [],
	documentation: [],
} as const;
`,
		);
		await writeFile(
			join(root, "packages", "svc", "deployment", "adapter.ts"),
			`type Service = { status(): "RUNNING" | "STOPPED"; inspect(): { readiness: "READY" | "NOT_READY" }; start(): Promise<unknown>; stop(): Promise<unknown> };
const base = { contract: "deployment.result.v1", ok: true, status: "SUCCEEDED", moduleRef: "svc", moduleVersion: "1.0.0" } as const;
const unbound = { ...base, ok: false, status: "ACTION_REQUIRED", actionRequired: { action: "bind-service", description: "No service bound" } } as const;
export function createBehaviorAdapter(input?: { service: Service }) {
	return {
		describe: () => ({ result: base, observedEffects: [] }),
		preflight: () => ({ result: input ? base : unbound, observedEffects: [] }),
		status: () => ({
			result: input ? { ...base, checks: [{ id: "runtime", status: "PASS", message: "runtime=" + input.service.status() }] } : unbound,
			observedEffects: [],
		}),
		verify: async () => ({ result: input ? { ...base, checks: [{ id: "health", status: input.service.inspect().readiness === "READY" ? "PASS" : "FAIL", message: "health" }] } : unbound, observedEffects: [] }),
		doctor: () => ({ result: input ? base : unbound, observedEffects: [] }),
		start: async () => ({ result: input ? { ...base, data: await input.service.start() } : unbound, observedEffects: input ? ["start"] : [] }),
		stop: async () => ({ result: input ? (await input.service.stop(), base) : unbound, observedEffects: input ? ["stop"] : [] }),
	};
}
export const behaviorAdapter = createBehaviorAdapter();
`,
		);

		// A real local service with an HTTP transport and current-reality inspect.
		const { createServer } = await import("node:http");
		let running = false;
		let server: import("node:http").Server | undefined;
		const service = {
			status() {
				return running ? ("RUNNING" as const) : ("STOPPED" as const);
			},
			inspect() {
				return {
					readiness: running ? ("READY" as const) : ("NOT_READY" as const),
				};
			},
			async start() {
				server = createServer((_req, res) => {
					res.end("ok");
				});
				await new Promise<void>((resolve) =>
					server?.listen(0, "127.0.0.1", resolve),
				);
				running = true;
				return { host: "127.0.0.1", port: 0 };
			},
			async stop() {
				await new Promise<void>((resolve) => server?.close(() => resolve()));
				server = undefined;
				running = false;
			},
		};

		// Production binder: dynamically import the shipped adapter factory and
		// bind the real service, keyed by packageName.
		const adapterUrl = join(
			root,
			"packages",
			"svc",
			"deployment",
			"adapter.ts",
		);
		const adapterNs = (await import(adapterUrl)) as {
			createBehaviorAdapter: (input?: {
				service: typeof service;
			}) => Record<string, unknown>;
		};
		const bound = {
			behaviorAdapter: adapterNs.createBehaviorAdapter({ service }),
		};
		const catalog = new AutoModuleCatalog(
			root,
			new Map([["@tomflow/proflow-svc", bound]]),
		);

		const modules = await discoverModules({ catalog });
		assert.equal(modules.length, 1);
		assert.equal(modules[0]?.moduleRef, "svc");

		// Unbound default reports ACTION_REQUIRED; bound adapter reports real status.
		const [statusRun] = await statusModules(catalog, modules);
		assert.equal(statusRun?.result?.status, "SUCCEEDED");
		const [startRun] = await startModules(catalog, modules);
		assert.equal(startRun?.result?.status, "SUCCEEDED");
		const [afterStart] = await statusModules(catalog, modules);
		assert.equal(afterStart?.result?.checks?.[0]?.status, "PASS");
		const [verify] = await verifyModules(
			catalog,
			modules,
			workspacePaths(root),
		);
		assert.equal(verify?.result?.status, "SUCCEEDED");
		await service.stop();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
