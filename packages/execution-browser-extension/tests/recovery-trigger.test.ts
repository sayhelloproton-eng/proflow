import assert from "node:assert/strict";
import { test } from "node:test";

import {
	boundedRecoveryObservation,
	shouldTriggerObserverRecovery,
} from "../src/recovery-trigger.ts";

const observation = (overrides: Record<string, unknown> = {}) => ({
	url: "https://chatgpt.com/g/role/c/worker",
	contentInstanceId: "content:1",
	pageState: "IDLE" as const,
	activityKind: null,
	...overrides,
});

test("REAL3 recovery starts only on a semantic transition into a new IDLE state", () => {
	const idle = observation();
	assert.equal(shouldTriggerObserverRecovery(undefined, idle), true);
	assert.equal(shouldTriggerObserverRecovery(idle, observation()), false);
	assert.equal(
		shouldTriggerObserverRecovery(
			observation({ pageState: "BUSY", activityKind: "GENERATING" }),
			idle,
		),
		true,
	);
	assert.equal(
		shouldTriggerObserverRecovery(
			idle,
			observation({ pageState: "BUSY", activityKind: "GENERATING" }),
		),
		false,
	);
	assert.equal(
		shouldTriggerObserverRecovery(
			idle,
			observation({ url: "https://chatgpt.com/g/role/c/other-worker" }),
		),
		true,
	);
	assert.equal(
		shouldTriggerObserverRecovery(
			idle,
			observation({ contentInstanceId: "content:2" }),
		),
		true,
	);
});

test("CP-EXE-BR-25 Action Permission stays BLOCKED and only its real transition to IDLE resumes recovery", () => {
	const blocked = observation({
		pageState: "BLOCKED",
		activityKind: "ACTION_PERMISSION",
	});
	assert.equal(shouldTriggerObserverRecovery(undefined, blocked), false);
	assert.equal(shouldTriggerObserverRecovery(observation(), blocked), false);
	assert.equal(shouldTriggerObserverRecovery(blocked, observation()), true);
});

test("B1-RECOVERY-BOUNDARY hung startup snapshot is bounded and treated as unknown", async () => {
	const startedAt = Date.now();
	const result = await boundedRecoveryObservation(
		() => new Promise<string>(() => undefined),
		20,
	);
	assert.equal(result, null);
	assert.ok(Date.now() - startedAt < 500);
});

test("B1-RECOVERY-BOUNDARY rejected startup snapshot is bounded without fabricated state", async () => {
	const result = await boundedRecoveryObservation(async () => {
		throw new Error("no receiver");
	}, 20);
	assert.equal(result, null);
});
