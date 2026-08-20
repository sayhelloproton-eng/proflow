import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModuleOperationResult } from "@tomflow/proflow-module-contract";
import type { ResolvedModule } from "../src/contracts.ts";
import {
	setupModulesThin,
	startModulesThin,
	stopModulesThin,
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
		Record<string, "READY" | "ACTION_REQUIRED" | "FAILED">
	> = {},
	setupResultByRef: Readonly<Record<string, "ACTION_REQUIRED" | "FAILED">> = {},
) {
	const calls: Array<{ call: string; input?: unknown }> = [];
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
				const data =
					command === "status"
						? {
								setupStatus: setupByRef[moduleRef] ?? "READY",
								runtimeStatus: "STOPPED" as const,
							}
						: undefined;
				return { result: success(moduleRef, data), observedEffects: [] };
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
	const { catalog, calls } = recordingCatalog({ consumer: "ACTION_REQUIRED" });
	const result = await startModulesThin(catalog, modules, workspaceRoot);
	assert.equal(result.completed, false);
	assert.deepEqual(result.blockedBy, {
		moduleRef: "consumer",
		setupStatus: "ACTION_REQUIRED",
	});
	assert.deepEqual(
		calls.map((item) => item.call),
		["provider:status", "provider:start", "consumer:status"],
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
			"provider:start",
			"consumer:status",
			"consumer:start",
			"leaf:status",
			"leaf:start",
			"leaf:stop",
			"consumer:stop",
			"provider:stop",
		],
	);
});

test("setup skips READY modules and invokes only ACTION_REQUIRED module", async () => {
	const { catalog, calls } = recordingCatalog({ consumer: "ACTION_REQUIRED" });
	const result = await setupModulesThin(catalog, modules, workspaceRoot);
	assert.equal(result.completed, true);
	assert.deepEqual(
		calls.map((item) => item.call),
		["provider:status", "consumer:status", "consumer:setup", "leaf:status"],
	);
});

test("setup aggregates every non-ready Module instead of stopping at the first action", async () => {
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
			"leaf:status",
			"leaf:setup",
		],
	);
	assert.deepEqual(
		result.results.map((item) => [item.moduleRef, item.result.status]),
		[
			["consumer", "ACTION_REQUIRED"],
			["leaf", "ACTION_REQUIRED"],
		],
	);
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
		{ call: "consumer:status" },
		{ call: "consumer:setup", input },
	]);
});

test("setup aggregates ACTION_REQUIRED and machine FAILED Modules in the same full run", async () => {
	const { catalog, calls } = recordingCatalog(
		{ consumer: "ACTION_REQUIRED", leaf: "FAILED" },
		{ consumer: "ACTION_REQUIRED", leaf: "FAILED" },
	);
	const result = await setupModulesThin(catalog, modules, workspaceRoot);
	assert.equal(result.completed, false);
	assert.deepEqual(
		result.results.map((item) => [item.moduleRef, item.result.status]),
		[
			["consumer", "ACTION_REQUIRED"],
			["leaf", "FAILED"],
		],
	);
	assert.deepEqual(
		calls.map((item) => item.call),
		[
			"provider:status",
			"consumer:status",
			"consumer:setup",
			"leaf:status",
			"leaf:setup",
		],
	);
});
