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

test("REAL3 Browser Carrier bounds loopback fetches and requires a real poll before readiness", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	assert.match(source, /BROWSER_BRIDGE_FETCH_TIMEOUT_MS = 5_000/);
	assert.match(
		source,
		/AbortSignal\.timeout\(BROWSER_BRIDGE_FETCH_TIMEOUT_MS\)/,
	);
	assert.match(source, /const config = await bridgeConfig\(\)\.catch\(\(\) => null\)/);
	assert.match(source, /let lastHeartbeatAt = Date\.now\(\)/);
	assert.match(source, /let lastExtensionKeepaliveAt = Date\.now\(\)/);
	assert.match(source, /\/v1\/commands\/next/);
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

test("REAL3 Tasks web mutation recovery command re-enters the existing Task Observer", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	assert.match(source, /command\.type === "TASK_OBSERVER_RECOVER"/);
	assert.match(
		source,
		/command\.type === "TASK_OBSERVER_RECOVER"[\s\S]{0,160}void runObserverRecovery\(\)/,
	);
});

test("PRESMOKE-B4-OBS-EXT-04 human Approval decision resumes the bound Worker through Task Observer rather than UI-owned state", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	assert.match(source, /message\.operation === "approval\.allow"/);
	assert.match(source, /message\.operation === "approval\.deny"/);
	assert.match(source, /message\.operation === "approval\.revoke"/);
	assert.match(source, /approval\.executionContext/);
	assert.match(source, /resumeAfterApprovalDecision\(value\.approvalRef\)/);
	assert.match(source, /trigger: "RECOVERY_RESUME"/);
	assert.match(source, /ref: approvalRef/);
	assert.match(source, /targetWorkerRef: context\.workerRef/);
	assert.match(source, /nodeId: context\.nodeId/);
	assert.match(source, /runNo: Number\(context\.runNo\)/);
	assert.doesNotMatch(source, /targetWorkerRef: value\.workerRef/);
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

test("RF-B4-OBS-EXT-GENERATION malformed durable RECOVERY_RESUME is terminally disposed without TaskObserver dispatch", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	const recovery = source.slice(
		source.indexOf("function runObserverRecovery()"),
		source.indexOf("function observationFor", source.indexOf("function runObserverRecovery()")),
	);
	const malformedStart = recovery.indexOf('typeof candidate.nodeId !== "string"');
	const dispatchStart = recovery.indexOf(
		"decision = await taskObserver.drive",
		malformedStart,
	);
	assert.ok(malformedStart >= 0 && dispatchStart > malformedStart);
	const malformedBranch = recovery.slice(malformedStart, dispatchStart);
	assert.match(malformedBranch, /execution\.ackSignal/);
	assert.match(malformedBranch, /signalRef: candidate\.signalRef/);
	assert.match(malformedBranch, /continue;/);
});

test("RF-BR-OBSERVE-WIRE-01 Background enriches OBSERVE with Chrome-owned tab/window identity", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	const executeStart = source.indexOf("async function executeCommand");
	const observeStart = source.indexOf('if (command.type === "OBSERVE")', executeStart);
	const submitStart = source.indexOf('if (command.type === "SUBMIT")', observeStart);
	assert.ok(executeStart >= 0 && observeStart > executeStart && submitStart > observeStart);
	const observeBranch = source.slice(observeStart, submitStart);
	assert.match(observeBranch, /const value = await contentCommand\(tabId, \{ operation: "observe" \}\)/);
	assert.match(observeBranch, /const tab = await chrome\.tabs\.get\(tabId\)/);
	assert.match(observeBranch, /const observed = parseSnapshotObservation\(value, tab\)/);
	assert.match(observeBranch, /if \(!observed\) throw new Error\("CONTENT_OBSERVATION_INVALID"\)/);
	assert.match(observeBranch, /return observed/);
	assert.doesNotMatch(observeBranch, /return contentCommand\(tabId, \{ operation: "observe" \}\)/);
});

test("PRESMOKE-B6-C1 Browser Carrier and Observers emit bounded structured logs through authenticated local ingestion", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	assert.match(source, /\/application\/log/);
	assert.match(source, /component: "browser-carrier"/);
	assert.match(source, /browser-collaboration-carrier/);
	assert.match(source, /browser-observer/);
	assert.match(source, /operationRef: command\.commandId/);
	assert.match(source, /structuredAxes\(command\.request\)/);
	assert.match(source, /sanitizeConversationLocator/);
	assert.match(source, /locator\.username = ""/);
	assert.match(source, /locator\.password = ""/);
	assert.match(source, /locator\.search = ""/);
	assert.match(source, /locator\.hash = ""/);
	assert.match(source, /normalizeLogErrorCode/);
	assert.match(source, /\^\[A-Z\]\[A-Z0-9_\.:-\]/);
	assert.doesNotMatch(source, /error\.message\.slice\(0, 160\)/);
	assert.doesNotMatch(source, /result\.error\.slice\(0, 160\)/);
	assert.doesNotMatch(
		source,
		/emitStructuredLog\([^)]*(?:authorization|token|cookie|password)/is,
	);
});

test("PRESMOKE-B6-OBS-EXT-06 Task page snapshot carries a bounded read-only System Observer summary", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	assert.match(source, /loadSystemObserverState\(\)\.catch/);
	assert.match(source, /systemObserver:/);
	assert.match(source, /assessmentRef: observerState\.assessmentRef/);
	assert.match(source, /needsHumanAttention:/);
	assert.match(source, /unresolved: observerState\.unresolved/);
	const taskPage = await readFile(
		new URL("../extension/tasks.ts", import.meta.url),
		"utf8",
	);
	const taskPageHtml = await readFile(
		new URL("../extension/tasks.html", import.meta.url),
		"utf8",
	);
	assert.match(taskPage, /#system-assessment/);
	assert.match(taskPage, /needsHumanAttention/);
	assert.match(taskPageHtml, /System Assessment/);
	assert.match(taskPageHtml, /never mutates Task\/Approval owner facts/);
	assert.doesNotMatch(
		taskPage,
		/systemAssessmentTarget\.[\s\S]{0,120}(?:complete|approve|reopen)/,
	);
});

test("P1-18 bounded startup/event recovery replenishes missing Task Workers before Task progression", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	const recovery = source.slice(
		source.indexOf("function runObserverRecovery()"),
		source.indexOf(
			"function observationFor",
			source.indexOf("function runObserverRecovery()"),
		),
	);
	assert.match(recovery, /task\.list/);
	assert.match(recovery, /invokeTaskApplication\("task\.list", \{\}\)\.catch/);
	assert.match(source, /observerRecoveryRetryCount/);
	assert.match(recovery, /task\.ensureWorkers/);
	assert.match(recovery, /taskObserver\.drive/);
	assert.ok(
		recovery.indexOf('invokeTaskApplication("task.ensureWorkers"') <
			recovery.indexOf("taskObserver.drive(candidate.taskId)"),
		"worker recovery must reconcile durable bindings before Task progression",
	);
	assert.match(
		source,
		/chrome\.runtime\.onStartup[\s\S]*runObserverRecovery\(\)/,
	);
	assert.match(
		source,
		/chrome\.runtime\.onInstalled[\s\S]*runObserverRecovery\(\)/,
	);
});

test("CP-EXE-BR-09 bounded recovery retries rejected wake delivery without bypassing Execution idempotency", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	const recovery = source.slice(
		source.indexOf("function runObserverRecovery()"),
		source.indexOf(
			"function observationFor",
			source.indexOf("function runObserverRecovery()"),
		),
	);
	assert.match(recovery, /let recoveryNeedsRetry = false/);
	assert.match(
		recovery,
		/taskObserver\.drive\(candidate\.taskId\)\.catch\(\(\) => \{\s*recoveryNeedsRetry = true/,
	);
	assert.match(
		recovery,
		/if \(recoveryNeedsRetry && observerRecoveryRetryCount < 6\)/,
	);
	assert.match(recovery, /setTimeout\(\(\) => void runObserverRecovery\(\), 2_000\)/);
	assert.match(recovery, /same stable Execution identities/);
	assert.doesNotMatch(recovery, /executeCapability\(/);
});
