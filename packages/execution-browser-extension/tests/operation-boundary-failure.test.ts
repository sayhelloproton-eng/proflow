import assert from "node:assert/strict";
import { test } from "node:test";
import { createBrowserSessionLane } from "../extension/runtime/browser-session-lane.ts";
test("command evidence survives lost result ACK without retrying effect", async () => {
	let executed = 0;
	const records: unknown[] = [];
	const lane = createBrowserSessionLane({
		config: async () => ({ endpoint: "http://127.0.0.1", token: "x" }),
		getExtensionInstanceId: () => "ext",
		extensionId: "ext",
		moduleVersion: "1.0.0",
		sleep: async () => {},
		keepalive: async () => {},
		publishCarrierAttentions: async () => {},
		onSessionEstablished() {},
		async executeCommand() {
			executed++;
			return { ok: true };
		},
		onCommandSettled(value) {
			records.push(value);
		},
		async fetchBridge(_config, path) {
			if (path.includes("/result")) throw Error("NETWORK_DOWN");
			return new Response(
				JSON.stringify(
					path.includes("/next") ? { commandId: "cmd:1", type: "WAKE" } : {},
				),
				{ status: 200 },
			);
		},
	});
	await assert.rejects(
		lane.run(() => {}),
		/NETWORK_DOWN/,
	);
	assert.equal(executed, 1);
	assert.equal(records.length, 1);
	assert.equal(Reflect.get(records[0] as object, "reported"), false);
});
