import assert from "node:assert/strict";
import { test } from "node:test";

import type { ResolvedModule } from "../src/contracts.ts";
import {
	FROZEN_DEPLOYMENT_INSTALL_ORDER,
	orderModuleRefsForInstall,
} from "../src/deployment-order.ts";
import { installModulesThin } from "../src/lifecycle/thin.ts";
import type { ModuleCatalog, ModuleSource } from "../src/modules.ts";

function moduleOf(
	moduleRef: string,
	requires: ResolvedModule["requires"] = [],
): ResolvedModule {
	return {
		moduleRef,
		packageName: `@tomflow/proflow-${moduleRef}`,
		moduleVersion: "1.0.0",
		kind: "library",
		identity: { domain: "deployment-governance", summary: moduleRef },
		documentation: { docs: "DOCS.md", setup: "SETUP.md" },
		provides: [],
		requires,
		requirements: [],
		configSlots: [],
		effects: [],
		source: { type: "workspace", path: `/tmp/${moduleRef}` },
	};
}

test("CP-DEP-CLI-INSTALL-ORDER-01 frozen deployment install order starts with Chrome, Extension, Agents, Gateway and Tunnel", () => {
	assert.deepEqual(FROZEN_DEPLOYMENT_INSTALL_ORDER.slice(0, 7), [
		"chrome-runtime",
		"execution-browser-extension",
		"agent-controller-dev",
		"agent-product",
		"agent-test-ops",
		"agent-gateway",
		"dev-tunnel",
	]);
	assert.equal(FROZEN_DEPLOYMENT_INSTALL_ORDER.at(-1), "chatgpt-carrier");
});

test("CP-DEP-CLI-INSTALL-ORDER-02 RF-DEP-CLI-INSTALL-ORDER-02 known modules follow product install order regardless of discovery order", () => {
	assert.deepEqual(
		orderModuleRefsForInstall([
			"dev-tunnel",
			"agent-product",
			"chrome-runtime",
			"execution-browser-extension",
			"agent-gateway",
		]),
		[
			"chrome-runtime",
			"execution-browser-extension",
			"agent-product",
			"agent-gateway",
			"dev-tunnel",
		],
	);
});

test("CP-DEP-CLI-INSTALL-ORDER-04 unknown future modules are deterministic and run after the frozen known sequence", () => {
	assert.deepEqual(
		orderModuleRefsForInstall(["z-future", "chrome-runtime", "a-future"]),
		["chrome-runtime", "a-future", "z-future"],
	);
});

test("CP-DEP-CLI-INSTALL-ORDER-03 RF-DEP-CLI-INSTALL-ORDER-01 install uses deployment order while still validating dependencies", async () => {
	const calls: string[] = [];
	const modules = [
		moduleOf("dev-tunnel"),
		moduleOf("agent-product"),
		moduleOf("chrome-runtime"),
		moduleOf("execution-browser-extension"),
		moduleOf("agent-gateway"),
	];
	const catalog: ModuleCatalog = {
		async sources() {
			return [];
		},
		async loadDescriptor(_source: ModuleSource) {
			throw new Error("not used");
		},
		async loadAdapter(source: ModuleSource) {
			const moduleRef = source.packageName.replace("@tomflow/proflow-", "");
			return {
				behaviorAdapter: {
					install: async () => {
						calls.push(moduleRef);
						return {
							result: {
								contract: "deployment.result.v1",
								ok: true,
								status: "SUCCEEDED",
								moduleRef,
								moduleVersion: "1.0.0",
							},
							observedEffects: [],
						};
					},
				},
			};
		},
	};
	const result = await installModulesThin(catalog, modules, "/tmp/workspace");
	assert.equal(result.completed, true);
	assert.deepEqual(calls, [
		"chrome-runtime",
		"execution-browser-extension",
		"agent-product",
		"agent-gateway",
		"dev-tunnel",
	]);
});
