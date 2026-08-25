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
	GOOGLE_CHROME_MAC_DMG,
	installChromeRuntime,
	probeChromeRuntime,
} from "../src/resource-adapter.ts";

const unavailable: ChromeRuntimeObservation = { available: false };
const available: ChromeRuntimeObservation = {
	available: true,
	resourceVersion: "Google Chrome 150.0.0.0",
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
	assert.equal(
		parsed.requirements.some((item) => item.kind === "human"),
		false,
	);
	assert.equal("lifecycle" in parsed, false);
});

test("install is idempotent when Chrome is already available", async (context) => {
	const workspaceRoot = await workspace(context, "proflow-chrome-installed-");
	let installs = 0;
	const adapter = createBehaviorAdapter(
		async () => available,
		async () => {
			installs += 1;
			return available;
		},
	);
	const result = await adapter.install({ workspaceRoot });
	assert.equal(result.result.status, "SUCCEEDED");
	assert.equal(installs, 0);
});

test("install automatically installs missing Chrome and verifies it", async (context) => {
	const workspaceRoot = await workspace(
		context,
		"proflow-chrome-auto-install-",
	);
	let installed = false;
	let installs = 0;
	const adapter = createBehaviorAdapter(
		async () => (installed ? available : unavailable),
		async () => {
			installs += 1;
			installed = true;
			return available;
		},
	);
	const result = await adapter.install({ workspaceRoot });
	assert.equal(result.result.status, "SUCCEEDED");
	assert.equal(installs, 1);
	assert.deepEqual(result.result.data, available);
	assert.deepEqual((await adapter.status({ workspaceRoot })).result.data, {
		setupStatus: "READY",
		runtimeStatus: "RUNNING",
	});
});

test("install fails closed when automatic Chrome installation fails", async (context) => {
	const workspaceRoot = await workspace(
		context,
		"proflow-chrome-install-fail-",
	);
	const adapter = createBehaviorAdapter(
		async () => unavailable,
		async () => {
			throw new Error("CHROME_DOWNLOAD_FAILED");
		},
	);
	const result = await adapter.install({ workspaceRoot });
	assert.equal(result.result.status, "FAILED");
	assert.equal(result.result.error?.code, "INSTALL_FAILED");
	assert.equal(result.result.error?.message, "CHROME_DOWNLOAD_FAILED");
});

test("status exposes one stable recovery command when Chrome is unavailable", async (context) => {
	const workspaceRoot = await workspace(context, "proflow-chrome-status-");
	const adapter = createBehaviorAdapter(async () => unavailable);
	assert.deepEqual((await adapter.status({ workspaceRoot })).result.data, {
		setupStatus: "ACTION_REQUIRED",
		runtimeStatus: "STOPPED",
		issues: [
			{
				scope: "SETUP",
				code: "CHROME_UNAVAILABLE",
				message: "未检测到可用的 Google Chrome",
				relatedModuleRefs: [],
				nextCommand: "platform install",
			},
		],
	});
});

test("macOS installer uses the official Chrome DMG and verifies the installed executable", async (context) => {
	const applicationRoot = await workspace(context, "proflow-chrome-app-root-");
	const commands: Array<{ command: string; args: readonly string[] }> = [];
	let verifiedExecutable = "";
	const result = await installChromeRuntime({
		platformName: "darwin",
		applicationRoot,
		run: async (command, args) => {
			commands.push({ command, args });
		},
		verify: async (executable) => {
			verifiedExecutable = executable;
			return available;
		},
	});
	assert.deepEqual(result, available);
	assert.equal(commands[0]?.command, "/usr/bin/curl");
	assert.ok(commands[0]?.args.includes(GOOGLE_CHROME_MAC_DMG));
	assert.equal(commands[1]?.command, "/usr/bin/hdiutil");
	assert.equal(commands[2]?.command, "/usr/bin/ditto");
	assert.equal(commands.at(-1)?.command, "/usr/bin/hdiutil");
	assert.match(
		verifiedExecutable,
		/Google Chrome\.app\/Contents\/MacOS\/Google Chrome$/,
	);
});

test("automatic install fails closed on unsupported operating systems", async () => {
	await assert.rejects(
		() => installChromeRuntime({ platformName: "linux" }),
		/CHROME_AUTO_INSTALL_UNSUPPORTED/,
	);
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
