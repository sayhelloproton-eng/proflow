import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
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

test("deployment setup materializes the Agent Runtime owned durable Role credential store", async () => {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-agent-runtime-deployment-"),
	);
	const before = await behaviorAdapter.status({ workspaceRoot });
	assert.equal(before.result.data?.setupStatus, "ACTION_REQUIRED");
	const setup = await behaviorAdapter.setup({ workspaceRoot });
	assert.equal(setup.result.status, "SUCCEEDED");
	const path = join(
		workspaceRoot,
		".proflow",
		"agent",
		"secrets",
		"role-credentials.json",
	);
	assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {});
	const after = await behaviorAdapter.status({ workspaceRoot });
	assert.equal(after.result.data?.setupStatus, "READY");
});
