import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
	createBrowserReconnectOwner,
	restoreBrowserSessionIdentity,
} from "../src/browser-session-reconnect.ts";
import { createBrowserRealityBridgeServer } from "../src/bridge.ts";
import {
	classifyBrowserLiveSetup,
	classifyBrowserRuntimeStatus,
} from "../deployment/adapter.ts";

test("AUTO_RECONNECT_AFTER_BRIDGE_RESTART paired config survives unavailable bridge and reaches ONLINE without reload/setup", {
	timeout: 5000,
}, async () => {
	const token = "reconnect-test-token-".repeat(3);
	const extensionId = "abcdefghijklmnopabcdefghijklmnop";
	const identity = {
		extensionInstanceId: "extension:paired",
		moduleVersion: "0.1.54",
	};
	let server:
		| Awaited<ReturnType<typeof createBrowserRealityBridgeServer>>
		| undefined;
	let attempts = 0;
	const delays: number[] = [];
	let release!: () => void;
	const connected = new Promise<void>((resolve) => {
		release = resolve;
	});
	let stop!: () => void;
	const hold = new Promise<void>((resolve) => {
		stop = resolve;
	});
	const owner = createBrowserReconnectOwner({
		now: () => 0,
		sleep: async (ms) => {
			delays.push(ms);
			server = await createBrowserRealityBridgeServer({ token, extensionId });
		},
		runSession: async (online) => {
			attempts++;
			if (!server) throw new Error("ECONNREFUSED");
			const headers = {
				authorization: `Bearer ${token}`,
				origin: `chrome-extension://${extensionId}`,
				"content-type": "application/json",
			};
			const hello = await fetch(`${server.endpoint}/v1/session/hello`, {
				method: "POST",
				headers,
				body: JSON.stringify({ extensionId, ...identity }),
			});
			assert.equal(hello.status, 200);
			const poll = await fetch(
				`${server.endpoint}/v1/commands/next?extensionInstanceId=${encodeURIComponent(identity.extensionInstanceId)}`,
				{ headers },
			);
			assert.equal(poll.status, 204);
			const heartbeat = await fetch(
				`${server.endpoint}/v1/session/heartbeat?extensionInstanceId=${encodeURIComponent(identity.extensionInstanceId)}`,
				{ method: "POST", headers, body: "{}" },
			);
			assert.equal(heartbeat.status, 200);
			online();
			release();
			await hold;
		},
	});
	assert.equal(
		classifyBrowserRuntimeStatus({
			baseSetupReady: true,
			bridgeProbe: { kind: "ABSENT" },
		}),
		"STOPPED",
	);
	const flight = owner.start();
	assert.equal(owner.start(), flight);
	try {
		await connected;
		assert.ok(server);
		const status = await fetch(`${server.endpoint}/v1/session/status`, {
			headers: { authorization: `Bearer ${token}` },
		});
		const raw: unknown = await status.json();
		assert.ok(
			typeof raw === "object" &&
				raw !== null &&
				"online" in raw &&
				raw.online === true,
		);
		assert.ok("extensionInstanceId" in raw && raw.extensionInstanceId === identity.extensionInstanceId);
		assert.ok("moduleVersion" in raw && raw.moduleVersion === identity.moduleVersion);
		const bridgeProbe = {
			kind: "PRESENT" as const,
			identity: { extensionId, ...identity },
		};
		assert.deepEqual(
			classifyBrowserLiveSetup({
				baseSetupReady: true,
				evidenceInstanceId: identity.extensionInstanceId,
				expectedModuleVersion: identity.moduleVersion,
				bridgeProbe,
			}),
			{ setupReady: true },
		);
		assert.equal(
			classifyBrowserRuntimeStatus({ baseSetupReady: true, bridgeProbe }),
			"RUNNING",
		);
		assert.equal(owner.state(), "ONLINE");
		assert.equal(attempts, 2);
		assert.deepEqual(delays, [1000]);
	} finally {
		stop();
		await flight;
		await server?.close();
	}
});

test("background wires startup/install/alarm to the same reconnect owner and retains authenticated poll/heartbeat", async () => {
	const [background, lane] = await Promise.all([
		readFile(new URL("../extension/background.ts", import.meta.url), "utf8"),
		readFile(
			new URL("../extension/runtime/browser-session-lane.ts", import.meta.url),
			"utf8",
		),
	]);
	const manifest: unknown = JSON.parse(
		await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
	);
	assert.ok(
		typeof manifest === "object" &&
			manifest !== null &&
			"permissions" in manifest &&
			Array.isArray(manifest.permissions) &&
			manifest.permissions.includes("alarms"),
	);
	assert.match(background, /chrome\.alarms\.onAlarm\.addListener/);
	assert.match(
		background,
		/chrome\.runtime\.onInstalled\.addListener\(requestBackgroundStart\)/,
	);
	assert.match(
		background,
		/chrome\.runtime\.onStartup\.addListener\(requestBackgroundStart\)/,
	);
	assert.match(
		background,
		/await initializeBackgroundRuntime\(\);\s*await browserSessionLane\.run\(online\)/,
	);
	assert.match(background, /restoreBrowserSessionIdentity\(/);
	assert.match(lane, /\/v1\/session\/heartbeat/);
	assert.match(lane, /if \(!hello\.ok\) throw/);
	assert.match(lane, /if \(response\.status === 204\) \{\s*online\(\)/);
});

test("reconnect bounds failures, backs off and allows a later alarm to retry", async () => {
	let now = 0;
	let attempts = 0;
	const delays: number[] = [];
	const owner = createBrowserReconnectOwner({
		now: () => now,
		sleep: async (ms) => {
			delays.push(ms);
		},
		runSession: async () => {
			attempts++;
			throw new Error("401");
		},
	});
	await owner.start();
	assert.equal(attempts, 5);
	assert.deepEqual(delays, [1000, 2000, 4000, 8000]);
	assert.equal(owner.state(), "DISCONNECTED");
	await owner.start();
	assert.equal(attempts, 5);
	now = 60_000;
	await owner.start();
	assert.equal(attempts, 10);
});

test("Service Worker wake restores session identity only for the same extension and version", async () => {
	const values: Record<string, unknown> = {};
	const storage = {
		get: async () => values,
		set: async (value: Record<string, unknown>) => {
			Object.assign(values, value);
		},
	};
	const first = await restoreBrowserSessionIdentity(
		storage,
		"ext",
		"1",
		() => "extension:first",
	);
	assert.equal(
		await restoreBrowserSessionIdentity(
			storage,
			"ext",
			"1",
			() => "extension:wrong",
		),
		first,
	);
	assert.equal(
		await restoreBrowserSessionIdentity(
			storage,
			"ext",
			"2",
			() => "extension:updated",
		),
		"extension:updated",
	);
});
