import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModuleOperationResult } from "@tomflow/proflow-module-contract";

import type { ResolvedModule } from "../src/contracts.ts";
import {
	preflightAndStartModules,
	stopModulesThin,
} from "../src/lifecycle/index.ts";
import type { ModuleCatalog, ModuleSource } from "../src/modules.ts";

type Primitive = "preflight" | "start" | "stop";
type ResultStatus = ModuleOperationResult["status"];

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
		documentation: [],
		provides: input.provides ?? [],
		requires: input.requires ?? [],
		requirements: [],
		configSlots: [],
		lifecycle: ["preflight", "start", "stop"],
		verification: { checks: [] },
		effects: [],
		source: { type: "workspace", path: `/fixture/${input.moduleRef}` },
	};
}

function operationResult(
	moduleRef: string,
	status: ResultStatus,
): ModuleOperationResult {
	if (status === "ACTION_REQUIRED") {
		return {
			contract: "deployment.result.v1",
			ok: false,
			status,
			moduleRef,
			moduleVersion: "1.0.0",
			actionRequired: {
				action: "fixture-action",
				description: "fixture action required",
			},
		};
	}
	if (status === "FAILED") {
		return {
			contract: "deployment.result.v1",
			ok: false,
			status,
			moduleRef,
			moduleVersion: "1.0.0",
			error: {
				code: "COMMAND_FAILED",
				message: `${moduleRef} failed`,
				retryable: false,
			},
		};
	}
	return {
		contract: "deployment.result.v1",
		ok: status === "SUCCEEDED",
		status,
		moduleRef,
		moduleVersion: "1.0.0",
	};
}

function recordingCatalog(statuses: Readonly<Record<string, ResultStatus>>) {
	const calls: string[] = [];
	const catalog: ModuleCatalog = {
		async sources() {
			return [];
		},
		async loadDescriptor() {
			return {};
		},
		async loadAdapter(source: ModuleSource) {
			const moduleRef = source.packageName.replace("@tomflow/proflow-", "");
			const operation = (primitive: Primitive) => async () => {
				calls.push(`${moduleRef}:${primitive}`);
				return {
					result: operationResult(
						moduleRef,
						statuses[`${moduleRef}:${primitive}`] ?? "SUCCEEDED",
					),
					observedEffects: [],
				};
			};
			return {
				behaviorAdapter: {
					preflight: operation("preflight"),
					start: operation("start"),
					stop: operation("stop"),
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

test("start completes every preflight before any start and leaves zero starts on preflight failure", async () => {
	const { catalog, calls } = recordingCatalog({
		"consumer:preflight": "ACTION_REQUIRED",
	});
	const outcome = await preflightAndStartModules(catalog, modules);
	assert.equal(outcome.phase, "preflight");
	assert.equal(outcome.completed, false);
	assert.deepEqual(calls, ["provider:preflight", "consumer:preflight"]);
	assert.equal(
		calls.some((call) => call.endsWith(":start")),
		false,
	);
});

test("start is dependency ordered and fail-fast without rollback or later starts", async () => {
	const { catalog, calls } = recordingCatalog({
		"consumer:start": "FAILED",
	});
	const outcome = await preflightAndStartModules(catalog, modules);
	assert.equal(outcome.phase, "start");
	assert.equal(outcome.completed, false);
	assert.deepEqual(calls, [
		"provider:preflight",
		"consumer:preflight",
		"leaf:preflight",
		"provider:start",
		"consumer:start",
	]);
	assert.equal(calls.includes("leaf:start"), false);
	assert.equal(
		calls.some((call) => call.endsWith(":stop")),
		false,
	);
});

test("stop is reverse dependency ordered and fail-fast", async () => {
	const { catalog, calls } = recordingCatalog({
		"consumer:stop": "FAILED",
	});
	const outcome = await stopModulesThin(catalog, modules);
	assert.equal(outcome.phase, "stop");
	assert.equal(outcome.completed, false);
	assert.deepEqual(calls, ["leaf:stop", "consumer:stop"]);
	assert.equal(calls.includes("provider:stop"), false);
});

test("successful start and stop preserve dependency order", async () => {
	const { catalog, calls } = recordingCatalog({});
	const started = await preflightAndStartModules(catalog, modules);
	assert.equal(started.completed, true);
	const stopped = await stopModulesThin(catalog, modules);
	assert.equal(stopped.completed, true);
	assert.deepEqual(calls, [
		"provider:preflight",
		"consumer:preflight",
		"leaf:preflight",
		"provider:start",
		"consumer:start",
		"leaf:start",
		"leaf:stop",
		"consumer:stop",
		"provider:stop",
	]);
});
