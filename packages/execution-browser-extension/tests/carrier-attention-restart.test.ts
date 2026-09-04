import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { createCarrierAttentionRegistry } from "../src/carrier-attention.ts";
import { createCarrierPermissionAttemptRegistry } from "../src/carrier-permission-attempt.ts";

const input = {
	tabId: 7,
	contentInstanceId: "content:one",
	url: "https://chatgpt.com/g/g-test/c/worker-test",
	permissionFingerprint: "permission:v1:same",
	taskId: "task-1",
	roleRef: "g-test",
	workerRef: "worker-test",
	targetHost: "gateway.example.test",
	operationId: "getTask",
	reason: "CONTEXT_MISMATCH",
	actions: ["allowOnce", "deny"] as Array<"allowOnce" | "deny">,
	observedAt: "2026-09-04T04:00:00.000Z",
};

test("CP-EXE-BR-31 same tab and fingerprint get a new occurrence after release", () => {
	const ids = ["occurrence-a", "occurrence-b"];
	const registry = createCarrierAttentionRegistry(
		() => ids.shift() ?? "missing",
	);
	const first = registry.derive(input);
	assert.equal(registry.delete(first.attentionRef), true);
	const second = registry.derive(input);
	assert.notEqual(second.attentionRef, first.attentionRef);
	assert.equal(registry.find(first.attentionRef), null);
	assert.equal(
		registry.find(second.attentionRef)?.occurrenceRef,
		"occurrence-b",
	);
});

test("CP-EXE-BR-31 repeated observation of one occurrence retains its action ref", () => {
	const registry = createCarrierAttentionRegistry(() => "occurrence-a");
	const first = registry.derive(input);
	const repeated = registry.derive({ ...input, reason: "STILL_BLOCKED" });
	assert.equal(repeated.attentionRef, first.attentionRef);
	assert.equal(repeated.reason, "STILL_BLOCKED");
});

test("CP-EXE-BR-31 content replacement invalidates the old Attention action", () => {
	const ids = ["occurrence-a", "occurrence-b"];
	const registry = createCarrierAttentionRegistry(
		() => ids.shift() ?? "missing",
	);
	const first = registry.derive(input);
	const second = registry.derive({
		...input,
		contentInstanceId: "content:two",
	});
	assert.notEqual(second.attentionRef, first.attentionRef);
	assert.equal(registry.find(first.attentionRef), null);
	assert.equal(registry.find(second.attentionRef), second);
});

test("CP-EXE-BR-30 restart re-observes live GPT tabs without losing no-replay state", async () => {
	const attempts = createCarrierPermissionAttemptRegistry();
	attempts.begin(7, `${input.url}:${input.permissionFingerprint}`);
	const restored = createCarrierPermissionAttemptRegistry(attempts.snapshot());
	assert.equal(
		restored.has(7, `${input.url}:${input.permissionFingerprint}`),
		true,
	);
	const [background, content] = await Promise.all([
		readFile(new URL("../extension/background.ts", import.meta.url), "utf8"),
		readFile(new URL("../extension/content.ts", import.meta.url), "utf8"),
	]);
	assert.match(background, /rebuildCarrierAttentionsFromTabs/);
	assert.match(background, /https:\/\/chatgpt\.com\/g\/\*/);
	assert.match(content, /PROFLOW_PAGE_SNAPSHOT_REQUEST/);
});
