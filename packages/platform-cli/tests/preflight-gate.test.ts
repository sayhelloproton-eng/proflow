import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModuleOperationResult } from "@tomflow/proflow-module-contract";

import type { ResolvedModule } from "../src/contracts.ts";
import type { ModuleCatalog } from "../src/modules.ts";
import type { ModulePreflightResult } from "../src/preflight/index.ts";
import { runPreflight } from "../src/preflight/index.ts";

function moduleFixture(lifecycle: string[]): ResolvedModule {
	return {
		moduleRef: "m",
		packageName: "@tomflow/proflow-m",
		moduleVersion: "1.0.0",
		kind: "service",
		provides: [],
		requires: [],
		requirements: [],
		configSlots: [],
		lifecycle,
		verification: {
			checks: [
				{ id: "health", description: "observed health", lifecycle: "verify" },
			],
		},
		effects: [],
		source: { type: "workspace", path: "/fixture" },
	};
}

function makeResult(
	status: ModuleOperationResult["status"],
): ModuleOperationResult {
	const base = {
		contract: "deployment.result.v1" as const,
		ok: status === "SUCCEEDED",
		status,
		moduleRef: "m",
		moduleVersion: "1.0.0",
	};
	switch (status) {
		case "SUCCEEDED":
			return base;
		case "ACTION_REQUIRED":
			return {
				...base,
				actionRequired: { action: "bind runtime", description: "wire adapter" },
			};
		case "BLOCKED":
			return {
				...base,
				error: {
					code: "EXTERNAL_RESOURCE_UNAVAILABLE",
					message: "no runtime",
					retryable: false,
				},
			};
		case "FAILED":
			return {
				...base,
				error: { code: "COMMAND_FAILED", message: "boom", retryable: false },
			};
	}
}

function preflightCatalog(
	status: ModuleOperationResult["status"] | "unbound",
): ModuleCatalog {
	return {
		async sources() {
			return [];
		},
		async loadDescriptor() {
			throw new Error("descriptor loading is not used by runPreflight");
		},
		async loadAdapter() {
			if (status === "unbound") {
				// No behaviorAdapter at all — the adapter is not bound to a runtime.
				return {};
			}
			return {
				behaviorAdapter: {
					preflight: () => ({
						result: makeResult(status),
						observedEffects: [],
					}),
				},
			};
		},
	};
}

function modulePreflightOf(
	results: ModulePreflightResult[],
	moduleRef: string,
): ModulePreflightResult | undefined {
	return results.find((result) => result.moduleRef === moduleRef);
}

test("preflight dispatches a declared preflight primitive and reports SUCCEEDED as ready", async () => {
	const result = await runPreflight([moduleFixture(["preflight"])], {
		catalog: preflightCatalog("SUCCEEDED"),
	});

	assert.equal(result.ok, true);
	assert.equal(result.status, "READY");
	const modulePreflight = modulePreflightOf(result.modulePreflight, "m");
	assert.equal(modulePreflight?.status, "SUCCEEDED");
	assert.equal(
		result.findings.some(
			(finding) => finding.code === "MODULE_PREFLIGHT_ACTION_REQUIRED",
		),
		false,
	);
});

test("preflight reports ACTION_REQUIRED when the adapter preflight needs a human action", async () => {
	const result = await runPreflight([moduleFixture(["preflight"])], {
		catalog: preflightCatalog("ACTION_REQUIRED"),
	});

	assert.equal(result.ok, false);
	assert.equal(result.status, "ACTION_REQUIRED");
	assert.equal(
		modulePreflightOf(result.modulePreflight, "m")?.status,
		"ACTION_REQUIRED",
	);
	assert.ok(
		result.findings.some(
			(finding) =>
				finding.code === "MODULE_PREFLIGHT_ACTION_REQUIRED" &&
				finding.severity === "action" &&
				finding.moduleRef === "m",
		),
	);
});

test("preflight reports BLOCKED as a blocking finding, not a thrown failure", async () => {
	const result = await runPreflight([moduleFixture(["preflight"])], {
		catalog: preflightCatalog("BLOCKED"),
	});

	assert.equal(result.ok, false);
	assert.equal(result.status, "NOT_READY");
	assert.equal(
		modulePreflightOf(result.modulePreflight, "m")?.status,
		"BLOCKED",
	);
	assert.ok(
		result.findings.some(
			(finding) =>
				finding.code === "MODULE_PREFLIGHT_BLOCKED" &&
				finding.severity === "error" &&
				finding.moduleRef === "m",
		),
	);
});

test("preflight reports FAILED as a blocking finding, not a thrown failure", async () => {
	const result = await runPreflight([moduleFixture(["preflight"])], {
		catalog: preflightCatalog("FAILED"),
	});

	assert.equal(result.ok, false);
	assert.equal(result.status, "NOT_READY");
	assert.equal(
		modulePreflightOf(result.modulePreflight, "m")?.status,
		"FAILED",
	);
	assert.ok(
		result.findings.some(
			(finding) =>
				finding.code === "MODULE_PREFLIGHT_FAILED" &&
				finding.severity === "error" &&
				finding.moduleRef === "m",
		),
	);
});

test("preflight reports ACTION_REQUIRED when the adapter is unbound, not a failure", async () => {
	const result = await runPreflight([moduleFixture(["preflight"])], {
		catalog: preflightCatalog("unbound"),
	});

	assert.equal(result.ok, false);
	assert.equal(result.status, "ACTION_REQUIRED");
	assert.equal(
		modulePreflightOf(result.modulePreflight, "m")?.status,
		"UNBOUND",
	);
	assert.ok(
		result.findings.some(
			(finding) =>
				finding.code === "MODULE_PREFLIGHT_ACTION_REQUIRED" &&
				finding.severity === "action" &&
				finding.moduleRef === "m",
		),
	);
});

test("preflight skips module preflight dispatch for modules that do not declare it", async () => {
	const result = await runPreflight([moduleFixture(["verify"])], {
		catalog: preflightCatalog("SUCCEEDED"),
	});

	assert.equal(result.ok, true);
	assert.equal(result.status, "READY");
	assert.deepEqual(result.modulePreflight, []);
});

test("preflight without a catalog still runs generic checks and skips module preflight", async () => {
	const result = await runPreflight([moduleFixture(["preflight"])]);

	assert.equal(result.ok, true);
	assert.equal(result.status, "READY");
	assert.deepEqual(result.modulePreflight, []);
});
