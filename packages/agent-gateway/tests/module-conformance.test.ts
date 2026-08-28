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
import {
	type ModuleDescriptor,
	writeModuleSharedFacts,
} from "@tomflow/proflow-module-contract";
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
			setupStatus: "BLOCKED",
			runtimeStatus: "STOPPED",
			issues: [
				{
					scope: "SETUP",
					code: "UPSTREAM_NOT_READY",
					message: "等待 dev-tunnel、platform-host 完成前置配置",
					relatedModuleRefs: ["dev-tunnel", "platform-host"],
					nextCommand: "platform setup --module dev-tunnel",
				},
			],
		});
		const setup = await behaviorAdapter.setup(context);
		assert.equal(setup.result.status, "SUCCEEDED");
		assert.deepEqual(setup.result.data, {
			localBaseUrl: data.localBaseUrl,
			waitingFor: ["dev-tunnel", "platform-host"],
		});
		assert.equal(descriptor.configSlots.length, 0);
	} finally {
		await rm(workspaceRoot, { recursive: true, force: true });
	}
});

test("status reports only dev-tunnel when platform-host facts are already complete", async () => {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-gateway-precise-"),
	);
	try {
		await behaviorAdapter.install({ workspaceRoot });
		await writeModuleSharedFacts({ workspaceRoot }, "platform-host", {
			endpoint: "http://127.0.0.1:43100",
			gatewayTransportCredentialFile: "/tmp/gateway.token",
			stateRoot: "/tmp/proflow-state",
		});
		const observed = await behaviorAdapter.status({ workspaceRoot });
		const data = observed.result.data as {
			issues: Array<{ message: string; relatedModuleRefs: string[] }>;
		};
		assert.deepEqual(data.issues[0]?.relatedModuleRefs, ["dev-tunnel"]);
		assert.doesNotMatch(data.issues[0]?.message ?? "", /platform-host/);
	} finally {
		await rm(workspaceRoot, { recursive: true, force: true });
	}
});
