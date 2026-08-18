import assert from "node:assert/strict";
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

test("platform-host Module Contract C1/C2/C3", async () => {
	const contract = descriptor as unknown as ModuleDescriptor;
	const packageRoot = fileURLToPath(new URL("..", import.meta.url));
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

test("uninstall is idempotent when no Platform Host service is bound", async () => {
	const result = await behaviorAdapter.uninstall();
	assert.equal(result.result.status, "SUCCEEDED");
	assert.equal(result.result.ok, true);
	assert.deepEqual(result.observedEffects, []);
});
