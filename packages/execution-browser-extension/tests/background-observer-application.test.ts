import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const backgroundUrl = new URL("../extension/background.ts", import.meta.url);

test("PRESMOKE-B3-OBS-EXT-01 Extension Background owns Observer application lifecycle over authenticated owner transport", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	assert.match(source, /createCollaborationCarrierApplication\(/);
	assert.match(source, /createTaskObserver\(/);
	assert.match(source, /createSystemObserver\(/);
	assert.match(source, /\/application\/observer/);
	assert.match(source, /task\.projection/);
	assert.match(source, /task\.wake/);
	assert.match(source, /task\.diagnostic/);
	assert.match(source, /collaboration\.listPending/);
	assert.match(source, /collaboration\.execute/);
	assert.match(source, /collaboration\.reportDelivery/);
	assert.match(source, /system\.view/);
	assert.match(source, /system\.reason/);
	assert.match(source, /runObserverRecovery/);
	assert.doesNotMatch(
		source,
		/TaskStore|SqliteTaskStore|completeNode|reopenNode\(/,
	);
});

test("PRESMOKE-B3-OBS-EXT-02 System Observer carry-forward survives Extension service-worker restart", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	assert.match(
		source,
		/SYSTEM_OBSERVER_STATE_KEY = "proflowSystemObserverState"/,
	);
	assert.match(
		source,
		/chrome\.storage\.local\.get\(SYSTEM_OBSERVER_STATE_KEY\)/,
	);
	assert.match(source, /chrome\.storage\.local\.set\(/);
	assert.match(
		source,
		/previousUnresolved: previousSystemState\?\.unresolved \?\? \[\]/,
	);
	assert.match(
		source,
		/previousCarryForward: previousSystemState\?\.carryForward \?\? \[\]/,
	);
	assert.match(source, /persistSystemObserverState\(systemAssessment\)/);
});

test("PRESMOKE-B3-OBS-EXT-03 concurrent recovery triggers share one in-flight recovery rather than running duplicate scans", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	assert.match(
		source,
		/let observerRecoveryInFlight: Promise<void> \| null = null/,
	);
	assert.match(
		source,
		/if \(observerRecoveryInFlight\) return observerRecoveryInFlight/,
	);
	assert.match(source, /observerRecoveryInFlight = null/);
});

test("PRESMOKE-B4-OBS-EXT-04 human Approval decision resumes the bound Worker through Task Observer rather than UI-owned state", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	assert.match(source, /message\.operation === "approval\.allow"/);
	assert.match(source, /message\.operation === "approval\.deny"/);
	assert.match(source, /message\.operation === "approval\.revoke"/);
	assert.match(source, /trigger: "RECOVERY_RESUME"/);
	assert.match(source, /ref: value\.approvalRef/);
	assert.match(source, /targetWorkerRef: value\.workerRef/);
	assert.doesNotMatch(source, /approvalState\s*=|approved\s*=\s*true/);
});

test("PRESMOKE-B4-OBS-EXT-05 durable Execution recovery signals are acknowledged only after an actionable/terminal Observer decision", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	assert.match(source, /execution\.listSignals/);
	assert.match(source, /execution\.ackSignal/);
	assert.match(source, /decision\.reason === "BINDING_NOT_READY"/);
	assert.match(
		source,
		/decision\.reason === "RESUME_TARGET_NOT_CURRENT_WORKER"/,
	);
	assert.match(source, /decision\.reason === "DIAGNOSTIC_UNAVAILABLE"/);
	assert.match(source, /continue;[\s\S]*execution\.ackSignal/);
});
