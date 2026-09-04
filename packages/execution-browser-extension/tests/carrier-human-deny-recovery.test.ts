import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { createCarrierContinuationControl } from "../src/carrier-continuation-control.ts";

const blocked = {
	tabId: 7,
	url: "https://chatgpt.com/g/g-test/c/worker-test",
	contentInstanceId: "content:one",
	pageState: "BLOCKED" as const,
	activityKind: "ACTION_PERMISSION",
	blockerFacts: { fingerprint: "permission:v1:deny" },
};
const idle = {
	...blocked,
	pageState: "IDLE" as const,
	activityKind: null,
};
const denial = {
	attentionRef: "carrier-attention:7:one",
	tabId: 7,
	taskId: "task-1",
	roleRef: "g-test",
	workerRef: "worker-test",
	url: blocked.url,
	contentInstanceId: blocked.contentInstanceId,
	permissionFingerprint: "permission:v1:deny",
};

test("CP-EXE-BR-29 allowOnce leaves BLOCKED to IDLE recovery enabled", () => {
	const control = createCarrierContinuationControl();
	assert.equal(control.suppressRecovery(blocked, idle), false);
});

test("CP-EXE-BR-29 human deny suppresses exactly the next matching continuation recovery", () => {
	const control = createCarrierContinuationControl();
	control.beginDenied(denial);
	assert.equal(control.suppressRecovery(blocked, idle), true);
	assert.equal(control.suppressRecovery(blocked, idle), false);
});

test("CP-EXE-BR-29 deny cannot pollute another Worker or tab", () => {
	const control = createCarrierContinuationControl();
	control.beginDenied(denial);
	assert.equal(
		control.suppressRecovery(blocked, {
			...idle,
			tabId: 8,
			url: "https://chatgpt.com/g/g-dev/c/worker-dev",
		}),
		false,
	);
	assert.equal(control.suppressRecovery(blocked, idle), true);
});

test("CP-EXE-BR-29 failed deny action cancels the pending suppression", () => {
	const control = createCarrierContinuationControl();
	control.beginDenied(denial);
	assert.equal(control.cancelDenied(denial.attentionRef), true);
	assert.equal(control.suppressRecovery(blocked, idle), false);
});

test("CP-EXE-BR-29 pending denial survives MV3 session restoration", () => {
	const first = createCarrierContinuationControl();
	first.beginDenied(denial);
	const restored = createCarrierContinuationControl(first.snapshot());
	assert.equal(restored.suppressRecovery(blocked, idle), true);
	assert.equal(restored.suppressRecovery(blocked, idle), false);
});

test("CP-EXE-BR-29 Background persists deny before action and gates Observer recovery", async () => {
	const source = await readFile(
		new URL("../extension/background.ts", import.meta.url),
		"utf8",
	);
	assert.match(source, /carrierContinuationControl\.beginDenied/);
	assert.match(source, /await persistSnapshot\(\)/);
	assert.match(source, /carrierContinuationControl\.suppressRecovery/);
});
