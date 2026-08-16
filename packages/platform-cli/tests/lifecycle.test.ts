import assert from "node:assert/strict";
import { test } from "node:test";

import type {
	LifecyclePrimitive,
	ModuleDescriptor,
	ModuleOperationResult,
} from "@tomflow/proflow-module-contract";

import type { ResolvedModule } from "../src/contracts.ts";
import { PlatformError } from "../src/errors.ts";
import {
	dispatchLifecycle,
	startModules,
	statusModules,
	stopModules,
} from "../src/lifecycle/index.ts";
import type { ModuleCatalog, ModuleSource } from "../src/modules.ts";

const SERVICE_LIFECYCLE: LifecyclePrimitive[] = [
	"describe",
	"preflight",
	"status",
	"verify",
	"doctor",
	"start",
	"stop",
];

const LIBRARY_LIFECYCLE: LifecyclePrimitive[] = [
	"describe",
	"preflight",
	"verify",
	"doctor",
];

const REMOTE_LIFECYCLE: LifecyclePrimitive[] = [
	"describe",
	"preflight",
	"status",
	"verify",
	"doctor",
];

interface FixtureInput {
	moduleRef: string;
	kind: ModuleDescriptor["kind"];
	lifecycle?: LifecyclePrimitive[];
	provides?: ModuleDescriptor["provides"];
	requires?: ModuleDescriptor["requires"];
}

function moduleFixture(input: FixtureInput): ResolvedModule {
	return {
		moduleRef: input.moduleRef,
		packageName: `@tomflow/proflow-${input.moduleRef}`,
		moduleVersion: "1.0.0",
		kind: input.kind,
		provides: input.provides ?? [],
		requires: input.requires ?? [],
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

function ok(moduleRef: string): ModuleOperationResult {
	return {
		contract: "deployment.result.v1",
		ok: true,
		status: "SUCCEEDED",
		moduleRef,
		moduleVersion: "1.0.0",
	};
}

function actionRequired(
	moduleRef: string,
	action = "complete-action",
	description = "a human action is required",
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

function lifecycleUnsupported(error: unknown): boolean {
	return (
		error instanceof PlatformError && error.code === "LIFECYCLE_UNSUPPORTED"
	);
}

function commandFailed(error: unknown): boolean {
	return error instanceof PlatformError && error.code === "COMMAND_FAILED";
}

test("dispatchLifecycle invokes a declared primitive and returns its validated result", async () => {
	const service = moduleFixture({
		moduleRef: "svc",
		kind: "service",
		lifecycle: ["describe", "status", "start", "stop"],
	});
	const { calls, catalog } = makeCatalog([
		{ module: service, primitives: { start: () => ok("svc") } },
	]);

	const result = await dispatchLifecycle(catalog, service, "start");

	assert.equal(result.primitive, "start");
	assert.equal(result.result.status, "SUCCEEDED");
	assert.equal(result.result.ok, true);
	assert.deepEqual(calls, [{ moduleRef: "svc", primitive: "start" }]);
});

test("CP-DPL-CLI-04 dispatchLifecycle rejects an undeclared primitive with LIFECYCLE_UNSUPPORTED and never invokes the adapter", async () => {
	const library = moduleFixture({
		moduleRef: "lib",
		kind: "library",
		lifecycle: LIBRARY_LIFECYCLE,
	});
	const { calls, catalog } = makeCatalog([
		// the adapter falsely offers a start primitive; the descriptor is truth
		{ module: library, primitives: { start: () => ok("lib") } },
	]);

	await assert.rejects(
		() => dispatchLifecycle(catalog, library, "start"),
		lifecycleUnsupported,
	);
	assert.equal(calls.length, 0);
});

test("dispatchLifecycle runtime-validates the adapter result and rejects malformed results", async () => {
	const service = moduleFixture({
		moduleRef: "svc",
		kind: "service",
		lifecycle: ["status"],
	});
	const { catalog } = makeCatalog([
		{
			module: service,
			primitives: {
				status: () => ({
					contract: "deployment.result.v1",
					ok: "not-a-boolean",
				}),
			},
		},
	]);

	await assert.rejects(
		() => dispatchLifecycle(catalog, service, "status"),
		commandFailed,
	);
});

test("dispatchLifecycle never upgrades a non-success result to success", async () => {
	const tunnel = moduleFixture({
		moduleRef: "tunnel",
		kind: "external-resource",
		lifecycle: ["describe", "status", "start", "stop"],
	});
	const { catalog } = makeCatalog([
		{
			module: tunnel,
			primitives: {
				start: () =>
					actionRequired(
						"tunnel",
						"configure-tunnel",
						"No dev-tunnel resource is bound",
					),
			},
		},
	]);

	const result = await dispatchLifecycle(catalog, tunnel, "start");

	assert.equal(result.result.status, "ACTION_REQUIRED");
	assert.equal(result.result.ok, false);
});

test("startModules dispatches only modules that declare start and never forges library/remote start", async () => {
	const service = moduleFixture({
		moduleRef: "svc",
		kind: "service",
		lifecycle: SERVICE_LIFECYCLE,
	});
	const library = moduleFixture({
		moduleRef: "lib",
		kind: "library",
		lifecycle: LIBRARY_LIFECYCLE,
	});
	const remote = moduleFixture({
		moduleRef: "remote",
		kind: "external-resource",
		lifecycle: REMOTE_LIFECYCLE,
	});
	const { calls, catalog } = makeCatalog([
		{ module: service, primitives: { start: () => ok("svc") } },
		// library adapter falsely offers start; descriptor must suppress it
		{ module: library, primitives: { start: () => ok("lib") } },
		{ module: remote, primitives: {} },
	]);

	const results = await startModules(catalog, [service, library, remote]);

	assert.deepEqual(calls, [{ moduleRef: "svc", primitive: "start" }]);
	const byRef = new Map(results.map((result) => [result.moduleRef, result]));
	assert.equal(byRef.get("svc")?.status, "EXECUTED");
	assert.equal(byRef.get("svc")?.result?.ok, true);
	assert.equal(byRef.get("lib")?.status, "SKIP_UNSUPPORTED");
	assert.equal(byRef.get("lib")?.result, undefined);
	assert.equal(byRef.get("remote")?.status, "SKIP_UNSUPPORTED");
	assert.equal(byRef.get("remote")?.result, undefined);
});

test("startModules follows forward dependency topological order", async () => {
	const provider = moduleFixture({
		moduleRef: "provider",
		kind: "service",
		lifecycle: ["status", "start", "stop"],
		provides: [{ contractRef: "cap", version: "1.0.0" }],
	});
	const consumer = moduleFixture({
		moduleRef: "consumer",
		kind: "service",
		lifecycle: ["status", "start", "stop"],
		requires: [{ contractRef: "cap", versionRange: ">=1.0.0 <2.0.0" }],
	});
	const { calls, catalog } = makeCatalog([
		{ module: provider, primitives: { start: () => ok("provider") } },
		{ module: consumer, primitives: { start: () => ok("consumer") } },
	]);

	// input order is deliberately reversed to prove topological ordering wins
	const results = await startModules(catalog, [consumer, provider]);

	assert.deepEqual(
		results
			.filter((result) => result.status === "EXECUTED")
			.map((r) => r.moduleRef),
		["provider", "consumer"],
	);
	assert.deepEqual(
		calls.map((call) => call.moduleRef),
		["provider", "consumer"],
	);
});

test("stopModules follows reverse dependency topological order", async () => {
	const provider = moduleFixture({
		moduleRef: "provider",
		kind: "service",
		lifecycle: ["status", "start", "stop"],
		provides: [{ contractRef: "cap", version: "1.0.0" }],
	});
	const consumer = moduleFixture({
		moduleRef: "consumer",
		kind: "service",
		lifecycle: ["status", "start", "stop"],
		requires: [{ contractRef: "cap", versionRange: ">=1.0.0 <2.0.0" }],
	});
	const { calls, catalog } = makeCatalog([
		{ module: provider, primitives: { stop: () => ok("provider") } },
		{ module: consumer, primitives: { stop: () => ok("consumer") } },
	]);

	const results = await stopModules(catalog, [consumer, provider]);

	assert.deepEqual(
		results
			.filter((result) => result.status === "EXECUTED")
			.map((r) => r.moduleRef),
		["consumer", "provider"],
	);
	assert.deepEqual(
		calls.map((call) => call.moduleRef),
		["consumer", "provider"],
	);
});

test("statusModules dispatches real-time status and preserves non-success", async () => {
	const tunnel = moduleFixture({
		moduleRef: "tunnel",
		kind: "external-resource",
		lifecycle: ["describe", "status"],
	});
	const service = moduleFixture({
		moduleRef: "svc",
		kind: "service",
		lifecycle: ["status"],
	});
	const { calls, catalog } = makeCatalog([
		{
			module: tunnel,
			primitives: {
				status: () =>
					actionRequired(
						"tunnel",
						"configure-tunnel",
						"No dev-tunnel resource is bound",
					),
			},
		},
		{ module: service, primitives: { status: () => ok("svc") } },
	]);

	const results = await statusModules(catalog, [tunnel, service]);

	assert.deepEqual(
		calls.map((call) => call.primitive),
		["status", "status"],
	);
	const tunnelResult = results.find((result) => result.moduleRef === "tunnel");
	assert.equal(tunnelResult?.status, "EXECUTED");
	assert.equal(tunnelResult?.result?.status, "ACTION_REQUIRED");
	assert.equal(tunnelResult?.result?.ok, false);
	const svcResult = results.find((result) => result.moduleRef === "svc");
	assert.equal(svcResult?.status, "EXECUTED");
	assert.equal(svcResult?.result?.status, "SUCCEEDED");
});

test("statusModules skips modules that do not declare status", async () => {
	const library = moduleFixture({
		moduleRef: "lib",
		kind: "library",
		lifecycle: LIBRARY_LIFECYCLE,
	});
	const { calls, catalog } = makeCatalog([
		{ module: library, primitives: { status: () => ok("lib") } },
	]);

	const results = await statusModules(catalog, [library]);

	assert.deepEqual(results, [
		{
			moduleRef: "lib",
			primitive: "status",
			status: "SKIP_UNSUPPORTED",
			result: undefined,
			observedEffects: [],
		},
	]);
	assert.equal(calls.length, 0);
});
