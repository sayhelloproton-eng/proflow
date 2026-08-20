import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	runBehaviorConformance,
	runPackageConformance,
	runStaticConformance,
} from "@tomflow/proflow-deployment-conformance";
import type { ModuleDescriptor } from "@tomflow/proflow-module-contract";
import { behaviorAdapter } from "../deployment/adapter.ts";
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
	const result = await behaviorAdapter.uninstall({
		workspaceRoot: "/__proflow_gateway_uninstall__",
	});
	assert.equal(result.result.status, "SUCCEEDED");
	assert.equal(result.result.ok, true);
	assert.deepEqual(result.observedEffects, []);
});

test("Module.install owns deterministic Gateway config while producer dependencies remain explicit", async () => {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-gateway-module-"),
	);
	const context = { workspaceRoot };
	try {
		const installed = await behaviorAdapter.install(context);
		assert.equal(installed.result.status, "SUCCEEDED");
		const data = installed.result.data as {
			localBaseUrl: string;
			publicBaseUrl?: string;
		};
		assert.match(data.localBaseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
		assert.equal(data.publicBaseUrl, undefined);
		const observed = await behaviorAdapter.status(context);
		assert.deepEqual(observed.result.data, {
			setupStatus: "FAILED",
			runtimeStatus: "STOPPED",
		});
		assert.equal(descriptor.configSlots.length, 0);
	} finally {
		await rm(workspaceRoot, { recursive: true, force: true });
	}
});
