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
	const result = await behaviorAdapter.uninstall({
		workspaceRoot: "/__proflow_host_uninstall__",
	});
	assert.equal(result.result.status, "SUCCEEDED");
	assert.equal(result.result.ok, true);
	assert.deepEqual(result.observedEffects, []);
});

test("Module.install owns Platform Host state/secrets while producer dependencies remain explicit", async () => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), "proflow-host-module-"));
	const context = { workspaceRoot };
	try {
		const installed = await behaviorAdapter.install(context);
		assert.equal(installed.result.status, "SUCCEEDED");
		const data = installed.result.data as {
			endpoint: string;
			stateRoot: string;
			identityTokenFile: string;
		};
		assert.equal(data.stateRoot, join(workspaceRoot, ".proflow"));
		assert.match(data.endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
		assert.match(data.identityTokenFile, /execution-identity\.token$/);
		const observed = await behaviorAdapter.status(context);
		assert.deepEqual(observed.result.data, {
			setupStatus: "READY",
			runtimeStatus: "STOPPED",
			issues: [
				{
					scope: "RUNTIME",
					code: "UPSTREAM_NOT_READY",
					message: "等待 Execution 与 Model Runtime 发布运行所需服务信息",
					relatedModuleRefs: ["execution-runtime", "model-runtime"],
					nextCommand: "platform setup",
				},
			],
		});
		const setup = await behaviorAdapter.setup(context);
		assert.equal(setup.result.status, "SUCCEEDED");
		assert.match(
			String((setup.result.data as { endpoint: string }).endpoint),
			/^http:\/\/127\.0\.0\.1:\d+$/,
		);
		assert.equal(descriptor.configSlots.length, 0);
	} finally {
		await rm(workspaceRoot, { recursive: true, force: true });
	}
});
