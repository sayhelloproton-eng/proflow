import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	moduleOperationResultSchema,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";
import { behaviorAdapter } from "../deployment/adapter.ts";
import { descriptor } from "../deployment/descriptor.ts";
import { createProviderProbe } from "../src/resource-adapter.ts";

async function workspace(
	context: { after(fn: () => unknown): void },
	prefix: string,
) {
	const root = await mkdtemp(join(tmpdir(), prefix));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

test("parseModuleDescriptor accepts the frozen external-resource descriptor", () => {
	const parsed = parseModuleDescriptor(descriptor);
	assert.equal(parsed.contract, "module");
	assert.equal(parsed.moduleRef, "model-provider-api");
	assert.equal(parsed.kind, "external-resource");
	assert.equal(parsed.provides[0]?.contractRef, "model.provider.api");
	assert.deepEqual(parsed.requires, []);
	assert.equal("lifecycle" in parsed, false);
	assert.equal("verification" in parsed, false);
});

test("all seven management command results satisfy the structured result contract", async (context) => {
	const workspaceRoot = await workspace(context, "proflow-provider-contract-");
	const observations = [
		await behaviorAdapter.install({ workspaceRoot }),
		await behaviorAdapter.uninstall({ workspaceRoot }),
		await behaviorAdapter.status({ workspaceRoot }),
		await behaviorAdapter.setup({ workspaceRoot }),
		await behaviorAdapter.docs({ workspaceRoot }),
		await behaviorAdapter.start({ workspaceRoot }),
		await behaviorAdapter.stop({ workspaceRoot }),
	];
	for (const observation of observations) {
		const parsed = moduleOperationResultSchema.safeParse(observation.result);
		assert.equal(parsed.success, true);
		if (parsed.success) {
			assert.equal(parsed.data.moduleRef, descriptor.moduleRef);
			assert.equal(parsed.data.moduleVersion, descriptor.moduleVersion);
		}
	}
});

test("unconfigured adapter reports ACTION_REQUIRED through status/setup, not missingConfig", async (context) => {
	const workspaceRoot = await workspace(
		context,
		"proflow-provider-unconfigured-",
	);
	assert.deepEqual(
		(await behaviorAdapter.status({ workspaceRoot })).result.data,
		{
			setupStatus: "ACTION_REQUIRED",
			runtimeStatus: "STOPPED",
		},
	);
	const setup = await behaviorAdapter.setup({ workspaceRoot });
	assert.equal(setup.result.status, "ACTION_REQUIRED");
	assert.equal(setup.result.actionRequired?.action, "configure-provider");
});

test("configured adapter owns reachability/auth only and publishes READY provider truth", async (context) => {
	const workspaceRoot = await workspace(context, "proflow-provider-ready-");
	const originalFetch = globalThis.fetch;
	try {
		globalThis.fetch = async () => new Response("{}", { status: 200 });
		const setup = await behaviorAdapter.setup({
			workspaceRoot,
			input: { providerBaseUrl: "http://127.0.0.1:4400/v1/" },
		});
		assert.equal(setup.result.status, "SUCCEEDED");
		const status = await behaviorAdapter.status({ workspaceRoot });
		assert.deepEqual(status.result.data, {
			setupStatus: "READY",
			runtimeStatus: "RUNNING",
		});
		assert.equal(status.externalAvailabilityClaim, "AVAILABLE");
		assert.doesNotMatch(
			JSON.stringify(status.result.data),
			/fast|reason|capability/i,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("adapter exposes exactly the fixed seven management commands", () => {
	assert.deepEqual(Object.keys(behaviorAdapter).sort(), [
		"docs",
		"install",
		"setup",
		"start",
		"status",
		"stop",
		"uninstall",
	]);
});

test("low-level probe is honest about an unreachable provider", async () => {
	const probe = createProviderProbe({ baseUrl: "http://127.0.0.1:1" });
	const result = await probe();
	assert.equal(result.reachable, false);
	assert.equal(result.authenticated, false);
});

test("providerCredential is optional (unauthenticated providers allowed)", () => {
	const credential = descriptor.configSlots.find(
		(slot) => slot.key === "providerCredential",
	);
	assert.equal(credential?.required, false);
});
