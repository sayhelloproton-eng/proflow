import assert from "node:assert/strict";
import { test } from "node:test";

import { createHostOperationObserver } from "../src/operation-observability.ts";

test("Host boundary only logs side-effect state when the invoked owner supplied it", async () => {
	const entries: Array<Record<string, unknown>> = [];
	const observer = createHostOperationObserver((entry) => entries.push(entry));

	await observer.run("task", "getTask", async () => ({ ok: true }));
	await assert.rejects(
		observer.run("execution", "submit", async () => {
			throw Object.assign(new Error("OWNER_DOWN"), { code: "OWNER_DOWN" });
		}),
	);
	await observer.run("execution", "prepare", async () => ({
		ok: true,
		sideEffectState: "NOT_APPLIED",
	}));
	await observer.run("execution", "start", async () => ({
		ok: true,
		sideEffectState: "STARTED",
	}));

	assert.equal("sideEffectState" in (entries[0] ?? {}), false);
	assert.equal("sideEffectState" in (entries[1] ?? {}), false);
	assert.equal(entries[2]?.sideEffectState, "NOT_APPLIED");
	assert.equal(entries[3]?.sideEffectState, "STARTED");
});
