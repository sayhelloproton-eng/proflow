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

async function workspace(
	context: { after(fn: () => unknown): void },
	prefix: string,
) {
	const root = await mkdtemp(join(tmpdir(), prefix));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

test("parseModuleDescriptor accepts the chrome-runtime descriptor", () => {
	const parsed = parseModuleDescriptor(descriptor);
	assert.equal(parsed.moduleRef, "chrome-runtime");
	assert.equal(parsed.kind, "external-resource");
	assert.deepEqual(parsed.provides, []);
	assert.equal("lifecycle" in parsed, false);
});

test("adapter status/setup report only Chrome runtime prerequisite truth", async (context) => {
	const workspaceRoot = await workspace(context, "proflow-chrome-adapter-");
	const unavailableAdapter = createBehaviorAdapter(async () => unavailable);
	assert.deepEqual(
		(await unavailableAdapter.status({ workspaceRoot })).result.data,
		{
			setupStatus: "ACTION_REQUIRED",
			runtimeStatus: "STOPPED",
		},
	);
	assert.equal(
		(await unavailableAdapter.setup({ workspaceRoot })).result.status,
		"ACTION_REQUIRED",
	);

	const availableAdapter = createBehaviorAdapter(
		async () => availableWithoutExtension,
	);
	const status = await availableAdapter.status({ workspaceRoot });
	assert.deepEqual(status.result.data, {
		setupStatus: "READY",
		runtimeStatus: "RUNNING",
	});
	assert.equal(
		(await availableAdapter.setup({ workspaceRoot })).result.status,
		"SUCCEEDED",
	);
	assert.equal("extensionLoaded" in (status.result.data as object), false);
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

test("adapter exposes exactly the fixed seven management commands without a restart primitive", () => {
	assert.deepEqual(Object.keys(behaviorAdapter).sort(), [
		"docs",
		"install",
		"setup",
		"start",
		"status",
		"stop",
		"uninstall",
	]);
	assert.equal("restart" in behaviorAdapter, false);
});
