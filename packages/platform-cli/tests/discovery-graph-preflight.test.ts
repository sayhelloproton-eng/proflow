import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	type ConfigSlot,
	type ModuleDescriptor,
	type ModuleProvide,
	type ModuleRequire,
	type ModuleRequirement,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";

import type { ResolvedModule } from "../src/contracts.ts";
import { discoverModules, resolveModules } from "../src/discovery/index.ts";
import { PlatformError, type PlatformErrorCode } from "../src/errors.ts";
import {
	buildDependencyGraph,
	ModuleRefUnresolvedError,
} from "../src/graph/index.ts";
import {
	type ModuleCatalog,
	type ModuleSource,
	versionSatisfies,
} from "../src/modules.ts";
import {
	checkConfigReadiness,
	probeAllRequirements,
	resolveModuleConfig,
	runPreflight,
} from "../src/preflight/index.ts";

function descriptor(
	overrides: Partial<ModuleDescriptor> = {},
): ModuleDescriptor {
	return parseModuleDescriptor({
		contract: "module",
		contractVersion: "1.0.0",
		moduleRef: "fixture-module",
		packageName: "@tomflow/proflow-fixture-module",
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

interface FixtureInput {
	moduleRef: string;
	packageName?: string;
	provides?: ModuleProvide[];
	requires?: ModuleRequire[];
	requirements?: ModuleRequirement[];
	configSlots?: ConfigSlot[];
}

function moduleFixture(input: FixtureInput): ResolvedModule {
	return {
		moduleRef: input.moduleRef,
		packageName: input.packageName ?? `@tomflow/proflow-${input.moduleRef}`,
		moduleVersion: "1.0.0",
		kind: "service",
		provides: input.provides ?? [],
		requires: input.requires ?? [],
		requirements: input.requirements ?? [],
		configSlots: input.configSlots ?? [],
		lifecycle: ["describe", "preflight", "verify", "doctor"],
		verification: {
			checks: [
				{ id: "health", description: "Observed health", lifecycle: "verify" },
			],
		},
		effects: [],
		source: { type: "workspace", path: "/fixture" },
	};
}

function arrayCatalog(descriptors: unknown[]): ModuleCatalog {
	let index = 0;
	return {
		async sources() {
			return [];
		},
		async loadDescriptor() {
			const value = descriptors[index] ?? descriptors[descriptors.length - 1];
			index += 1;
			return value;
		},
		async loadAdapter() {
			return {};
		},
	};
}

function workspaceSource(
	packageName: string,
	path = "/nonexistent",
): ModuleSource {
	return { type: "workspace", packageName, path };
}

function errorCode(code: PlatformErrorCode): (error: unknown) => boolean {
	return (error: unknown): boolean =>
		error instanceof PlatformError && error.code === code;
}

test("versionSatisfies covers exact and comparator ranges", () => {
	assert.equal(versionSatisfies("1.2.3", "1.2.3"), true);
	assert.equal(versionSatisfies("1.2.3", "1.2.4"), false);
	assert.equal(versionSatisfies("1.2.3", ">=1.0.0"), true);
	assert.equal(versionSatisfies("1.2.3", ">=2.0.0"), false);
	assert.equal(versionSatisfies("1.2.3", ">1.2.3"), false);
	assert.equal(versionSatisfies("1.2.3", ">1.2.2"), true);
	assert.equal(versionSatisfies("1.2.3", "<2.0.0"), true);
	assert.equal(versionSatisfies("1.2.3", "<1.2.3"), false);
	assert.equal(versionSatisfies("1.2.3", "<=1.2.3"), true);
	assert.equal(versionSatisfies("1.2.3", "<=1.2.2"), false);
	assert.equal(versionSatisfies("1.5.0", ">=1.0.0 <2.0.0"), true);
	assert.equal(versionSatisfies("2.1.0", ">=1.0.0 <2.0.0"), false);
	assert.equal(versionSatisfies("1.0.0", ">1.0.0 <=1.5.0"), false);
	assert.equal(versionSatisfies("1.0.1", ">1.0.0 <=1.5.0"), true);
	assert.equal(versionSatisfies("9.9.9", "*"), true);
	assert.equal(versionSatisfies("not-a-version", ">=1.0.0"), false);
});

test("CP-DPL-CLI-01 graph throws DEPENDENCY_UNRESOLVED for a missing required provider", () => {
	const modules = [
		moduleFixture({
			moduleRef: "consumer",
			requires: [
				{ contractRef: "missing.contract", versionRange: ">=1.0.0 <2.0.0" },
			],
		}),
	];
	assert.throws(
		() => buildDependencyGraph(modules),
		errorCode("DEPENDENCY_UNRESOLVED"),
	);
});

test("CP-DPL-CLI-01 graph throws DEPENDENCY_INCOMPATIBLE for an out-of-range provider", () => {
	const modules = [
		moduleFixture({
			moduleRef: "provider",
			provides: [{ contractRef: "cap", version: "2.0.0" }],
		}),
		moduleFixture({
			moduleRef: "consumer",
			requires: [{ contractRef: "cap", versionRange: ">=1.0.0 <2.0.0" }],
		}),
	];
	assert.throws(
		() => buildDependencyGraph(modules),
		errorCode("DEPENDENCY_INCOMPATIBLE"),
	);
});

test("CP-DPL-CLI-01 graph throws DEPENDENCY_CYCLE for cyclic dependencies", () => {
	const modules = [
		moduleFixture({
			moduleRef: "a",
			provides: [{ contractRef: "a.cap", version: "1.0.0" }],
			requires: [{ contractRef: "b.cap", versionRange: ">=1.0.0" }],
		}),
		moduleFixture({
			moduleRef: "b",
			provides: [{ contractRef: "b.cap", version: "1.0.0" }],
			requires: [{ contractRef: "a.cap", versionRange: ">=1.0.0" }],
		}),
	];
	assert.throws(
		() => buildDependencyGraph(modules),
		errorCode("DEPENDENCY_CYCLE"),
	);
});

test("graph builds exact moduleRef edges from moduleRef config slots", () => {
	const modules = [
		moduleFixture({ moduleRef: "target" }),
		moduleFixture({
			moduleRef: "consumer",
			configSlots: [
				{
					key: "targetModuleRef",
					type: "moduleRef",
					required: false,
					description: "target module",
					default: "target",
				},
			],
		}),
	];
	const graph = buildDependencyGraph(modules);
	assert.ok(
		graph.edges.some(
			(edge) =>
				edge.kind === "moduleRef" &&
				edge.from === "consumer" &&
				edge.to === "target",
		),
	);
});

test("graph binds the effective config moduleRef override over the slot default", () => {
	const modules = [
		moduleFixture({ moduleRef: "target" }),
		moduleFixture({ moduleRef: "alternate-provider" }),
		moduleFixture({
			moduleRef: "consumer",
			configSlots: [
				{
					key: "providerModuleRef",
					type: "moduleRef",
					required: false,
					description: "provider module",
					default: "target",
				},
			],
		}),
	];
	const graph = buildDependencyGraph(modules, {
		config: { consumer: { providerModuleRef: "alternate-provider" } },
	});
	assert.ok(
		graph.edges.some(
			(edge) =>
				edge.kind === "moduleRef" &&
				edge.from === "consumer" &&
				edge.to === "alternate-provider",
		),
	);
	assert.ok(
		!graph.edges.some(
			(edge) =>
				edge.kind === "moduleRef" &&
				edge.from === "consumer" &&
				edge.to === "target",
		),
	);
});

test("graph throws MODULE_REF_UNRESOLVED for a default moduleRef with no target", () => {
	const modules = [
		moduleFixture({
			moduleRef: "consumer",
			configSlots: [
				{
					key: "providerModuleRef",
					type: "moduleRef",
					required: false,
					description: "provider module",
					default: "missing-provider",
				},
			],
		}),
	];
	assert.throws(
		() => buildDependencyGraph(modules),
		(error: unknown) =>
			error instanceof ModuleRefUnresolvedError &&
			error.code === "MODULE_REF_UNRESOLVED",
	);
});

test("graph throws MODULE_REF_UNRESOLVED for a config override with no target", () => {
	const modules = [
		moduleFixture({ moduleRef: "target" }),
		moduleFixture({
			moduleRef: "consumer",
			configSlots: [
				{
					key: "providerModuleRef",
					type: "moduleRef",
					required: false,
					description: "provider module",
					default: "target",
				},
			],
		}),
	];
	assert.throws(
		() =>
			buildDependencyGraph(modules, {
				config: { consumer: { providerModuleRef: "does-not-exist" } },
			}),
		(error: unknown) =>
			error instanceof ModuleRefUnresolvedError &&
			error.code === "MODULE_REF_UNRESOLVED",
	);
});

test("graph does not treat a URL config value as a module identity", () => {
	const modules = [
		moduleFixture({ moduleRef: "target" }),
		moduleFixture({
			moduleRef: "consumer",
			configSlots: [
				{
					key: "providerModuleRef",
					type: "moduleRef",
					required: false,
					description: "provider module",
					default: "target",
				},
			],
		}),
	];
	assert.throws(
		() =>
			buildDependencyGraph(modules, {
				config: { consumer: { providerModuleRef: "http://localhost:8080" } },
			}),
		(error: unknown) =>
			error instanceof ModuleRefUnresolvedError &&
			error.code === "MODULE_REF_UNRESOLVED",
	);
});

test("preflight reports MODULE_REF_UNRESOLVED as a blocking finding", async () => {
	const modules = [
		moduleFixture({
			moduleRef: "consumer",
			configSlots: [
				{
					key: "providerModuleRef",
					type: "moduleRef",
					required: false,
					description: "provider module",
					default: "missing-provider",
				},
			],
		}),
	];
	const result = await runPreflight(modules);
	assert.equal(result.status, "NOT_READY");
	assert.ok(
		result.findings.some((finding) => finding.code === "MODULE_REF_UNRESOLVED"),
	);
});

test("graph keeps all matching providers and orders the consumer after them", () => {
	const modules = [
		moduleFixture({
			moduleRef: "consumer",
			requires: [{ contractRef: "execution", versionRange: ">=1.0.0 <2.0.0" }],
		}),
		moduleFixture({
			moduleRef: "provider-b",
			provides: [{ contractRef: "execution", version: "1.0.0" }],
		}),
		moduleFixture({
			moduleRef: "provider-a",
			provides: [{ contractRef: "execution", version: "1.0.0" }],
		}),
	];
	const graph = buildDependencyGraph(modules);
	const capabilityTargets = graph.edges
		.filter((edge) => edge.kind === "capability")
		.map((edge) => edge.to)
		.sort();
	assert.deepEqual(capabilityTargets, ["provider-a", "provider-b"]);
	assert.deepEqual(graph.order, ["provider-a", "provider-b", "consumer"]);

	// deterministic: identical input yields identical output
	const again = buildDependencyGraph(modules);
	assert.deepEqual(again.order, graph.order);
	assert.deepEqual(again.edges, graph.edges);
});

test("optional dependency does not block when no provider exists", () => {
	const modules = [
		moduleFixture({
			moduleRef: "consumer",
			requires: [
				{
					contractRef: "optional.cap",
					versionRange: ">=1.0.0",
					optional: true,
				},
			],
		}),
	];
	const graph = buildDependencyGraph(modules);
	assert.deepEqual(graph.order, ["consumer"]);
	assert.equal(graph.edges.length, 0);
});

test("discovery finds the real governed module set", async () => {
	const modules = await discoverModules();
	const refs = new Set(modules.map((module) => module.moduleRef));
	assert.ok(refs.has("agent-gateway"));
	assert.ok(refs.has("module-contract"));
	assert.ok(refs.has("platform-cli"));
	assert.ok(refs.has("dev-tunnel"));
	assert.ok(modules.length >= 20);
	for (const module of modules) {
		assert.equal(module.source.type, "workspace");
		assert.ok(module.moduleRef.length > 0);
		assert.ok(module.packageName.startsWith("@tomflow/proflow-"));
	}
});

test("resolveModules rejects duplicate moduleRef", async () => {
	const catalog = arrayCatalog([
		descriptor({ moduleRef: "dup", packageName: "@tomflow/proflow-aaa" }),
		descriptor({ moduleRef: "dup", packageName: "@tomflow/proflow-bbb" }),
	]);
	const sources = [
		workspaceSource("@tomflow/proflow-aaa"),
		workspaceSource("@tomflow/proflow-bbb"),
	];
	await assert.rejects(
		() => resolveModules(catalog, sources),
		errorCode("DUPLICATE_IDENTITY"),
	);
});

test("resolveModules rejects duplicate packageName", async () => {
	const catalog = arrayCatalog([
		descriptor({ moduleRef: "aaa", packageName: "@tomflow/proflow-same" }),
		descriptor({ moduleRef: "bbb", packageName: "@tomflow/proflow-same" }),
	]);
	const sources = [
		workspaceSource("@tomflow/proflow-same"),
		workspaceSource("@tomflow/proflow-same"),
	];
	await assert.rejects(
		() => resolveModules(catalog, sources),
		errorCode("DUPLICATE_IDENTITY"),
	);
});

test("resolveModules rejects an invalid descriptor", async () => {
	const catalog = arrayCatalog([{ bogus: true }]);
	const sources = [workspaceSource("@tomflow/proflow-bad")];
	await assert.rejects(
		() => resolveModules(catalog, sources),
		errorCode("DESCRIPTOR_INVALID"),
	);
});

test("resolveModules detects moduleVersion != package.json version", async () => {
	const dir = await mkdtemp(join(tmpdir(), "proflow-cli-"));
	try {
		await writeFile(
			join(dir, "package.json"),
			JSON.stringify({ name: "@tomflow/proflow-fixture", version: "9.9.9" }),
		);
		const catalog = arrayCatalog([
			descriptor({
				moduleRef: "fixture",
				packageName: "@tomflow/proflow-fixture",
				moduleVersion: "1.0.0",
			}),
		]);
		const sources = [
			{
				type: "workspace" as const,
				packageName: "@tomflow/proflow-fixture",
				path: dir,
			},
		];
		await assert.rejects(
			() => resolveModules(catalog, sources),
			errorCode("DESCRIPTOR_INVALID"),
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("requirements: human is ACTION_REQUIRED, node runtime satisfied, missing executable FAIL", async () => {
	const modules = [
		moduleFixture({
			moduleRef: "m",
			requirements: [
				{ kind: "human", action: "perform the manual step" },
				{ kind: "runtime", runtime: "node", versionRange: ">=18.0.0" },
				{ kind: "executable", command: "definitely-not-a-real-cmd-xyzzy" },
			],
		}),
	];
	const probes = await probeAllRequirements(modules);
	const human = probes.find((probe) => probe.requirement.kind === "human");
	const runtime = probes.find((probe) => probe.requirement.kind === "runtime");
	const executable = probes.find(
		(probe) => probe.requirement.kind === "executable",
	);
	assert.equal(human?.status, "ACTION_REQUIRED");
	assert.equal(runtime?.status, "PASS");
	assert.equal(executable?.status, "FAIL");
});

test("config: missing required config produces CONFIG_MISSING; secretRef is never echoed", () => {
	const secret = "super-secret-token-123";
	const module = moduleFixture({
		moduleRef: "m",
		configSlots: [
			{
				key: "requiredThing",
				type: "string",
				required: true,
				description: "required value",
			},
			{
				key: "apiKey",
				type: "secretRef",
				required: false,
				sensitive: true,
				description: "credential reference",
			},
		],
	});

	const findings = checkConfigReadiness([module], { m: { apiKey: secret } });
	assert.ok(
		findings.some(
			(finding) =>
				finding.code === "CONFIG_MISSING" && finding.moduleRef === "m",
		),
	);
	assert.ok(!JSON.stringify(findings).includes(secret));

	const resolved = resolveModuleConfig(module, {
		requiredThing: "value",
		apiKey: secret,
	});
	assert.deepEqual(resolved.missing, []);
	assert.deepEqual(resolved.secretRefs, ["apiKey"]);
	// held as a reference, never expanded
	assert.equal(resolved.values.apiKey, secret);
});

test("preflight blocks with findings for an unresolved dependency", async () => {
	const modules = [
		moduleFixture({
			moduleRef: "consumer",
			requires: [{ contractRef: "nope", versionRange: ">=1.0.0" }],
		}),
	];
	const result = await runPreflight(modules);
	assert.equal(result.status, "NOT_READY");
	assert.equal(result.ok, false);
	assert.ok(
		result.findings.some((finding) => finding.code === "DEPENDENCY_UNRESOLVED"),
	);
});

test("preflight blocks with findings for a cyclic dependency", async () => {
	const modules = [
		moduleFixture({
			moduleRef: "a",
			provides: [{ contractRef: "a.cap", version: "1.0.0" }],
			requires: [{ contractRef: "b.cap", versionRange: ">=1.0.0" }],
		}),
		moduleFixture({
			moduleRef: "b",
			provides: [{ contractRef: "b.cap", version: "1.0.0" }],
			requires: [{ contractRef: "a.cap", versionRange: ">=1.0.0" }],
		}),
	];
	const result = await runPreflight(modules);
	assert.equal(result.status, "NOT_READY");
	assert.ok(
		result.findings.some((finding) => finding.code === "DEPENDENCY_CYCLE"),
	);
});

test("preflight blocks with findings for missing config", async () => {
	const modules = [
		moduleFixture({
			moduleRef: "m",
			configSlots: [
				{
					key: "requiredThing",
					type: "string",
					required: true,
					description: "required value",
				},
			],
		}),
	];
	const result = await runPreflight(modules);
	assert.equal(result.status, "NOT_READY");
	assert.ok(
		result.findings.some((finding) => finding.code === "CONFIG_MISSING"),
	);
});
