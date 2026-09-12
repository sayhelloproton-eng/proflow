import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const backgroundUrl = new URL("../extension/background.ts", import.meta.url);
const workerCarrierUrl = new URL(
	"../src/worker-carrier-executor.ts",
	import.meta.url,
);
const observerRecoveryUrl = new URL(
	"../extension/runtime/observer-recovery-controller.ts",
	import.meta.url,
);
const runtimeMessageRouterUrl = new URL(
	"../extension/runtime/runtime-message-router.ts",
	import.meta.url,
);
const browserCommandUrl = new URL(
	"../extension/runtime/browser-command-controller.ts",
	import.meta.url,
);
const localToolLaneUrl = new URL(
	"../extension/runtime/local-tool-lane.ts",
	import.meta.url,
);
const permissionControllerUrl = new URL(
	"../extension/runtime/permission-controller.ts",
	import.meta.url,
);

async function source(url: URL) {
	return readFile(url, "utf8");
}

test("PRESMOKE-B3-OBS-EXT-01 Extension owns Collaboration/System recovery but no Task progression lifecycle", async () => {
	const [background, recovery] = await Promise.all([
		source(backgroundUrl),
		source(observerRecoveryUrl),
	]);
	assert.match(background, /createObserverRecoveryController\(/);
	assert.match(recovery, /createCollaborationCarrierApplication\(/);
	assert.match(recovery, /createSystemObserver\(/);
	assert.match(recovery, /const requestRecovery =/);
	assert.doesNotMatch(
		`${background}\n${recovery}`,
		/createTaskObserver|taskObserver\.drive|resumeTaskWorker|resumeAfterApprovalDecision/,
	);
	assert.doesNotMatch(`${background}\n${recovery}`, /task\.projection|task\.diagnostic|task\.wake/);
});

test("PRESMOKE-B3-OBS-EXT-02 Browser recovery only accelerates backend reconciliation after Collaboration recovery", async () => {
	const recoverySource = await source(observerRecoveryUrl);
	const start = recoverySource.indexOf("const requestRecovery =");
	const end = recoverySource.indexOf("const rearm =", start);
	const recovery = recoverySource.slice(start, end);
	assert.ok(start >= 0 && end > start);
	const collaboration = recovery.indexOf(
		"await collaborationCarrier.recoverPending(50)",
	);
	const kick = recovery.indexOf(
		'options.invokeObserver("task.reconcileAll"',
	);
	const system = recovery.indexOf("systemObserver");
	assert.ok(collaboration >= 0 && kick > collaboration && system > kick);
	assert.doesNotMatch(
		recovery,
		/execution\.listSignals|task\.ensureWorkers|taskObserver|task\.list/,
	);
});

test("PRESMOKE-B3-OBS-EXT-03 Extension recovery stays single-flight with one trailing pass", async () => {
	const recovery = await source(observerRecoveryUrl);
	assert.match(recovery, /recoveryInFlight/);
	assert.match(recovery, /trailingRequested = true/);
	assert.match(recovery, /if \(!trailingRequested\) return/);
	assert.match(
		recovery,
		/trailingRequested = false;[\s\S]{0,100}void requestRecovery\(\)/,
	);
});

test("PRESMOKE-B3-OBS-EXT-04 Task and Approval UI messages only invoke owner applications; they never drive Task progression", async () => {
	const router = await source(runtimeMessageRouterUrl);
	for (const marker of [
		"PROFLOW_TASK_APPLICATION",
		"PROFLOW_APPROVAL_APPLICATION",
	])
		assert.match(router, new RegExp(marker));
	assert.match(router, /\? options\.invokeTask/);
	assert.match(router, /: options\.invokeApproval/);
	assert.match(router, /void invoke\(message\.operation, message\.input\)/);
	assert.doesNotMatch(
		router,
		/taskObserver|resumeTaskWorker|resumeAfterApprovalDecision|TASK_OBSERVER_/,
	);
});

test("CP-EXE-BR-34 WAKE_GUARD is a physical Browser denial gate and not a Task scheduler", async () => {
	const [command, permission, executor] = await Promise.all([
		source(browserCommandUrl),
		source(permissionControllerUrl),
		source(workerCarrierUrl),
	]);
	assert.match(command, /command\.type === "WAKE_GUARD"/);
	assert.match(
		command,
		/command\.type === "SUBMIT"[\s\S]{0,1200}options\.permissions\.guardWake/,
	);
	assert.match(permission, /continuation\.hasMatchingDispatchDenial/);
	assert.match(executor, /await options\.browser\.guardWake/);
	assert.match(
		executor,
		/request\.capability === "worker\.wake"[\s\S]{0,1800}options\.browser\.guardWake[\s\S]{0,800}effectStarted\(raw\)[\s\S]{0,1200}options\.browser\.submit/,
	);
	assert.match(executor, /CARRIER_CONTINUATION_HUMAN_DENIED/);
});

test("PRESMOKE-B3-SYSOBS-EXT-01 System Observer carry-forward remains Extension-owned and persisted", async () => {
	const recovery = await source(observerRecoveryUrl);
	assert.match(recovery, /const stateKey = "proflowSystemObserverState"/);
	assert.match(recovery, /const loadState = async/);
	assert.match(recovery, /const persistState = async/);
	assert.match(recovery, /previousUnresolved/);
	assert.match(recovery, /previousCarryForward/);
});

test("REAL3 Browser session events rearm physical recovery without becoming Task progression events", async () => {
	const [background, recovery] = await Promise.all([
		source(backgroundUrl),
		source(observerRecoveryUrl),
	]);
	assert.match(recovery, /createObserverRecoveryRearm\(/);
	assert.match(recovery, /rearm\.startupReady\(\)/);
	assert.match(recovery, /rearm\.bridgeSessionEstablished\(epoch\)/);
	assert.match(
		background,
		/onSessionEstablished: observerRecovery\.bridgeSessionEstablished/,
	);
	assert.doesNotMatch(`${background}\n${recovery}`, /TASK_OBSERVER_RECOVER|TASK_OBSERVER_RESUME/);
});

test("CP-EXE-BR-39 Local Tool loop stays independent from Browser recovery and Task reconciliation", async () => {
	const [background, local] = await Promise.all([
		source(backgroundUrl),
		source(localToolLaneUrl),
	]);
	assert.match(background, /createLocalToolLane\(/);
	assert.match(background, /localToolLane\.start\(\)/);
	assert.match(local, /\/v1\/local-tools\/commands\/next/);
	assert.match(local, /\/v1\/local-tools\/commands\/execute/);
	assert.match(local, /PROFLOW_LOCAL_TOOL_NOTICE_FALLBACK/);
	assert.match(local, /setBadgeText/);
	assert.doesNotMatch(
		local,
		/task\.reconcile|TaskObserver|collaborationCarrier|systemObserver/,
	);
});
