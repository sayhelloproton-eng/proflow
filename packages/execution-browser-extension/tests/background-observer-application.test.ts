import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const backgroundUrl = new URL("../extension/background.ts", import.meta.url);
const browserExecutorUrl = new URL("../src/index.ts", import.meta.url);

async function backgroundSource() {
	return readFile(backgroundUrl, "utf8");
}

test("PRESMOKE-B3-OBS-EXT-01 Extension owns Collaboration/System recovery but no Task progression lifecycle", async () => {
	const source = await backgroundSource();
	assert.match(source, /createCollaborationCarrierApplication\(/);
	assert.match(source, /createSystemObserver\(/);
	assert.match(source, /runObserverRecovery/);
	assert.doesNotMatch(
		source,
		/createTaskObserver|taskObserver\.drive|resumeTaskWorker|resumeAfterApprovalDecision/,
	);
	assert.doesNotMatch(source, /task\.projection|task\.diagnostic|task\.wake/);
});

test("PRESMOKE-B3-OBS-EXT-02 Browser recovery only accelerates backend reconciliation after Collaboration recovery", async () => {
	const source = await backgroundSource();
	const start = source.indexOf("function runObserverRecovery()");
	const end = source.indexOf("const observerRecoveryRearm", start);
	const recovery = source.slice(start, end);
	assert.ok(start >= 0 && end > start);
	const collaboration = recovery.indexOf(
		"await collaborationCarrier.recoverPending(50)",
	);
	const kick = recovery.indexOf(
		'invokeObserverApplication("task.reconcileAll"',
	);
	const system = recovery.indexOf("systemObserver");
	assert.ok(collaboration >= 0 && kick > collaboration && system > kick);
	assert.doesNotMatch(
		recovery,
		/execution\.listSignals|task\.ensureWorkers|taskObserver|task\.list/,
	);
});

test("PRESMOKE-B3-OBS-EXT-03 Extension recovery stays single-flight with one trailing pass", async () => {
	const source = await backgroundSource();
	assert.match(source, /observerRecoveryInFlight/);
	assert.match(source, /observerRecoveryTrailingRequested = true/);
	assert.match(source, /if \(!observerRecoveryTrailingRequested\) return/);
	assert.match(
		source,
		/observerRecoveryTrailingRequested = false;[\s\S]{0,100}void runObserverRecovery\(\)/,
	);
});

test("PRESMOKE-B3-OBS-EXT-04 Task and Approval UI messages only invoke owner applications; they never drive Task progression", async () => {
	const source = await backgroundSource();
	for (const marker of [
		"PROFLOW_TASK_APPLICATION",
		"PROFLOW_APPROVAL_APPLICATION",
	])
		assert.match(source, new RegExp(marker));
	const runtimeMessages = source.slice(
		source.indexOf("chrome.runtime.onMessage.addListener"),
	);
	assert.match(
		runtimeMessages,
		/invokeTaskApplication\(message\.operation, message\.input\)/,
	);
	assert.match(
		runtimeMessages,
		/invokeApprovalApplication\(message\.operation, message\.input\)/,
	);
	assert.doesNotMatch(
		runtimeMessages,
		/taskObserver|resumeTaskWorker|resumeAfterApprovalDecision|TASK_OBSERVER_/,
	);
});

test("CP-EXE-BR-34 WAKE_GUARD is a physical Browser denial gate and not a Task scheduler", async () => {
	const [background, executor] = await Promise.all([
		backgroundSource(),
		readFile(browserExecutorUrl, "utf8"),
	]);
	assert.match(background, /command\.type === "WAKE_GUARD"/);
	assert.match(
		background,
		/carrierContinuationControl\.hasMatchingDispatchDenial/,
	);
	assert.match(executor, /await options\.browser\.guardWake/);
	assert.match(
		executor,
		/request\.capability === "worker\.wake"[\s\S]{0,1800}options\.browser\.guardWake[\s\S]{0,800}effectStarted\(raw\)[\s\S]{0,1200}options\.browser\.submit/,
	);
	assert.match(executor, /CARRIER_CONTINUATION_HUMAN_DENIED/);
});

test("PRESMOKE-B3-SYSOBS-EXT-01 System Observer carry-forward remains Extension-owned and persisted", async () => {
	const source = await backgroundSource();
	assert.match(source, /SYSTEM_OBSERVER_STATE_KEY/);
	assert.match(source, /loadSystemObserverState/);
	assert.match(source, /persistSystemObserverState/);
	assert.match(source, /previousUnresolved/);
	assert.match(source, /previousCarryForward/);
});

test("REAL3 Browser session events rearm physical recovery without becoming Task progression events", async () => {
	const source = await backgroundSource();
	assert.match(source, /createObserverRecoveryRearm/);
	assert.match(source, /observerRecoveryRearm\.startupReady\(\)/);
	assert.match(source, /observerRecoveryRearm\.bridgeSessionEstablished/);
	assert.doesNotMatch(source, /TASK_OBSERVER_RECOVER|TASK_OBSERVER_RESUME/);
});

test("CP-EXE-BR-39 Local Tool loop stays independent from Browser recovery and Task reconciliation", async () => {
	const source = await backgroundSource();
	assert.match(source, /async function runLocalToolBridgeLoop\(\)/);
	assert.match(source, /\/v1\/local-tools\/commands\/next/);
	assert.match(source, /\/v1\/local-tools\/commands\/execute/);
	const localStart = source.indexOf("async function runLocalToolBridgeLoop()");
	const browserStart = source.indexOf(
		"async function runBridgeLoop()",
		localStart,
	);
	const local = source.slice(localStart, browserStart);
	assert.doesNotMatch(
		local,
		/task\.reconcile|TaskObserver|collaborationCarrier|systemObserver/,
	);
});
