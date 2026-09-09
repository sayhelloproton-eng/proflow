import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createExecutionRuntime } from "@tomflow/proflow-execution-runtime";
import {
	BrowserRealityBridgeError,
	createBrowserRealityBridgeServer,
} from "../src/bridge.ts";
import { createExecutionBrowserExtension } from "../src/index.ts";

const extensionId = "a".repeat(32);
const origin = `chrome-extension://${extensionId}`;
const token = "bridge-token-that-is-longer-than-thirty-two-characters";
const moduleVersion = "test-browser-module-version";

async function call(endpoint: string, path: string, init: RequestInit = {}) {
	return fetch(`${endpoint}${path}`, {
		...init,
		headers: {
			authorization: `Bearer ${token}`,
			origin,
			"content-type": "application/json",
			...(init.headers ?? {}),
		},
	});
}

async function callWithoutOrigin(
	endpoint: string,
	path: string,
	init: RequestInit = {},
) {
	return fetch(`${endpoint}${path}`, {
		...init,
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
			...(init.headers ?? {}),
		},
	});
}

async function hello(endpoint: string, instance = "extension:one") {
	const response = await call(endpoint, "/v1/session/hello", {
		method: "POST",
		body: JSON.stringify({
			extensionId,
			extensionInstanceId: instance,
			moduleVersion,
		}),
	});
	assert.equal(response.status, 200);
}

const observation = {
	tabId: 7,
	windowId: 3,
	url: "https://chatgpt.com/g/g-real/c/c-real",
	contentInstanceId: "content:fresh",
	pageState: "IDLE",
	activityKind: null,
	observedAt: "2026-08-13T00:00:00.000Z",
};

test("REAL3 Browser command timeout is an abnormal watchdog, not a normal 15s workflow clock", async () => {
	const source = await readFile(
		new URL("../src/bridge.ts", import.meta.url),
		"utf8",
	);
	assert.match(
		source,
		/commandTimeoutMs = options\.commandTimeoutMs \?\? 120_000/,
	);
	assert.doesNotMatch(
		source,
		/commandTimeoutMs = options\.commandTimeoutMs \?\? 15_000/,
	);
});

test("REG-EXE-BR-08 loopback bridge authenticates exact extension session and transports typed reality", async () => {
	const bridge = await createBrowserRealityBridgeServer({
		token,
		extensionId,
		commandTimeoutMs: 1_000,
	});
	try {
		const unauthenticated = await fetch(`${bridge.endpoint}/v1/session/hello`, {
			method: "POST",
			body: "{}",
		});
		assert.equal(unauthenticated.status, 401);
		const missingOriginHello = await callWithoutOrigin(
			bridge.endpoint,
			"/v1/session/hello",
			{
				method: "POST",
				body: JSON.stringify({
					extensionId,
					extensionInstanceId: "extension:missing-origin",
				}),
			},
		);
		assert.equal(missingOriginHello.status, 401);
		const offlineStatus = await call(bridge.endpoint, "/v1/session/status");
		assert.equal(offlineStatus.status, 200);
		assert.deepEqual(await offlineStatus.json(), {
			online: false,
			sessionOnline: false,
			commandConsumerReady: false,
			extensionInstanceId: null,
			moduleVersion: null,
		});
		await hello(bridge.endpoint);
		assert.equal(bridge.status().sessionOnline, true);
		assert.equal(bridge.status().commandConsumerReady, false);
		assert.equal(bridge.status().online, false);
		const helloOnlyStatus = await call(bridge.endpoint, "/v1/session/status");
		assert.deepEqual(await helloOnlyStatus.json(), {
			online: false,
			sessionOnline: true,
			commandConsumerReady: false,
			extensionInstanceId: "extension:one",
			moduleVersion,
		});
		const firstPoll = await callWithoutOrigin(
			bridge.endpoint,
			"/v1/commands/next?extensionInstanceId=extension%3Aone",
		);
		assert.equal(firstPoll.status, 204);
		assert.equal(bridge.status().commandConsumerReady, true);
		assert.equal(bridge.status().online, true);
		const wrongOrigin = await call(
			bridge.endpoint,
			"/v1/commands/next?extensionInstanceId=extension%3Aone",
			{ headers: { origin: `chrome-extension://${"c".repeat(32)}` } },
		);
		assert.equal(wrongOrigin.status, 401);
		const onlineStatus = await call(bridge.endpoint, "/v1/session/status");
		assert.deepEqual(await onlineStatus.json(), {
			online: true,
			sessionOnline: true,
			commandConsumerReady: true,
			extensionInstanceId: "extension:one",
			moduleVersion,
		});
		const taskStatus = await fetch(`${bridge.endpoint}/tasks/api/status`);
		assert.equal(taskStatus.status, 401);
		const runtimeStatus = bridge.status();
		assert.equal(runtimeStatus.queuedCommands, 0);
		assert.equal(runtimeStatus.pendingCommands, 0);
		assert.equal(typeof runtimeStatus.lastCommandPollAt, "string");
		assert.equal(runtimeStatus.lastCommandDeliveredAt, null);
		assert.equal(runtimeStatus.lastCommandResultAt, null);

		const requested = bridge.browser.observe(7);
		const polled = await callWithoutOrigin(
			bridge.endpoint,
			"/v1/commands/next?extensionInstanceId=extension%3Aone",
		);
		assert.equal(polled.status, 200);
		const command = (await polled.json()) as Record<string, unknown>;
		assert.equal(command.type, "OBSERVE");
		assert.equal(command.tabId, 7);
		assert.equal(typeof bridge.status().lastCommandPollAt, "string");
		assert.equal(typeof bridge.status().lastCommandDeliveredAt, "string");
		assert.equal(bridge.status().lastCommandResultAt, null);
		const result = await call(
			bridge.endpoint,
			"/v1/commands/result?extensionInstanceId=extension%3Aone",
			{
				method: "POST",
				body: JSON.stringify({
					commandId: command.commandId,
					ok: true,
					value: observation,
				}),
			},
		);
		assert.equal(result.status, 200);
		assert.equal(typeof bridge.status().lastCommandResultAt, "string");
		assert.deepEqual(await requested, observation);

		const stale = await callWithoutOrigin(
			bridge.endpoint,
			"/v1/commands/next?extensionInstanceId=extension%3Astale",
		);
		assert.equal(stale.status, 401);
	} finally {
		await bridge.close();
	}
});

test("REG-EXE-BR-07 lost bridge result times out once and is never requeued", async () => {
	const bridge = await createBrowserRealityBridgeServer({
		token,
		extensionId,
		commandTimeoutMs: 1_000,
	});
	try {
		await hello(bridge.endpoint);
		const ready = await callWithoutOrigin(
			bridge.endpoint,
			"/v1/commands/next?extensionInstanceId=extension%3Aone",
		);
		assert.equal(ready.status, 204);
		const requested = bridge.browser.submit(
			7,
			"message fingerprint:1",
			"fingerprint:1",
		);
		const polled = await callWithoutOrigin(
			bridge.endpoint,
			"/v1/commands/next?extensionInstanceId=extension%3Aone",
		);
		assert.equal(polled.status, 200);
		await assert.rejects(requested, (error: unknown) => {
			assert.ok(error instanceof BrowserRealityBridgeError);
			assert.equal(error.code, "BRIDGE_COMMAND_TIMEOUT");
			return true;
		});
		assert.equal(bridge.status().queuedCommands, 0);
		assert.equal(bridge.status().pendingCommands, 0);
		const empty = await callWithoutOrigin(
			bridge.endpoint,
			"/v1/commands/next?extensionInstanceId=extension%3Aone",
		);
		assert.equal(empty.status, 204);
	} finally {
		await bridge.close();
	}
});

test("REAL3 loopback Tasks web surface is extension-minted and proxies owner applications without exposing owner tokens", async () => {
	const calls: Array<{ surface: string; operation: string }> = [];
	const bridge = await createBrowserRealityBridgeServer({
		token,
		extensionId,
		taskWeb: {
			html: '<!doctype html><title>ProFlow Tasks</title><script type="module" src="/tasks/app.js"></script>',
			script: "document.body.dataset.ready = '1';",
			async invokeTask(operation) {
				calls.push({ surface: "task", operation });
				return { tasks: [] };
			},
			async invokeApproval(operation) {
				calls.push({ surface: "approval", operation });
				return { approvals: [] };
			},
		},
	});
	try {
		const session = await call(bridge.endpoint, "/v1/tasks/session", {
			method: "POST",
		});
		assert.equal(session.status, 200);
		const bootstrapUrl = String(
			((await session.json()) as { url: string }).url,
		);
		assert.match(
			bootstrapUrl,
			/^http:\/\/127\.0\.0\.1:\d+\/tasks\/bootstrap\//,
		);
		assert.doesNotMatch(bootstrapUrl, /bridge-token|authorization/i);
		const bootstrap = await fetch(bootstrapUrl, { redirect: "manual" });
		assert.equal(bootstrap.status, 302);
		assert.equal(bootstrap.headers.get("location"), "/tasks");
		const cookie = bootstrap.headers.get("set-cookie");
		assert.ok(cookie?.includes("HttpOnly"));
		const cookieHeader = cookie?.split(";", 1)[0] ?? "";
		const page = await fetch(`${bridge.endpoint}/tasks`, {
			headers: { cookie: cookieHeader },
		});
		assert.equal(page.status, 200);
		assert.match(await page.text(), /ProFlow Tasks/);
		const script = await fetch(`${bridge.endpoint}/tasks/app.js`, {
			headers: { cookie: cookieHeader },
		});
		assert.equal(script.status, 200);
		const status = await fetch(`${bridge.endpoint}/tasks/api/status`, {
			headers: { cookie: cookieHeader },
		});
		assert.equal(status.status, 200);
		const statusBody = (await status.json()) as {
			value: { browserCarrier: Record<string, unknown> };
		};
		assert.deepEqual(statusBody.value.browserCarrier, {
			online: false,
			sessionOnline: false,
			commandConsumerReady: false,
			extensionInstanceId: null,
			moduleVersion: null,
			queuedCommands: 0,
			pendingCommands: 0,
			lastCommandPollAt: null,
			lastCommandDeliveredAt: null,
			lastCommandResultAt: null,
		});
		const task = await fetch(`${bridge.endpoint}/tasks/api/task`, {
			method: "POST",
			headers: {
				cookie: cookieHeader,
				origin: bridge.endpoint,
				"content-type": "application/json",
			},
			body: JSON.stringify({ operation: "task.list", input: {} }),
		});
		assert.equal(task.status, 200);
		assert.deepEqual(await task.json(), { ok: true, value: { tasks: [] } });
		assert.deepEqual(calls, [{ surface: "task", operation: "task.list" }]);

		await hello(bridge.endpoint);
		const readyPoll = await callWithoutOrigin(
			bridge.endpoint,
			"/v1/commands/next?extensionInstanceId=extension%3Aone",
		);
		assert.equal(readyPoll.status, 204);
		const readOnly = await fetch(`${bridge.endpoint}/tasks/api/task`, {
			method: "POST",
			headers: {
				cookie: cookieHeader,
				origin: bridge.endpoint,
				"content-type": "application/json",
			},
			body: JSON.stringify({ operation: "task.list", input: {} }),
		});
		assert.equal(readOnly.status, 200);
		const afterReadOnly = await callWithoutOrigin(
			bridge.endpoint,
			"/v1/commands/next?extensionInstanceId=extension%3Aone",
		);
		assert.equal(afterReadOnly.status, 204);

		const start = await fetch(`${bridge.endpoint}/tasks/api/task`, {
			method: "POST",
			headers: {
				cookie: cookieHeader,
				origin: bridge.endpoint,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				operation: "task.start",
				input: { taskId: "task:one" },
			}),
		});
		assert.equal(start.status, 200);
		const afterStart = await callWithoutOrigin(
			bridge.endpoint,
			"/v1/commands/next?extensionInstanceId=extension%3Aone",
		);
		assert.equal(
			afterStart.status,
			204,
			"Task mutations must not enqueue Extension progression commands",
		);
		assert.deepEqual(calls, [
			{ surface: "task", operation: "task.list" },
			{ surface: "task", operation: "task.list" },
			{ surface: "task", operation: "task.start" },
		]);

		const resume = await fetch(`${bridge.endpoint}/tasks/api/task`, {
			method: "POST",
			headers: {
				cookie: cookieHeader,
				origin: bridge.endpoint,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				operation: "task.resume",
				input: {
					taskId: "task:one",
					expectedTaskVersion: 2,
					idempotencyKey: "b1:bridge:resume",
				},
			}),
		});
		assert.equal(resume.status, 200);
		const afterResume = await callWithoutOrigin(
			bridge.endpoint,
			"/v1/commands/next?extensionInstanceId=extension%3Aone",
		);
		assert.equal(
			afterResume.status,
			204,
			"resume is a Host reconciliation kick, not an Extension command",
		);
		assert.deepEqual(calls.at(-1), {
			surface: "task",
			operation: "task.resume",
		});

		const denied = await fetch(`${bridge.endpoint}/tasks/api/task`, {
			method: "POST",
			headers: { origin: bridge.endpoint, "content-type": "application/json" },
			body: JSON.stringify({ operation: "task.list", input: {} }),
		});
		assert.equal(denied.status, 401);
	} finally {
		await bridge.close();
	}
});

test("REG-EXE-BR-08 durable Execution Runtime reaches browser reality through the live bridge transport", async () => {
	const directory = await mkdtemp(join(tmpdir(), "proflow-browser-bridge-"));
	const bridge = await createBrowserRealityBridgeServer({
		token,
		extensionId,
		commandTimeoutMs: 1_000,
	});
	let polling = true;
	let extensionError: unknown;
	const extensionLoop = (async () => {
		try {
			await hello(bridge.endpoint);
			while (polling) {
				const response = await callWithoutOrigin(
					bridge.endpoint,
					"/v1/commands/next?extensionInstanceId=extension%3Aone",
				);
				if (response.status === 204) continue;
				const command = (await response.json()) as Record<string, unknown>;
				const value =
					command.type === "LIST_TABS" ? [observation] : observation;
				await call(
					bridge.endpoint,
					"/v1/commands/result?extensionInstanceId=extension%3Aone",
					{
						method: "POST",
						body: JSON.stringify({
							commandId: command.commandId,
							ok: true,
							value,
						}),
					},
				);
			}
		} catch (error) {
			if (polling) extensionError = error;
		}
	})();
	const browserExecutor = createExecutionBrowserExtension({
		browser: bridge.browser,
		task: {
			async getWorkerBinding() {
				return {
					workerRef: "c-real",
					conversationLocator: "https://chatgpt.com/g/g-dev/c/c-real",
				};
			},
			async bindWorker() {},
		},
		agent: {
			async getPendingMessage() {
				throw new Error("COLLABORATION_NOT_EXPECTED");
			},
			async reportPhysicalDelivery() {},
		},
	});
	const localExecutor = {
		async execute() {
			throw new Error("LOCAL_EXECUTOR_NOT_EXPECTED");
		},
		async reconcile() {
			return { state: "UNKNOWN" as const, evidence: [] };
		},
		async readArtifact() {
			throw new Error("ARTIFACT_NOT_EXPECTED");
		},
	};
	const runtime = await createExecutionRuntime({
		databasePath: join(directory, "execution.sqlite"),
		localExecutor,
		browserExecutor,
	});
	try {
		const record = await runtime.executeCapability({
			contract: "execution",
			contractVersion: "1.0.0",
			idempotencyKey: "bridge-observe-1",
			callerRef: "caller:bridge-test",
			roleRef: "g-real",
			workerRef: "c-real",
			capability: "browser.observe",
			input: {
				roleRef: "g-real",
				workerRef: "c-real",
				targetRef: "tab:7",
			},
		});
		assert.equal(record.status, "SUCCEEDED");
		assert.equal(record.sideEffectState, "NOT_APPLIED");
		assert.equal(record.result?.capability, "browser.observe");
		assert.equal(extensionError, undefined);
	} finally {
		polling = false;
		runtime.close();
		await bridge.close();
		await extensionLoop;
		await rm(directory, { recursive: true, force: true });
	}
});
