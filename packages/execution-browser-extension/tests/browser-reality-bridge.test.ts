import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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

async function hello(endpoint: string, instance = "extension:one") {
	const response = await call(endpoint, "/v1/session/hello", {
		method: "POST",
		body: JSON.stringify({ extensionId, extensionInstanceId: instance }),
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
		await hello(bridge.endpoint);
		assert.equal(bridge.status().online, true);

		const requested = bridge.browser.observe(7);
		const polled = await call(
			bridge.endpoint,
			"/v1/commands/next?extensionInstanceId=extension%3Aone",
		);
		assert.equal(polled.status, 200);
		const command = (await polled.json()) as Record<string, unknown>;
		assert.equal(command.type, "OBSERVE");
		assert.equal(command.tabId, 7);
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
		assert.deepEqual(await requested, observation);

		const stale = await call(
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
		const requested = bridge.browser.submit(
			7,
			"message fingerprint:1",
			"fingerprint:1",
		);
		const polled = await call(
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
		const empty = await call(
			bridge.endpoint,
			"/v1/commands/next?extensionInstanceId=extension%3Aone",
		);
		assert.equal(empty.status, 204);
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
				const response = await call(
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
				return "c-real";
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
