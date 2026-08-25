import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModuleOperationResult } from "@tomflow/proflow-module-contract";
import type { ResolvedModule } from "../src/contracts.ts";
import {
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
	provides?: ResolvedModule["provides"];
	requires?: ResolvedModule["requires"];
}): ResolvedModule {
	return {
		moduleRef: input.moduleRef,
		packageName: `@tomflow/proflow-${input.moduleRef}`,
		moduleVersion: "1.0.0",
		kind: "service",
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
				const data =
					command === "status"
						? {
								setupStatus,
								runtimeStatus: runtimeByRef.get(moduleRef) ?? "STOPPED",
								...(setupStatus === "READY"
									? {}
									: {
											issues: [
												{
													scope: "SETUP" as const,
													code: "NOT_READY",
													message: `${moduleRef} is not ready`,
													relatedModuleRefs: [],
													nextCommand: `platform setup --module ${moduleRef}`,
												},
											],
										}),
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
	assert.equal(result.completed, true);
	assert.deepEqual(
		calls.map((item) => item.call),
		[
			"provider:status",
			"consumer:status",
			"consumer:setup",
			"consumer:status",
			"leaf:status",
		],
	);
	assert.deepEqual(result.skipped, [
		{ moduleRef: "provider", reason: "READY" },
		{ moduleRef: "leaf", reason: "READY" },
	]);
});

test("setup aggregates non-ready Modules while downstream setup waits for current provider truth", async () => {
	const { catalog, calls } = recordingCatalog(
		{ consumer: "ACTION_REQUIRED", leaf: "ACTION_REQUIRED" },
		{ consumer: "ACTION_REQUIRED", leaf: "ACTION_REQUIRED" },
	);
	const result = await setupModulesThin(catalog, modules, workspaceRoot);
	assert.equal(result.completed, false);
	assert.deepEqual(
		calls.map((item) => item.call),
		[
			"provider:status",
			"consumer:status",
			"consumer:setup",
			"consumer:status",
			"leaf:status",
		],
	);
	assert.deepEqual(
		result.results.map((item) => [item.moduleRef, item.result.status]),
		[["consumer", "ACTION_REQUIRED"]],
	);
	assert.equal(result.blockers?.[0]?.moduleRef, "leaf");
});

test("targeted setup forwards opaque input without Platform interpretation", async () => {
	const { catalog, calls } = recordingCatalog({ consumer: "ACTION_REQUIRED" });
	const input = { externalToken: "opaque-value" };
	const result = await setupModulesThin(catalog, modules, workspaceRoot, {
		moduleRef: "consumer",
		input,
	});
	assert.equal(result.completed, true);
	assert.deepEqual(calls, [
		{ call: "provider:status" },
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

test("setup aggregates ACTION_REQUIRED and machine FAILED Modules in the same full run", async () => {
	const independent = moduleFixture({ moduleRef: "independent" });
	const { catalog, calls } = recordingCatalog(
		{ consumer: "ACTION_REQUIRED", independent: "FAILED" },
		{ consumer: "ACTION_REQUIRED", independent: "FAILED" },
	);
	const result = await setupModulesThin(
		catalog,
		[consumer, provider, independent],
		workspaceRoot,
	);
	assert.equal(result.completed, false);
	assert.deepEqual(
		result.results
			.map((item) => [item.moduleRef, item.result.status])
			.sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
		[
			["consumer", "ACTION_REQUIRED"],
			["independent", "FAILED"],
		],
	);
	assert.equal(
		calls.some((item) => item.call === "consumer:setup"),
		true,
	);
	assert.equal(
		calls.some((item) => item.call === "independent:setup"),
		true,
	);
});

test("CP-DEP-CLI-REAL2-01 CP-DEP-CLI-REAL2-02 same-run provider readiness unlocks dependent setup", async () => {
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

test("CP-DEP-CLI-REAL2-03 CP-DEP-CLI-REAL2-05 RF-DEP-CLI-REAL2-01 RF-DEP-CLI-REAL2-02 blocked dependencies never run setup while independent modules continue", async () => {
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
	assert.deepEqual(result.blockers, [
		{
			moduleRef: "consumer",
			setupStatus: "BLOCKED",
			reason: "等待依赖模块就绪：provider",
			nextCommand: "platform setup --module provider",
		},
	]);
	assert.equal(
		calls.some((item) => item.call === "consumer:setup"),
		false,
	);
	assert.equal(
		calls.some((item) => item.call === "independent:setup"),
		true,
	);
});

test("CP-DEP-CLI-REAL2-04 RF-DEP-CLI-REAL2-03 dependency setup gate is generic and stores no module-specific resume state", async () => {
	const source = await import("node:fs/promises").then(({ readFile }) =>
		readFile(new URL("../src/lifecycle/thin.ts", import.meta.url), "utf8"),
	);
	assert.doesNotMatch(
		source,
		/execution-browser-extension|custom-gpt|agent-product|agent-controller-dev|agent-test-ops/,
	);
	assert.doesNotMatch(source, /resumeState|setupCheckpoint|persist.*setup/i);
});
