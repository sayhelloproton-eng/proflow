import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModuleOperationResult } from "@tomflow/proflow-module-contract";
import type { ResolvedModule } from "../src/contracts.ts";
import {
	observeStatuses,
	setupModulesThin,
	startModulesThin,
	stopModulesThin,
	uninstallModulesThin,
} from "../src/lifecycle/index.ts";
import type { ModuleCatalog, ModuleSource } from "../src/modules.ts";

type Command =
	| "install"
	| "uninstall"
	| "status"
	| "setup"
	| "docs"
	| "start"
	| "stop";
const workspaceRoot = "/fixture/workspace";

function moduleFixture(input: {
	moduleRef: string;
	kind?: ResolvedModule["kind"];
	provides?: ResolvedModule["provides"];
	requires?: ResolvedModule["requires"];
}): ResolvedModule {
	return {
		moduleRef: input.moduleRef,
		packageName: `@tomflow/proflow-${input.moduleRef}`,
		moduleVersion: "1.0.0",
		kind: input.kind ?? "service",
		identity: { domain: "deployment-governance", summary: "Lifecycle fixture" },
		documentation: { docs: "DOCS.md", setup: "SETUP.md" },
		provides: input.provides ?? [],
		requires: input.requires ?? [],
		requirements: [],
		configSlots: [],
		effects: [],
		source: { type: "workspace", path: `/fixture/${input.moduleRef}` },
	};
}

function success(moduleRef: string, data?: unknown): ModuleOperationResult {
	return {
		contract: "deployment.result.v1",
		ok: true,
		status: "SUCCEEDED",
		moduleRef,
		moduleVersion: "1.0.0",
		...(data === undefined ? {} : { data }),
	};
}

function recordingCatalog(
	setupByRef: Readonly<
		Record<string, "READY" | "ACTION_REQUIRED" | "BLOCKED" | "FAILED">
	> = {},
	setupResultByRef: Readonly<Record<string, "ACTION_REQUIRED" | "FAILED">> = {},
	startFailureByRef: Readonly<Record<string, boolean>> = {},
	stopFailureByRef: Readonly<Record<string, boolean>> = {},
	uninstallFailureByRef: Readonly<Record<string, boolean>> = {},
	setupStatusAfterSetupByRef: Readonly<
		Record<string, "READY" | "ACTION_REQUIRED" | "BLOCKED" | "FAILED">
	> = {},
	runtimeStatusByRef: Readonly<
		Record<
			string,
			"RUNNING" | "STOPPED" | "FAILED" | "UNKNOWN" | "NOT_APPLICABLE"
		>
	> = {},
) {
	const calls: Array<{ call: string; input?: unknown }> = [];
	const runtimeByRef = new Map<string, "RUNNING" | "STOPPED">();
	const currentSetupByRef = { ...setupByRef };
	const catalog: ModuleCatalog = {
		async sources() {
			return [];
		},
		async loadDescriptor() {
			return {};
		},
		async loadAdapter(source: ModuleSource) {
			const moduleRef = source.packageName.replace("@tomflow/proflow-", "");
			const op = (command: Command) => async (context: { input?: unknown }) => {
				calls.push({
					call: `${moduleRef}:${command}`,
					...(context.input === undefined ? {} : { input: context.input }),
				});
				if (command === "setup" && setupResultByRef[moduleRef]) {
					const setupResult = setupResultByRef[moduleRef];
					return setupResult === "ACTION_REQUIRED"
						? {
								result: {
									contract: "deployment.result.v1" as const,
									ok: false,
									status: "ACTION_REQUIRED" as const,
									moduleRef,
									moduleVersion: "1.0.0",
									actionRequired: {
										action: `configure-${moduleRef}`,
										description: `Configure ${moduleRef}`,
									},
								},
								observedEffects: [],
							}
						: {
								result: {
									contract: "deployment.result.v1" as const,
									ok: false,
									status: "FAILED" as const,
									moduleRef,
									moduleVersion: "1.0.0",
									error: {
										code: "SETUP_FAILED" as const,
										message: `Machine failure ${moduleRef}`,
										retryable: true,
									},
								},
								observedEffects: [],
							};
				}
				if (command === "setup" && setupStatusAfterSetupByRef[moduleRef])
					currentSetupByRef[moduleRef] = setupStatusAfterSetupByRef[moduleRef];
				if (command === "start" && startFailureByRef[moduleRef]) {
					return {
						result: {
							contract: "deployment.result.v1" as const,
							ok: false,
							status: "FAILED" as const,
							moduleRef,
							moduleVersion: "1.0.0",
							error: {
								code: "START_FAILED" as const,
								message: `Start failure ${moduleRef}`,
								retryable: true,
							},
						},
						observedEffects: [],
					};
				}
				if (command === "start") runtimeByRef.set(moduleRef, "RUNNING");
				if (
					(command === "stop" && stopFailureByRef[moduleRef]) ||
					(command === "uninstall" && uninstallFailureByRef[moduleRef])
				) {
					const errorCode =
						command === "stop" ? "STOP_FAILED" : "UNINSTALL_FAILED";
					return {
						result: {
							contract: "deployment.result.v1" as const,
							ok: false,
							status: "FAILED" as const,
							moduleRef,
							moduleVersion: "1.0.0",
							error: {
								code: errorCode,
								message: `${command} failure ${moduleRef}`,
								retryable: true,
							},
						},
						observedEffects: [],
					};
				}
				if (command === "stop") runtimeByRef.set(moduleRef, "STOPPED");
				const setupStatus = currentSetupByRef[moduleRef] ?? "READY";
				const runtimeStatus =
					runtimeStatusByRef[moduleRef] ??
					runtimeByRef.get(moduleRef) ??
					"STOPPED";
				const issues = [
					...(setupStatus === "READY"
						? []
						: [
								{
									scope: "SETUP" as const,
									code: "NOT_READY",
									message: `${moduleRef} is not ready`,
									relatedModuleRefs: [],
									nextCommand: `platform setup --module ${moduleRef}`,
								},
							]),
					...(runtimeStatus === "FAILED"
						? [
								{
									scope: "RUNTIME" as const,
									code: "RUNTIME_FAILED",
									message: `${moduleRef} runtime failed`,
									relatedModuleRefs: [],
									nextCommand: `platform setup --module ${moduleRef}`,
								},
							]
						: []),
				];
				const data =
					command === "status"
						? {
								setupStatus,
								runtimeStatus,
								...(issues.length > 0 ? { issues } : {}),
							}
						: undefined;
				return {
					result: success(moduleRef, data),
					observedEffects: command === "stop" ? ["Stopped fixture"] : [],
				};
			};
			return {
				behaviorAdapter: {
					install: op("install"),
					uninstall: op("uninstall"),
					status: op("status"),
					setup: op("setup"),
					docs: op("docs"),
					start: op("start"),
					stop: op("stop"),
				},
			};
		},
	};
	return { catalog, calls };
}

const provider = moduleFixture({
	moduleRef: "provider",
	provides: [{ contractRef: "fixture.a", version: "1.0.0" }],
});
const consumer = moduleFixture({
	moduleRef: "consumer",
	provides: [{ contractRef: "fixture.b", version: "1.0.0" }],
	requires: [{ contractRef: "fixture.a", versionRange: ">=1.0.0" }],
});
const leaf = moduleFixture({
	moduleRef: "leaf",
	requires: [{ contractRef: "fixture.b", versionRange: ">=1.0.0" }],
});
const modules = [leaf, consumer, provider];

test("aggregate status observes modules with bounded concurrency and returns stable module order", async () => {
	const statusModules = ["h", "g", "f", "e", "d", "c", "b", "a"].map(
		(moduleRef) => moduleFixture({ moduleRef }),
	);
	let active = 0;
	let maxActive = 0;
	const catalog: ModuleCatalog = {
		async sources() {
			return [];
		},
		async loadDescriptor() {
			return {};
		},
		async loadAdapter(source: ModuleSource) {
			const moduleRef = source.packageName.replace("@tomflow/proflow-", "");
			return {
				behaviorAdapter: {
					status: async () => {
						active += 1;
						maxActive = Math.max(maxActive, active);
						await new Promise((resolve) => setTimeout(resolve, 20));
						active -= 1;
						return {
							result: success(moduleRef, {
								setupStatus: "READY",
								runtimeStatus: "STOPPED",
							}),
							observedEffects: [],
						};
					},
				},
			};
		},
	};
	const result = await observeStatuses(catalog, statusModules, workspaceRoot);
	assert.equal(maxActive, 6);
	assert.deepEqual(
		result.map((item) => item.moduleRef),
		["a", "b", "c", "d", "e", "f", "g", "h"],
	);
});

test("start gates on Module.status setup READY and never runs preflight", async () => {
	const { catalog, calls } = recordingCatalog({
		consumer: "ACTION_REQUIRED",
		provider: "BLOCKED",
	});
	const events: Array<{
		retention?: string;
		phase: string;
		moduleRef?: string;
	}> = [];
	const result = await startModulesThin(
		catalog,
		[consumer, provider],
		workspaceRoot,
		(event) => events.push(event),
	);
	assert.equal(result.completed, false);
	assert.deepEqual(result.blockedBy, {
		moduleRef: "provider",
		setupStatus: "BLOCKED",
		reason: "provider is not ready",
		nextCommand: "platform setup --module provider",
	});
	assert.deepEqual(result.blockers, [
		{
			moduleRef: "provider",
			setupStatus: "BLOCKED",
			reason: "provider is not ready",
			nextCommand: "platform setup --module provider",
		},
		{
			moduleRef: "consumer",
			setupStatus: "ACTION_REQUIRED",
			reason: "consumer is not ready",
			nextCommand: "platform setup --module consumer",
		},
	]);
	assert.deepEqual(
		calls.map((item) => item.call),
		["provider:status", "consumer:status"],
	);
	assert.equal(events.length, 4);
	assert.ok(events.every((event) => event.retention === "REPLACE"));
});

test("start and stop retries skip runtime states already reached", async () => {
	const { catalog, calls } = recordingCatalog();
	await startModulesThin(catalog, modules, workspaceRoot);
	calls.length = 0;
	const secondStart = await startModulesThin(catalog, modules, workspaceRoot);
	assert.equal(secondStart.completed, true);
	assert.equal(secondStart.skipped?.length, 3);
	assert.equal(
		calls.some((item) => item.call.endsWith(":start")),
		false,
	);
	await stopModulesThin(catalog, modules, workspaceRoot);
	calls.length = 0;
	const secondStop = await stopModulesThin(catalog, modules, workspaceRoot);
	assert.equal(secondStop.completed, true);
	assert.equal(secondStop.skipped?.length, 3);
	assert.equal(
		calls.some((item) => item.call.endsWith(":stop")),
		false,
	);
});

test("successful start and stop preserve dependency and reverse dependency order", async () => {
	const { catalog, calls } = recordingCatalog();
	assert.equal(
		(await startModulesThin(catalog, modules, workspaceRoot)).completed,
		true,
	);
	assert.equal(
		(await stopModulesThin(catalog, modules, workspaceRoot)).completed,
		true,
	);
	assert.deepEqual(
		calls.map((item) => item.call),
		[
			"provider:status",
			"consumer:status",
			"leaf:status",
			"provider:start",
			"consumer:start",
			"leaf:start",
			"leaf:status",
			"leaf:stop",
			"consumer:status",
			"consumer:stop",
			"provider:status",
			"provider:stop",
		],
	);
});

test("start performs zero starts when a Module reports FAILED setup status", async () => {
	const { catalog, calls } = recordingCatalog({ consumer: "FAILED" });
	const result = await startModulesThin(
		catalog,
		[consumer, provider],
		workspaceRoot,
	);
	assert.equal(result.completed, false);
	assert.deepEqual(result.blockedBy, {
		moduleRef: "consumer",
		setupStatus: "FAILED",
		reason: "consumer is not ready",
		nextCommand: "platform setup --module consumer",
	});
	assert.deepEqual(
		calls.map((item) => item.call),
		["provider:status", "consumer:status"],
	);
});

test("start fails fast during execution without starting later Modules", async () => {
	const { catalog, calls } = recordingCatalog({}, {}, { consumer: true });
	const result = await startModulesThin(catalog, modules, workspaceRoot);
	assert.equal(result.completed, false);
	assert.deepEqual(
		calls.map((item) => item.call),
		[
			"provider:status",
			"consumer:status",
			"leaf:status",
			"provider:start",
			"consumer:start",
		],
	);
});

test("stop runs in reverse dependency order and fails fast", async () => {
	const { catalog, calls } = recordingCatalog({}, {}, {}, { consumer: true });
	await startModulesThin(catalog, modules, workspaceRoot);
	calls.length = 0;
	const result = await stopModulesThin(catalog, modules, workspaceRoot);
	assert.equal(result.completed, false);
	assert.deepEqual(
		calls.map((item) => item.call),
		["leaf:status", "leaf:stop", "consumer:status", "consumer:stop"],
	);
});

test("stop reports a successful no-effect external runtime as skipped", async () => {
	const external = moduleFixture({ moduleRef: "external" });
	const calls: string[] = [];
	const catalog: ModuleCatalog = {
		async sources() {
			return [];
		},
		async loadDescriptor() {
			return {};
		},
		async loadAdapter() {
			return {
				behaviorAdapter: {
					status: async () => ({
						result: success("external", {
							setupStatus: "READY",
							runtimeStatus: "RUNNING",
						}),
						observedEffects: [],
					}),
					stop: async () => {
						calls.push("stop");
						return { result: success("external"), observedEffects: [] };
					},
				},
			};
		},
	};
	const result = await stopModulesThin(catalog, [external], workspaceRoot);
	assert.equal(result.completed, true);
	assert.deepEqual(result.skipped, [
		{ moduleRef: "external", reason: "NO_EFFECT" },
	]);
	assert.deepEqual(calls, ["stop"]);
});

test("uninstall runs in reverse dependency order and fails fast", async () => {
	const { catalog, calls } = recordingCatalog(
		{},
		{},
		{},
		{},
		{ consumer: true },
	);
	const result = await uninstallModulesThin(catalog, modules, workspaceRoot);
	assert.equal(result.completed, false);
	assert.deepEqual(
		calls.map((item) => item.call),
		["leaf:uninstall", "consumer:uninstall"],
	);
});

test("setup skips READY modules and invokes only ACTION_REQUIRED module", async () => {
	const { catalog, calls } = recordingCatalog({ consumer: "ACTION_REQUIRED" });
	const result = await setupModulesThin(catalog, modules, workspaceRoot);
	assert.equal(result.completed, false);
	assert.deepEqual(
		calls.map((item) => item.call),
		["provider:status", "consumer:status", "consumer:setup", "consumer:status"],
	);
	assert.deepEqual(result.skipped, [
		{ moduleRef: "provider", reason: "READY" },
	]);
});

test("setup re-enters an owner when setup is READY but runtime has FAILED", async () => {
	const { catalog, calls } = recordingCatalog(
		{},
		{},
		{},
		{},
		{},
		{},
		{ provider: "FAILED" },
	);
	await setupModulesThin(catalog, [provider], workspaceRoot);
	assert.deepEqual(
		calls.map((item) => item.call),
		["provider:status", "provider:setup", "provider:status"],
	);
});

test("setup asks the Platform interaction shell only before a module that needs setup", async () => {
	const { catalog } = recordingCatalog({ consumer: "ACTION_REQUIRED" });
	const prompted: string[] = [];
	await setupModulesThin(
		catalog,
		modules,
		workspaceRoot,
		undefined,
		undefined,
		async (moduleRef) => {
			prompted.push(moduleRef);
		},
	);
	assert.deepEqual(prompted, ["consumer"]);
});

test("RF-DEP-CLI-REAL2-01 full setup gates at the first owner that still needs human action", async () => {
	const { catalog, calls } = recordingCatalog(
		{ consumer: "ACTION_REQUIRED", leaf: "ACTION_REQUIRED" },
		{ consumer: "ACTION_REQUIRED", leaf: "ACTION_REQUIRED" },
	);
	const result = await setupModulesThin(catalog, modules, workspaceRoot);
	assert.equal(result.completed, false);
	assert.deepEqual(
		calls.map((item) => item.call),
		["provider:status", "consumer:status", "consumer:setup", "consumer:status"],
	);
	assert.deepEqual(
		result.results.map((item) => [item.moduleRef, item.result.status]),
		[["consumer", "ACTION_REQUIRED"]],
	);
	assert.deepEqual(result.blockers, [
		{
			moduleRef: "consumer",
			setupStatus: "ACTION_REQUIRED",
			reason: "consumer is not ready",
			nextCommand: "platform setup --module consumer",
		},
	]);
});

test("full setup presents Browser, Tunnel, then Provider as the user-visible frontier", async () => {
	const browser = moduleFixture({ moduleRef: "execution-browser-extension" });
	const tunnel = moduleFixture({ moduleRef: "dev-tunnel" });
	const modelProvider = moduleFixture({ moduleRef: "model-provider-api" });
	const { catalog, calls } = recordingCatalog(
		{
			"execution-browser-extension": "ACTION_REQUIRED",
			"dev-tunnel": "ACTION_REQUIRED",
			"model-provider-api": "ACTION_REQUIRED",
		},
		{ "execution-browser-extension": "ACTION_REQUIRED" },
	);
	const result = await setupModulesThin(
		catalog,
		[tunnel, modelProvider, browser],
		workspaceRoot,
	);
	assert.equal(result.completed, false);
	assert.deepEqual(
		calls.map((item) => item.call),
		[
			"execution-browser-extension:status",
			"execution-browser-extension:setup",
			"execution-browser-extension:status",
		],
	);
});

test("RF-DEP-CLI-REAL2-02 setup re-reads owner status instead of guessing readiness from SUCCEEDED", async () => {
	const { catalog, calls } = recordingCatalog({ consumer: "BLOCKED" });
	const result = await setupModulesThin(catalog, modules, workspaceRoot);
	assert.equal(result.completed, false);
	assert.deepEqual(result.blockers, [
		{
			moduleRef: "consumer",
			setupStatus: "BLOCKED",
			reason: "consumer is not ready",
			nextCommand: "platform setup --module consumer",
		},
	]);
	assert.deepEqual(
		result.results.map((item) => [item.moduleRef, item.result.status]),
		[["consumer", "SUCCEEDED"]],
	);
	assert.deepEqual(
		calls.map((item) => item.call),
		["provider:status", "consumer:status", "consumer:setup", "consumer:status"],
	);
});

test("targeted setup forwards opaque input without Platform interpretation", async () => {
	const { catalog, calls } = recordingCatalog({ consumer: "ACTION_REQUIRED" });
	const input = { externalToken: "opaque-value" };
	const result = await setupModulesThin(catalog, modules, workspaceRoot, {
		moduleRef: "consumer",
		input,
	});
	assert.equal(result.completed, false);
	assert.deepEqual(calls, [
		{ call: "consumer:status" },
		{ call: "consumer:setup", input },
		{ call: "consumer:status" },
	]);
});

test("targeted setup reconciles a READY module even without explicit input", async () => {
	const { catalog, calls } = recordingCatalog({});
	const result = await setupModulesThin(catalog, modules, workspaceRoot, {
		moduleRef: "provider",
	});
	assert.equal(result.completed, true);
	assert.deepEqual(calls, [
		{ call: "provider:status" },
		{ call: "provider:setup" },
		{ call: "provider:status" },
	]);
	assert.deepEqual(result.skipped, []);
});

test("setup never starts a later machine failure after the first human action", async () => {
	const { catalog, calls } = recordingCatalog(
		{ consumer: "ACTION_REQUIRED", leaf: "FAILED" },
		{ consumer: "ACTION_REQUIRED", leaf: "FAILED" },
	);
	const result = await setupModulesThin(catalog, modules, workspaceRoot);
	assert.equal(result.completed, false);
	assert.deepEqual(
		result.results.map((item) => [item.moduleRef, item.result.status]),
		[["consumer", "ACTION_REQUIRED"]],
	);
	assert.equal(
		calls.some((item) => item.call === "consumer:setup"),
		true,
	);
	assert.equal(
		calls.some((item) => item.call === "leaf:setup"),
		false,
	);
});

test("CP-DEP-CLI-REAL2-01 CP-DEP-CLI-REAL2-02 CP-DEP-CLI-REAL2-05 same-run provider readiness unlocks dependent setup", async () => {
	const { catalog, calls } = recordingCatalog(
		{ provider: "ACTION_REQUIRED", consumer: "ACTION_REQUIRED" },
		{},
		{},
		{},
		{},
		{ provider: "READY", consumer: "READY" },
	);
	const result = await setupModulesThin(catalog, modules, workspaceRoot);
	assert.equal(result.completed, true);
	assert.deepEqual(
		calls.map((item) => item.call),
		[
			"provider:status",
			"provider:setup",
			"provider:status",
			"consumer:status",
			"consumer:setup",
			"consumer:status",
			"leaf:status",
		],
	);
});

test("CP-DEP-CLI-REAL2-03 owners determine the first actionable setup frontier", async () => {
	const independent = moduleFixture({ moduleRef: "independent" });
	const { catalog, calls } = recordingCatalog({
		provider: "ACTION_REQUIRED",
		consumer: "ACTION_REQUIRED",
		independent: "ACTION_REQUIRED",
	});
	const result = await setupModulesThin(
		catalog,
		[consumer, provider, independent],
		workspaceRoot,
	);
	assert.equal(result.completed, false);
	assert.equal(result.blockers?.[0]?.setupStatus, "ACTION_REQUIRED");
	assert.equal(
		calls.some((item) => item.call === "consumer:setup"),
		false,
	);
	assert.equal(
		calls.some((item) => item.call === "independent:setup"),
		true,
	);
});

test("CP-DEP-CLI-REAL2-04 RF-DEP-CLI-REAL2-03 setup priority is presentation-only and stores no module-specific resume state", async () => {
	const source = await import("node:fs/promises").then(({ readFile }) =>
		readFile(new URL("../src/lifecycle/thin.ts", import.meta.url), "utf8"),
	);
	assert.match(source, /execution-browser-extension/);
	assert.doesNotMatch(
		source,
		/custom-gpt|agent-product|agent-controller-dev|agent-test-ops/,
	);
	assert.doesNotMatch(source, /resumeState|setupCheckpoint|persist.*setup/i);
});

test("deployment setup temporarily starts service dependencies before agent-package provisioning and restores them", async () => {
	const runtime = moduleFixture({
		moduleRef: "runtime-service",
		provides: [{ contractRef: "fixture.runtime", version: "1.0.0" }],
	});
	const gateway = moduleFixture({
		moduleRef: "gateway-service",
		provides: [{ contractRef: "fixture.gateway", version: "1.0.0" }],
		requires: [{ contractRef: "fixture.runtime", versionRange: ">=1.0.0" }],
	});
	const agent = moduleFixture({
		moduleRef: "role-agent",
		kind: "agent-package",
		requires: [{ contractRef: "fixture.gateway", versionRange: ">=1.0.0" }],
	});
	const { catalog, calls } = recordingCatalog(
		{ "role-agent": "ACTION_REQUIRED" },
		{},
		{},
		{},
		{},
		{ "role-agent": "READY" },
	);
	const result = await setupModulesThin(
		catalog,
		[agent, gateway, runtime],
		workspaceRoot,
	);
	assert.equal(result.completed, true);
	const names = calls.map((item) => item.call);
	assert.ok(
		names.indexOf("runtime-service:start") <
			names.indexOf("gateway-service:start"),
	);
	assert.ok(
		names.indexOf("gateway-service:start") < names.indexOf("role-agent:setup"),
	);
	assert.ok(
		names.indexOf("role-agent:setup") < names.indexOf("gateway-service:stop"),
	);
	assert.ok(
		names.indexOf("gateway-service:stop") <
			names.indexOf("runtime-service:stop"),
	);
});

test("deployment setup cleans temporary service dependencies when agent-package provisioning fails", async () => {
	const runtime = moduleFixture({
		moduleRef: "runtime-service",
		provides: [{ contractRef: "fixture.runtime", version: "1.0.0" }],
	});
	const agent = moduleFixture({
		moduleRef: "role-agent",
		kind: "agent-package",
		requires: [{ contractRef: "fixture.runtime", versionRange: ">=1.0.0" }],
	});
	const { catalog, calls } = recordingCatalog(
		{ "role-agent": "ACTION_REQUIRED" },
		{ "role-agent": "FAILED" },
	);
	const result = await setupModulesThin(
		catalog,
		[agent, runtime],
		workspaceRoot,
	);
	assert.equal(result.completed, false);
	assert.ok(calls.some((item) => item.call === "runtime-service:start"));
	assert.ok(calls.some((item) => item.call === "runtime-service:stop"));
});

test("deployment setup never stops service dependencies that were already running", async () => {
	const runtime = moduleFixture({
		moduleRef: "runtime-service",
		provides: [{ contractRef: "fixture.runtime", version: "1.0.0" }],
	});
	const agent = moduleFixture({
		moduleRef: "role-agent",
		kind: "agent-package",
		requires: [{ contractRef: "fixture.runtime", versionRange: ">=1.0.0" }],
	});
	const { catalog, calls } = recordingCatalog(
		{ "role-agent": "ACTION_REQUIRED" },
		{},
		{},
		{},
		{},
		{ "role-agent": "READY" },
	);
	assert.equal(
		(await startModulesThin(catalog, [runtime], workspaceRoot)).completed,
		true,
	);
	calls.splice(0);
	const result = await setupModulesThin(
		catalog,
		[agent, runtime],
		workspaceRoot,
	);
	assert.equal(result.completed, true);
	assert.equal(
		calls.some((item) => item.call === "runtime-service:start"),
		false,
	);
	assert.equal(
		calls.some((item) => item.call === "runtime-service:stop"),
		false,
	);
});
