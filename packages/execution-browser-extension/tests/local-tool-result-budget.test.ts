import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import {
	createLocalToolBridgeHostClient,
	createLocalToolBridgeServer,
	LocalToolBridgeError,
} from "../src/local-tool-bridge.ts";

test("Real3 F11 bridge bounds final JSON and preserves UNKNOWN for effect results", async () => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), "proflow-result-budget-"));
	const hostToken = "h".repeat(64);
	const extensionToken = "e".repeat(64);
	const extensionId = "a".repeat(32);
	let result: unknown;
	let executions = 0;
	const bridge = await createLocalToolBridgeServer({
		workspaceRoot,
		hostToken,
		extensionToken,
		extensionId,
		generation: "result-budget-generation",
		execute: async () => {
			executions += 1;
			return result;
		},
	});
	try {
		const headers = {
			authorization: `Bearer ${extensionToken}`,
			origin: `chrome-extension://${extensionId}`,
			"content-type": "application/json",
		};
		const hello = await fetch(
			`${bridge.endpoint}/v1/local-tools/session/hello`,
			{
				method: "POST",
				headers,
				body: JSON.stringify({
					extensionId,
					extensionInstanceId: "budget",
					moduleVersion: "0.1.50",
				}),
			},
		);
		assert.equal(hello.status, 200);
		await hello.json();
		const pollHeaders = {
			authorization: `Bearer ${extensionToken}`,
			"content-type": "application/json",
		};
		const poll = () =>
			fetch(
				`${bridge.endpoint}/v1/local-tools/commands/next?extensionInstanceId=budget`,
				{ headers: pollHeaders },
			);
		assert.equal((await poll()).status, 204);
		const client = createLocalToolBridgeHostClient({
			endpoint: bridge.endpoint,
			token: hostToken,
		});
		const invoke = async (value: unknown, operation = "read") => {
			result = value;
			const response = client
				.request({
					authenticatedRoleRef: "g-dev",
					workspaceRoot,
					tool: "localDev",
					operation,
					input: {},
					deadlineAt: new Date(Date.now() + 10_000).toISOString(),
				})
				.then(
					(value) => ({ ok: true as const, value }),
					(error: unknown) => ({ ok: false as const, error }),
				);
			let claimed = false;
			for (let attempt = 0; attempt < 100; attempt += 1) {
				const next = await poll();
				if (next.status === 200) {
					const command: unknown = await next.json();
					const accepted = await fetch(
						`${bridge.endpoint}/v1/local-tools/commands/execute?extensionInstanceId=budget`,
						{
							method: "POST",
							headers,
							body: JSON.stringify(command),
						},
					);
					assert.equal(accepted.status, 202);
					await accepted.json();
					claimed = true;
					break;
				}
				assert.equal(next.status, 204);
				await delay(10);
			}
			assert.equal(claimed, true);
			return response;
		};
		assert.deepEqual(await invoke({ small: "ok" }), {
			ok: true,
			value: { small: "ok" },
		});
		assert.deepEqual(await invoke(null), { ok: true, value: null });
		const boundary = await invoke("x".repeat(89_998));
		assert.equal(boundary.ok, true);
		if (boundary.ok)
			assert.equal(JSON.stringify(boundary.value).length, 90_000);
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		for (const value of ["x".repeat(89_999), undefined, circular]) {
			const rejected = await invoke(value);
			assert.equal(rejected.ok, false);
			if (!rejected.ok) {
				assert.ok(rejected.error instanceof LocalToolBridgeError);
				assert.equal(rejected.error.code, "LOCAL_TOOL_COMMAND_FAILED");
			}
		}
		const effect = await invoke("x".repeat(100_000), "run");
		assert.equal(effect.ok, false);
		if (!effect.ok) {
			assert.ok(effect.error instanceof LocalToolBridgeError);
			assert.equal(effect.error.code, "LOCAL_TOOL_RESULT_UNKNOWN");
		}
		let serializations = 0;
		assert.deepEqual(
			await invoke({
				toJSON() {
					serializations += 1;
					return serializations === 1 ? { safe: true } : "x".repeat(200_000);
				},
			}),
			{ ok: true, value: { safe: true } },
		);
		assert.equal(serializations, 1);
		assert.equal(
			executions,
			8,
			"budget rejection must not replay the provider",
		);
	} finally {
		await bridge.close();
		await rm(workspaceRoot, { recursive: true, force: true });
	}
});
