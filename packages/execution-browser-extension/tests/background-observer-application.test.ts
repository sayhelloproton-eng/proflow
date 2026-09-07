import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createObserverRecoveryRearm } from "../src/observer-recovery-rearm.ts";

const backgroundUrl = new URL("../extension/background.ts", import.meta.url);

test("REAL3-BRIDGE-REARM-01 bridge recovery waits for startup denial restoration, then rearms after late availability", () => {
	let recoveryArms = 0;
	const rearm = createObserverRecoveryRearm(() => {
		recoveryArms += 1;
	});

	assert.equal(rearm.bridgeSessionEstablished(1), false);
	assert.equal(recoveryArms, 0);
	rearm.startupReady();
	assert.equal(recoveryArms, 1);

	// The initial bounded recovery may exhaust while Platform is unavailable.
	assert.equal(rearm.bridgeSessionEstablished(2), true);
	assert.equal(recoveryArms, 2);
});

test("REAL3-BRIDGE-REARM-02 one healthy bridge session cannot repeatedly rearm Observer recovery", () => {
	let recoveryArms = 0;
	const rearm = createObserverRecoveryRearm(() => {
		recoveryArms += 1;
	});
	rearm.startupReady();

	assert.equal(rearm.bridgeSessionEstablished(1), true);
	assert.equal(rearm.bridgeSessionEstablished(1), false);
	assert.equal(rearm.bridgeSessionEstablished(1), false);
	assert.equal(recoveryArms, 2);
});

test("REAL3-BRIDGE-REARM-03 disconnect and later bridge reconnect rearms exactly once for the new epoch", () => {
	let recoveryArms = 0;
	const rearm = createObserverRecoveryRearm(() => {
		recoveryArms += 1;
	});
	rearm.startupReady();
	rearm.bridgeSessionEstablished(1);

	assert.equal(rearm.bridgeSessionEstablished(2), true);
	assert.equal(rearm.bridgeSessionEstablished(2), false);
	assert.equal(recoveryArms, 3);
});

test("REAL3-BRIDGE-REARM-04 production hello establishes one recovery epoch before the healthy poll loop", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	const bridgeLoop = source.slice(
		source.indexOf("async function runBridgeLoop()"),
		source.indexOf("let provisioningBridgeLoopStarted"),
	);
	const helloAccepted = bridgeLoop.indexOf(
		'if (!hello.ok) throw new Error("BRIDGE_HELLO_REJECTED")',
	);
	const establishEpoch = bridgeLoop.indexOf(
		"observerRecoveryRearm.bridgeSessionEstablished(bridgeSessionEpoch)",
	);
	const healthyPollLoop = bridgeLoop.indexOf("while (true)", helloAccepted);
	assert.ok(helloAccepted >= 0);
	assert.ok(establishEpoch > helloAccepted);
	assert.ok(healthyPollLoop > establishEpoch);
	assert.equal(
		bridgeLoop.slice(healthyPollLoop).includes("bridgeSessionEstablished"),
		false,
	);
});

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
		/if \(observerRecoveryInFlight\) \{[\s\S]{0,240}"REUSED_IN_FLIGHT"[\s\S]{0,240}return observerRecoveryInFlight;/,
	);
	assert.match(source, /observerRecoveryInFlight = null/);
});

test("REAL3-RECOVERY-TRAILING-01 in-flight recovery coalesces all new demand into one trailing pass after settle", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	const recovery = source.slice(
		source.indexOf("function runObserverRecovery()"),
		source.indexOf("const observerRecoveryRearm"),
	);
	assert.match(source, /let observerRecoveryTrailingRequested = false/);
	const reuseStart = recovery.indexOf("if (observerRecoveryInFlight)");
	const trailingRequest = recovery.indexOf(
		"observerRecoveryTrailingRequested = true",
		reuseStart,
	);
	const reuseReturn = recovery.indexOf("return observerRecoveryInFlight", reuseStart);
	assert.ok(reuseStart >= 0 && trailingRequest > reuseStart && reuseReturn > trailingRequest);
	const finallyStart = recovery.indexOf("})().finally(() => {");
	const clearInFlight = recovery.indexOf("observerRecoveryInFlight = null", finallyStart);
	const trailingCheck = recovery.indexOf(
		"if (!observerRecoveryTrailingRequested) return",
		finallyStart,
	);
	const consumeTrailing = recovery.indexOf(
		"observerRecoveryTrailingRequested = false",
		finallyStart,
	);
	const trailingRun = recovery.indexOf("void runObserverRecovery()", finallyStart);
	assert.ok(
		finallyStart >= 0 &&
			clearInFlight > finallyStart &&
			trailingCheck > clearInFlight &&
			consumeTrailing > trailingCheck &&
			trailingRun > consumeTrailing,
	);
});

test("REAL3-RECOVERY-TRAILING-02 suppression state is consumed only when a real recovery pass starts", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	const recovery = source.slice(
		source.indexOf("function runObserverRecovery()"),
		source.indexOf("const observerRecoveryRearm"),
	);
	const reuseReturn = recovery.indexOf("return observerRecoveryInFlight");
	const suppressionRead = recovery.indexOf(
		"const suppressedContinuations = nextRecoverySuppressions",
	);
	const suppressionClear = recovery.indexOf("nextRecoverySuppressions = []");
	const promiseStart = recovery.indexOf("observerRecoveryInFlight = (async () => {");
	assert.ok(
		reuseReturn >= 0 &&
			suppressionRead > reuseReturn &&
			suppressionClear > suppressionRead &&
			promiseStart > suppressionClear,
	);
});

test("REAL3-RECOVERY-TRAILING-03 bounded retry timer is stale once a newer recovery attempt has started", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	const recovery = source.slice(
		source.indexOf("function runObserverRecovery()"),
		source.indexOf("const observerRecoveryRearm"),
	);
	assert.match(recovery, /const retryScheduledFromAttemptNo = recoveryAttemptNo/);
	assert.match(
		recovery,
		/setTimeout\(\(\) => \{\s*if \(observerRecoveryAttemptNo !== retryScheduledFromAttemptNo\) return;\s*void runObserverRecovery\(\);\s*\}, 2_000\)/,
	);
});

test("REAL3-RECOVERY-TRAILING-04 every recovery trigger enters the same central coordinator", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	assert.match(source, /createObserverRecoveryRearm\(\(\) => \{[\s\S]{0,240}void runObserverRecovery\(\)/);
	assert.match(source, /if \(shouldRecover && !suppressed\) void runObserverRecovery\(\)/);
	assert.match(source, /command\.type === "TASK_OBSERVER_RECOVER"[\s\S]{0,160}void runObserverRecovery\(\)/);
	assert.match(source, /message\.operation === "task\.resume"[\s\S]{0,240}void runObserverRecovery\(\)/);
	assert.match(source, /observerRecoveryRearm\.startupReady\(\)/);
});

test("REAL3-RECOVERY-DIAGNOSTIC-01 diagnostic seam distinguishes bridge rearm, single-flight reuse and the first collaboration await without changing control flow", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	const diagnostic = source.slice(
		source.indexOf("function emitObserverRecoveryDiagnostic"),
		source.indexOf("async function invokeObserverApplication"),
	);
	assert.match(diagnostic, /void emitStructuredLog\(/);
	assert.doesNotMatch(diagnostic, /await |AbortSignal|setTimeout/);

	const bridgeLoop = source.slice(
		source.indexOf("async function runBridgeLoop()"),
		source.indexOf("let provisioningBridgeLoopStarted"),
	);
	const bridgeEpochAccepted = bridgeLoop.indexOf('"BRIDGE_EPOCH_ACCEPTED"');
	const establishEpoch = bridgeLoop.indexOf(
		"observerRecoveryRearm.bridgeSessionEstablished(bridgeSessionEpoch)",
	);
	assert.ok(bridgeEpochAccepted >= 0 && establishEpoch > bridgeEpochAccepted);

	const rearm = source.slice(
		source.indexOf("const observerRecoveryRearm"),
		source.indexOf("function observationFor"),
	);
	assert.ok(
		rearm.indexOf('"REARM_CALLBACK_ENTERED"') >= 0 &&
			rearm.indexOf('"REARM_CALLBACK_ENTERED"') <
				rearm.indexOf("void runObserverRecovery()"),
	);

	const listPendingPort = source.slice(
		source.indexOf("async listPendingMessages(limit)"),
		source.indexOf("async getPendingMessage(messageRef)"),
	);
	const listPendingBegin = listPendingPort.indexOf(
		'"COLLABORATION_LIST_PENDING_BEGIN"',
	);
	const listPendingAwait = listPendingPort.indexOf(
		'await invokeObserverApplication("collaboration.listPending"',
	);
	const listPendingSettled = listPendingPort.indexOf(
		'"COLLABORATION_LIST_PENDING_SETTLED"',
	);
	assert.ok(
		listPendingBegin >= 0 &&
			listPendingAwait > listPendingBegin &&
			listPendingSettled > listPendingAwait,
	);
	assert.match(listPendingPort, /finally \{/);

	const recovery = source.slice(
		source.indexOf("function runObserverRecovery()"),
		source.indexOf("const observerRecoveryRearm"),
	);
	const reused = recovery.indexOf('"REUSED_IN_FLIGHT"');
	const reuseReturn = recovery.indexOf("return observerRecoveryInFlight", reused);
	const started = recovery.indexOf('"STARTED"');
	const promiseStart = recovery.indexOf("observerRecoveryInFlight = (async () => {");
	const collaborationBegin = recovery.indexOf('"COLLABORATION_RECOVERY_BEGIN"');
	const recoverPending = recovery.indexOf("await collaborationCarrier.recoverPending(50)");
	const collaborationSettled = recovery.indexOf('"COLLABORATION_RECOVERY_SETTLED"');
	const listSignals = recovery.indexOf('"execution.listSignals"');
	assert.ok(reused >= 0 && reuseReturn > reused);
	assert.ok(started >= 0 && promiseStart > started);
	assert.ok(collaborationBegin > promiseStart && recoverPending > collaborationBegin);
	assert.ok(collaborationSettled > recoverPending && listSignals > collaborationSettled);
	assert.doesNotMatch(recovery, /await emitObserverRecoveryDiagnostic/);
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

test("B1-OBS-STARTUP-BOUNDARY tab snapshot reconstruction cannot indefinitely block Observer recovery", async () => {
	const source = await readFile(backgroundUrl, "utf8");
	assert.match(source, /BROWSER_RECOVERY_SNAPSHOT_TIMEOUT_MS = 1_000/);
	assert.match(source, /boundedRecoveryObservation\(/);
	assert.match(source, /const snapshots = await Promise\.all\(/);
	const startup = source.slice(
		source.indexOf("async function startBackgroundRuntime()"),
		source.indexOf("chrome.action.onClicked.addListener"),
	);
	assert.ok(
		startup.indexOf("await rebuildCarrierAttentionsFromTabs()") <
			startup.indexOf("observerRecoveryRearm.startupReady()"),
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
		/chrome\.runtime\.onStartup[\s\S]*observerRecoveryRearm\.startupReady\(\)/,
	);
	assert.match(
		source,
		/chrome\.runtime\.onInstalled[\s\S]*observerRecoveryRearm\.startupReady\(\)/,
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
	assert.match(recovery, /const retryScheduledFromAttemptNo = recoveryAttemptNo/);
	assert.match(
		recovery,
		/if \(observerRecoveryAttemptNo !== retryScheduledFromAttemptNo\) return;/,
	);
	assert.match(recovery, /void runObserverRecovery\(\)/);
	assert.match(recovery, /same stable Execution identities/);
	assert.doesNotMatch(recovery, /executeCapability\(/);
});
