import assert from "node:assert/strict";
import { test } from "node:test";

import { parseModuleDescriptor } from "@tomflow/proflow-module-contract";
import {
	behaviorAdapter,
	createBehaviorAdapter,
} from "../deployment/adapter.ts";
import { descriptor } from "../deployment/descriptor.ts";
import type { ChromeRuntimeObservation } from "../src/resource-adapter.ts";

const unavailable: ChromeRuntimeObservation = {
	available: false,
	extensionLoaded: false,
};

const availableWithoutExtension: ChromeRuntimeObservation = {
	available: true,
	resourceVersion: "Chrome 150.0.0.0",
	extensionLoaded: false,
};

test("parseModuleDescriptor accepts the chrome-runtime descriptor", () => {
	const parsed = parseModuleDescriptor(descriptor);
	assert.equal(parsed.moduleRef, "chrome-runtime");
	assert.equal(parsed.kind, "external-resource");
	assert.deepEqual(parsed.provides, []);
});

test("adapter returns ACTION_REQUIRED, not SUCCEEDED, when no real Chrome or extension is present", async () => {
	const unboundStatus = await behaviorAdapter.status();
	assert.equal(unboundStatus.result.status, "ACTION_REQUIRED");
	const unboundVerify = await behaviorAdapter.verify();
	assert.equal(unboundVerify.result.status, "ACTION_REQUIRED");

	const unavailableAdapter = createBehaviorAdapter({
		probe: async () => unavailable,
	});
	assert.equal(
		(await unavailableAdapter.status()).result.status,
		"ACTION_REQUIRED",
	);
	assert.equal(
		(await unavailableAdapter.verify()).result.status,
		"ACTION_REQUIRED",
	);

	const withoutExtensionAdapter = createBehaviorAdapter({
		probe: async () => availableWithoutExtension,
	});
	assert.equal(
		(await withoutExtensionAdapter.status()).result.status,
		"SUCCEEDED",
	);
	assert.equal(
		(await withoutExtensionAdapter.verify()).result.status,
		"ACTION_REQUIRED",
	);
});

test("adapter exposes no start/stop/restart lifecycle", () => {
	for (const adapter of [behaviorAdapter, createBehaviorAdapter()]) {
		assert.equal("start" in adapter, false);
		assert.equal("stop" in adapter, false);
		assert.equal("restart" in adapter, false);
	}
});
