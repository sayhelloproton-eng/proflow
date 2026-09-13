import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import type { ContentObservation } from "../extension/runtime/chrome-runtime.ts";
import type { ExtensionOperationEventInput } from "../extension/runtime/extension-logger.ts";
import { createPermissionActionLoggingPage } from "../extension/runtime/permission-action-page.ts";

const observed: ContentObservation = {
	tabId: 7,
	windowId: 1,
	url: "https://chatgpt.com/g/g-test/c/worker-test",
	contentInstanceId: "content:test",
	pageState: "BLOCKED",
	activityKind: "ACTION_PERMISSION",
	observedAt: "2026-09-13T02:00:00.000Z",
};

test("CP-EXE-BR-48 successful permission action emits the durable dispatch event", async () => {
	const events: ExtensionOperationEventInput[] = [];
	const times = [100, 125];
	const page = createPermissionActionLoggingPage({
		page: {
			current: () => observed,
			sessions: () => [observed],
			waitForPermissionReleased: async () => true,
			contentCommand: async () => ({ clicked: true }),
		},
		logger: {
			async emit(input) {
				events.push(input);
			},
		},
		now: () => times.shift() ?? 125,
	});

	assert.deepEqual(
		await page.contentCommand(7, {
			operation: "permissionAction",
			permissionFingerprint: "permission:v1:test",
			permissionAction: "allow",
		}),
		{ clicked: true },
	);
	assert.equal(events.length, 1);
	assert.deepEqual(events[0], {
		component: "permission-action-boundary",
		event: "PERMISSION_ACTION",
		phase: "DISPATCHED",
		status: "SUCCEEDED",
		operationId: "permissionAction",
		operationRef: "permission:v1:test",
		correlationId: "permission:permission:v1:test",
		correlationKind: "IDENTITY_MATCH",
		action: "allow",
		sideEffectState: "STARTED",
		tabId: 7,
		contentInstanceId: "content:test",
		conversationLocator: "https://chatgpt.com/g/g-test/c/worker-test",
		durationMs: 25,
	});
});

test("CP-EXE-BR-48 failed permission action emits UNKNOWN before propagating failure", async () => {
	const events: ExtensionOperationEventInput[] = [];
	const times = [200, 205];
	const page = createPermissionActionLoggingPage({
		page: {
			current: () => observed,
			sessions: () => [observed],
			waitForPermissionReleased: async () => true,
			contentCommand: async () => {
				throw new Error("CONTENT_ACTION_FAILED");
			},
		},
		logger: {
			async emit(input) {
				events.push(input);
			},
		},
		now: () => times.shift() ?? 205,
	});

	await assert.rejects(
		page.contentCommand(7, {
			operation: "permissionAction",
			permissionFingerprint: "permission:v1:test",
			permissionAction: "allow",
		}),
		/CONTENT_ACTION_FAILED/,
	);
	assert.equal(events.length, 1);
	assert.equal(events[0]?.status, "FAILED");
	assert.equal(events[0]?.errorCode, "PERMISSION_ACTION_FAILED");
	assert.equal(events[0]?.sideEffectState, "UNKNOWN");
	assert.equal(events[0]?.action, "allow");
	assert.equal(events[0]?.durationMs, 5);
});

test("CP-EXE-BR-48 non-permission page commands bypass permission-action logging", async () => {
	const events: ExtensionOperationEventInput[] = [];
	let forwarded = 0;
	const page = createPermissionActionLoggingPage({
		page: {
			current: () => observed,
			sessions: () => [observed],
			waitForPermissionReleased: async () => true,
			contentCommand: async () => {
				forwarded += 1;
				return { observed: true };
			},
		},
		logger: {
			async emit(input) {
				events.push(input);
			},
		},
	});
	assert.deepEqual(await page.contentCommand(7, { operation: "observe" }), {
		observed: true,
	});
	assert.equal(forwarded, 1);
	assert.deepEqual(events, []);
});

test("CP-EXE-BR-48 production background uses the behavior-tested logging page", async () => {
	const background = await readFile(
		new URL("../extension/background.ts", import.meta.url),
		"utf8",
	);
	assert.match(background, /createPermissionActionLoggingPage/);
	assert.match(background, /logger:\s*operationLogger/);
	assert.doesNotMatch(background, /event:\s*"PERMISSION_ACTION"/);
});
