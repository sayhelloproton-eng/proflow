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
