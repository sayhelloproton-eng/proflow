import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { createCarrierPermissionAttemptRegistry } from "../src/carrier-permission-attempt.ts";

test("CP-EXE-BR-24 unconfirmed automatic attempts survive transient runtime restart", () => {
	const first = createCarrierPermissionAttemptRegistry();
	first.begin(17, "content-1:permission:v1:one");
	const restored = createCarrierPermissionAttemptRegistry(first.snapshot());
	assert.equal(restored.has(17, "content-1:permission:v1:one"), true);
});

test("CP-EXE-BR-24 confirmed release permits a later identical permission occurrence", () => {
	const attempts = createCarrierPermissionAttemptRegistry();
	attempts.begin(17, "content-1:permission:v1:one");
	assert.equal(attempts.release(17, "content-1:permission:v1:one"), true);
	assert.equal(attempts.has(17, "content-1:permission:v1:one"), false);
	attempts.begin(17, "content-1:permission:v1:one");
	assert.equal(attempts.has(17, "content-1:permission:v1:one"), true);
});

test("CP-EXE-BR-24 a changed observation proves the prior prompt is no longer current", () => {
	const attempts = createCarrierPermissionAttemptRegistry();
	attempts.begin(17, "content-1:permission:v1:one");
	assert.equal(attempts.observe(17, "content-1:permission:v1:two"), true);
	assert.equal(attempts.has(17, "content-1:permission:v1:one"), false);
});

test("CP-EXE-BR-24 invalid session data cannot manufacture an attempted permission", () => {
	const attempts = createCarrierPermissionAttemptRegistry([
		{ tabId: -1, key: "bad" },
		{ tabId: 17, key: "" },
		{ tabId: 18, key: 42 },
	]);
	assert.deepEqual(attempts.snapshot(), []);
	assert.equal(attempts.load({ tabId: 17, key: "forged" }), false);
});

test("CP-EXE-BR-24 Background persists uncertainty before acting and restores it on startup", async () => {
	const source = await readFile(
		new URL("../extension/background.ts", import.meta.url),
		"utf8",
	);
	assert.match(
		source,
		/permissionAutoAttempts: permissionAutoAttempts\.snapshot\(\)/,
	);
	assert.match(source, /restoreTransientPermissionAttempts/);
	assert.match(source, /await restoreTransientPermissionAttempts\(\)/);
	const act = source.slice(
		source.indexOf("async act(action)"),
		source.indexOf("released:", source.indexOf("async act(action)")),
	);
	assert.ok(
		act.indexOf("await persistSnapshot()") <
			act.indexOf("await contentCommand"),
		"uncertain automatic action must be durable before the page click",
	);
});
