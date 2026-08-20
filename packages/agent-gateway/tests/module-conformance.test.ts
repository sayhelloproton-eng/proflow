import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	runBehaviorConformance,
	runPackageConformance,
	runStaticConformance,
} from "@tomflow/proflow-deployment-conformance";
import type { ModuleDescriptor } from "@tomflow/proflow-module-contract";
import {
	behaviorAdapter,
	createProductionBinding,
} from "../deployment/adapter.ts";
import { descriptor } from "../deployment/descriptor.ts";

test("module contract C1/C2/C3", async () => {
	const packageRoot = fileURLToPath(new URL("..", import.meta.url));
	const contract = descriptor as unknown as ModuleDescriptor;
	assert.equal(runStaticConformance(descriptor).status, "PASS");
	assert.equal(
		(await runPackageConformance(packageRoot, contract)).status,
		"PASS",
	);
	assert.equal(
		(await runBehaviorConformance(contract, behaviorAdapter)).status,
		"PASS",
	);
});

test("uninstall is idempotent when no Gateway service is bound", async () => {
	const result = await behaviorAdapter.uninstall();
	assert.equal(result.result.status, "SUCCEEDED");
	assert.equal(result.result.ok, true);
	assert.deepEqual(result.observedEffects, []);
});

test("production binding preserves Gateway own config truth while dependencies are unavailable", async () => {
	const config = {
		localBaseUrl: "http://127.0.0.1:4201/",
		publicBaseUrl: "https://gateway.example.test/",
		downstreamCredentialFile: "/tmp/downstream.token",
	};
	const unbound = await createProductionBinding({
		moduleRef: "agent-gateway",
		workspaceRoot: "/tmp/proflow-workspace",
		config,
		configByModuleRef: new Map(),
	});
	const status = unbound.behaviorAdapter.status;
	assert.equal(typeof status, "function");
	const observed = await (
		status as () => Promise<{ result: { data: unknown } }>
	)();
	assert.deepEqual(observed.result.data, {
		configStatus: "READY",
		runtimeStatus: "UNKNOWN",
	});

	const invalid = await createProductionBinding({
		moduleRef: "agent-gateway",
		workspaceRoot: "/tmp/proflow-workspace",
		config: { ...config, localBaseUrl: "https://gateway.example.test/" },
		configByModuleRef: new Map(),
	});
	const invalidStatus = invalid.behaviorAdapter.status;
	assert.equal(typeof invalidStatus, "function");
	const invalidObserved = await (
		invalidStatus as () => Promise<{ result: { data: unknown } }>
	)();
	assert.deepEqual(invalidObserved.result.data, {
		configStatus: "INVALID",
		runtimeStatus: "UNKNOWN",
	});
});
