import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { createBrowserRealityBridgeServer } from "../src/bridge.ts";

const extensionId = "a".repeat(32);
const origin = `chrome-extension://${extensionId}`;
const token = "bridge-token-that-is-longer-than-thirty-two-characters";
const attention = {
	attentionRef: "carrier-attention:7:occurrence-a",
	occurrenceRef: "occurrence-a",
	taskId: "task-1",
	roleRef: "g-test",
	workerRef: "worker-test",
	targetHost: "gateway.example.test",
	operationId: "getTask",
	reason: "CONTEXT_MISMATCH",
	actions: ["allowOnce", "deny"],
	observedAt: "2026-09-04T04:00:00.000Z",
};

async function extensionCall(
	endpoint: string,
	path: string,
	init: RequestInit = {},
) {
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

async function taskCookie(endpoint: string): Promise<string> {
	const minted = await extensionCall(endpoint, "/v1/tasks/session", {
		method: "POST",
	});
	const url = String(((await minted.json()) as { url: string }).url);
	const bootstrap = await fetch(url, { redirect: "manual" });
	return bootstrap.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

async function pollCommand(endpoint: string): Promise<Record<string, unknown>> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const response = await fetch(
			`${endpoint}/v1/commands/next?extensionInstanceId=extension%3Aweb-test`,
			{ headers: { authorization: `Bearer ${token}` } },
		);
		if (response.status === 200)
			return (await response.json()) as Record<string, unknown>;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("COMMAND_NOT_DELIVERED");
}

test("CP-EXE-BR-32 primary /tasks reads and acts on bounded Carrier Attention through the authenticated bridge", async () => {
	const bridge = await createBrowserRealityBridgeServer({
		token,
		extensionId,
		commandTimeoutMs: 1_000,
		taskWeb: {
			html: "<title>Tasks</title>",
			script: "",
			async invokeTask() {
				return {};
			},
			async invokeApproval() {
				return {};
			},
		},
	});
	try {
		await extensionCall(bridge.endpoint, "/v1/session/hello", {
			method: "POST",
			body: JSON.stringify({
				extensionId,
				extensionInstanceId: "extension:web-test",
			}),
		});
		await pollCommand(bridge.endpoint).catch(() => undefined);
		const published = await extensionCall(
			bridge.endpoint,
			"/v1/carrier/attentions?extensionInstanceId=extension%3Aweb-test",
			{
				method: "POST",
				body: JSON.stringify({ carrierAttentions: [attention] }),
			},
		);
		assert.equal(published.status, 200);
		const cookie = await taskCookie(bridge.endpoint);
		const status = await fetch(`${bridge.endpoint}/tasks/api/status`, {
			headers: { cookie },
		});
		const statusBody = (await status.json()) as {
			value: { carrierAttentions: unknown };
		};
		assert.deepEqual(statusBody.value.carrierAttentions, [attention]);

		for (const action of ["allowOnce", "deny"] as const) {
			const request = fetch(`${bridge.endpoint}/tasks/api/carrier-attention`, {
				method: "POST",
				headers: {
					cookie,
					origin: bridge.endpoint,
					"content-type": "application/json",
				},
				body: JSON.stringify({ attentionRef: attention.attentionRef, action }),
			});
			const command = await pollCommand(bridge.endpoint);
			assert.equal(command.type, "CARRIER_ATTENTION_ACTION");
			assert.equal(command.attentionRef, attention.attentionRef);
			assert.equal(command.action, action);
			await extensionCall(
				bridge.endpoint,
				`/v1/commands/result?extensionInstanceId=extension%3Aweb-test`,
				{
					method: "POST",
					body: JSON.stringify({
						commandId: command.commandId,
						ok: true,
						value: { status: "APPLIED", action },
					}),
				},
			);
			assert.equal((await request).status, 200);
		}
	} finally {
		await bridge.close();
	}
});

test("CP-EXE-BR-32 /tasks Carrier Attention rejects missing session, wrong origin and stale ref", async () => {
	const bridge = await createBrowserRealityBridgeServer({
		token,
		extensionId,
		taskWeb: {
			html: "<title>Tasks</title>",
			script: "",
			async invokeTask() {
				return {};
			},
			async invokeApproval() {
				return {};
			},
		},
	});
	try {
		const noSession = await fetch(
			`${bridge.endpoint}/tasks/api/carrier-attention`,
			{ method: "POST" },
		);
		assert.equal(noSession.status, 401);
		const cookie = await taskCookie(bridge.endpoint);
		const wrongOrigin = await fetch(
			`${bridge.endpoint}/tasks/api/carrier-attention`,
			{
				method: "POST",
				headers: {
					cookie,
					origin: "http://evil.example",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					attentionRef: attention.attentionRef,
					action: "deny",
				}),
			},
		);
		assert.equal(wrongOrigin.status, 403);
		const stale = await fetch(
			`${bridge.endpoint}/tasks/api/carrier-attention`,
			{
				method: "POST",
				headers: {
					cookie,
					origin: bridge.endpoint,
					"content-type": "application/json",
				},
				body: JSON.stringify({ attentionRef: "stale", action: "deny" }),
			},
		);
		assert.equal(stale.status, 400);
	} finally {
		await bridge.close();
	}
});

test("CP-EXE-BR-32 Extension Tasks fallback retains direct runtime action support", async () => {
	const source = await readFile(
		new URL("../extension/tasks.ts", import.meta.url),
		"utf8",
	);
	assert.match(source, /PROFLOW_CARRIER_ATTENTION_ACTION/);
	assert.match(source, /\/tasks\/api\/carrier-attention/);
});

test("CP-EXE-BR-33 published Tasks web app is a self-contained browser module", async () => {
	// The loopback Tasks surface serves only /tasks/app.js. Any runtime import in
	// the published artifact escapes that authenticated surface and cannot load.
	const built = await readFile(
		new URL("../dist/extension/tasks.js", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(built, /^\s*import\s/m);
});
