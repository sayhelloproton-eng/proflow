import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyBrowserRuntimeStatus } from "../deployment/adapter.ts";

test("browser runtime status exposes the owned bridge lifecycle after setup", () => {
	assert.equal(
		classifyBrowserRuntimeStatus({
			baseSetupReady: false,
			bridgeProbe: { kind: "ABSENT" },
		}),
		"NOT_APPLICABLE",
	);
	assert.equal(
		classifyBrowserRuntimeStatus({
			baseSetupReady: true,
			bridgeProbe: { kind: "ABSENT" },
		}),
		"STOPPED",
	);
	assert.equal(
		classifyBrowserRuntimeStatus({
			baseSetupReady: true,
			bridgeProbe: { kind: "PRESENT" },
		}),
		"RUNNING",
	);
});

test("failed bridge observation must not claim a running runtime", () => {
	assert.equal(
		classifyBrowserRuntimeStatus({
			baseSetupReady: true,
			bridgeProbe: { kind: "PRESENT" },
			bridgeProbeFailed: true,
		}),
		"FAILED",
	);
});

test("bridge lifecycle preserves Extension session setup gates", async () => {
	const { classifyBrowserLiveSetup } = await import("../deployment/adapter.ts");
	const { descriptor } = await import("../deployment/descriptor.ts");
	const identity = {
		extensionId: "d".repeat(32),
		extensionInstanceId: "extension:lifecycle-test",
		moduleVersion: descriptor.moduleVersion,
	};
	for (const scenario of [
		{
			ready: true,
			probe: { kind: "ABSENT" as const },
			setup: true,
		},
		{
			ready: true,
			probe: { kind: "PRESENT" as const, identity },
			setup: true,
		},
		{
			ready: true,
			probe: { kind: "PRESENT" as const },
			setup: false,
		},
		{
			ready: true,
			probe: {
				kind: "PRESENT" as const,
				identity: { ...identity, moduleVersion: "0.0.0" },
			},
			setup: false,
		},
		{
			ready: true,
			probe: {
				kind: "PRESENT" as const,
				identity: { ...identity, extensionInstanceId: "extension:replacement" },
			},
			setup: false,
		},
		{
			ready: false,
			probe: { kind: "ABSENT" as const },
			setup: false,
		},
	]) {
		const live = classifyBrowserLiveSetup({
			baseSetupReady: scenario.ready,
			evidenceInstanceId: identity.extensionInstanceId,
			expectedModuleVersion: descriptor.moduleVersion,
			bridgeProbe: scenario.probe,
		});
		assert.equal(live.setupReady, scenario.setup);
	}
});

test("adapter status reports observed bridge state and schema-valid failures without writes", async (t) => {
	const { mkdtemp, mkdir, writeFile, rm, readFile } = await import(
		"node:fs/promises"
	);
	const os = (await import("node:os")).default;
	const { syncBuiltinESMExports } = await import("node:module");
	const { join } = await import("node:path");
	const {
		moduleWorkspaceStateDirectory,
		writeModuleSharedFacts,
		moduleStatusObservationSchema,
	} = await import("@tomflow/proflow-module-contract");
	const { behaviorAdapter, browserExtensionLoadDir } = await import(
		"../deployment/adapter.ts"
	);
	const { descriptor } = await import("../deployment/descriptor.ts");
	const workspaceRoot = await mkdtemp(
		join(os.tmpdir(), "proflow-status-proof-"),
	);
	const home = t.mock.method(os, "homedir", () => workspaceRoot);
	syncBuiltinESMExports();
	t.after(async () => {
		home.mock.restore();
		syncBuiltinESMExports();
		await rm(workspaceRoot, { recursive: true, force: true });
	});
	const context = { workspaceRoot };
	const stateRoot = moduleWorkspaceStateDirectory(
		context,
		descriptor.moduleRef,
	);
	const loadDir = browserExtensionLoadDir(workspaceRoot);
	const extensionId = "d".repeat(32);
	const extensionInstanceId = "extension:status-proof";
	const profile =
		process.platform === "darwin"
			? join(
					workspaceRoot,
					"Library",
					"Application Support",
					"Google",
					"Chrome",
					"Default",
				)
			: join(workspaceRoot, ".config", "google-chrome", "Default");
	await mkdir(profile, { recursive: true });
	await mkdir(stateRoot, { recursive: true });
	await writeFile(
		join(profile, "Preferences"),
		JSON.stringify({
			extensions: { settings: { [extensionId]: { path: loadDir, state: 1 } } },
		}),
	);
	await writeFile(
		join(stateRoot, "setup.json"),
		JSON.stringify({ extensionId }),
	);
	const evidenceFile = join(stateRoot, "verification.json");
	const evidence = JSON.stringify({
		contract: "proflow.browser-extension-verification.v1",
		moduleVersion: descriptor.moduleVersion,
		loadDir,
		extensionId,
		extensionInstanceId,
		serviceWorker: "RUNNING",
		evidenceSource: "PAIRING_HEARTBEAT",
		observedAt: new Date().toISOString(),
	});
	await writeFile(evidenceFile, evidence);
	const bridgeTokenFile = join(stateRoot, "fixture.token");
	await writeFile(bridgeTokenFile, "t".repeat(40), { mode: 0o600 });
	await writeModuleSharedFacts(context, descriptor.moduleRef, {
		bridgeEndpoint: "http://127.0.0.1:1",
		bridgeTokenFile,
	});
	let mode: "absent" | "online" | "offline" | "failure" | "invalid" = "absent";
	t.mock.method(globalThis, "fetch", async () => {
		if (mode === "absent")
			throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
		if (mode === "failure") throw new Error("fixture probe failure");
		if (mode === "invalid") return Response.json({});
		return Response.json(
			mode === "offline"
				? { online: false }
				: {
						online: true,
						extensionInstanceId,
						moduleVersion: descriptor.moduleVersion,
					},
		);
	});
	for (const scenario of [
		{ mode: "absent", setup: "READY", runtime: "STOPPED" },
		{ mode: "online", setup: "READY", runtime: "RUNNING" },
		{ mode: "offline", setup: "ACTION_REQUIRED", runtime: "RUNNING" },
		{ mode: "failure", setup: "READY", runtime: "FAILED" },
		{ mode: "invalid", setup: "READY", runtime: "FAILED" },
	] as const) {
		mode = scenario.mode;
		const observation = await behaviorAdapter.status(context);
		const status = moduleStatusObservationSchema.parse(observation.result.data);
		assert.equal(status.setupStatus, scenario.setup);
		assert.equal(status.runtimeStatus, scenario.runtime);
		if (scenario.runtime === "FAILED") {
			assert.deepEqual(
				status.issues?.map((issue) => issue.scope),
				["RUNTIME"],
			);
		}
		assert.deepEqual(observation.observedEffects, []);
		assert.equal(await readFile(evidenceFile, "utf8"), evidence);
	}
});
