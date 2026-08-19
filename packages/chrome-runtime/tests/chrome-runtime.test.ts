import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseModuleDescriptor } from "@tomflow/proflow-module-contract";
import {
	behaviorAdapter,
	createBehaviorAdapter,
} from "../deployment/adapter.ts";
import { descriptor } from "../deployment/descriptor.ts";
import {
	type ChromeRuntimeObservation,
	probeChromeRuntime,
} from "../src/resource-adapter.ts";

const unavailable: ChromeRuntimeObservation = {
	available: false,
	extensionLoaded: false,
};

const availableWithoutExtension: ChromeRuntimeObservation = {
	available: true,
	resourceVersion: "Chrome 150.0.0.0",
	extensionLoaded: false,
};

const availableWithExtension: ChromeRuntimeObservation = {
	available: true,
	resourceVersion: "Chrome 150.0.0.0",
	extensionLoaded: true,
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
	const withoutExtensionStatus = await withoutExtensionAdapter.status();
	assert.equal(withoutExtensionStatus.result.status, "SUCCEEDED");
	assert.equal(
		withoutExtensionStatus.result.resourceVersion,
		"Chrome 150.0.0.0",
	);
	const withoutExtensionVerify = await withoutExtensionAdapter.verify();
	assert.equal(withoutExtensionVerify.result.status, "ACTION_REQUIRED");
	assert.ok("resourceVersion" in withoutExtensionVerify.result);
	assert.equal(
		withoutExtensionVerify.result.resourceVersion,
		"Chrome 150.0.0.0",
	);

	const withExtensionAdapter = createBehaviorAdapter({
		probe: async () => availableWithExtension,
	});
	const withExtensionVerify = await withExtensionAdapter.verify();
	assert.equal(withExtensionVerify.result.status, "SUCCEEDED");
	assert.equal(withExtensionVerify.result.resourceVersion, "Chrome 150.0.0.0");
});

test("explicit Chrome probe tolerates a slow but healthy version response beyond five seconds", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-chrome-slow-probe-"));
	const executable = join(root, "slow-chrome");
	try {
		await writeFile(
			executable,
			"#!/bin/sh\nsleep 5.5\nprintf 'Slow Chrome 1.0.0\\n'\n",
			"utf8",
		);
		await chmod(executable, 0o755);
		const observation = await probeChromeRuntime(executable);
		assert.equal(observation.available, true);
		assert.equal(observation.resourceVersion, "Slow Chrome 1.0.0");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("adapter exposes no start/stop/restart lifecycle", () => {
	for (const adapter of [behaviorAdapter, createBehaviorAdapter()]) {
		assert.equal("start" in adapter, false);
		assert.equal("stop" in adapter, false);
		assert.equal("restart" in adapter, false);
	}
});
