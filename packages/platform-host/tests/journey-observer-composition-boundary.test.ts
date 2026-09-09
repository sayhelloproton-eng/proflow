import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const hostUrl = new URL("../src/index.ts", import.meta.url);
const coordinatorUrl = new URL(
	"../src/reconciliation-coordinator.ts",
	import.meta.url,
);

async function sources() {
	const [host, coordinator] = await Promise.all([
		readFile(hostUrl, "utf8"),
		readFile(coordinatorUrl, "utf8"),
	]);
	return { host, coordinator, all: `${host}\n${coordinator}` };
}

test("CP-HOST-03 current host transport surface has no Task authorization compatibility command", async () => {
	const { host } = await sources();
	assert.doesNotMatch(host, /authorizeTask|authorizedByRef|TASK_AUTHORIZED/);
	assert.match(host, /requiredAgentPackageRef|agentPackageRef/);
});

test("CP-HOST-06 platform-host owns bounded Task Reconciliation while Task Owner keeps workflow truth", async () => {
	const { host, coordinator } = await sources();
	assert.match(host, /createReconciliationCoordinator/);
	assert.match(host, /taskDriverPorts\.getTaskDriveProjection/);
	assert.match(
		coordinator,
		/pageSize = positiveBound\(options\.pageSize, 100, 1_000\)/,
	);
	assert.match(
		coordinator,
		/concurrency = positiveBound\(options\.concurrency, 4, 64\)/,
	);
	assert.match(
		coordinator,
		/intervalMs = positiveBound\(options\.intervalMs, 10_000, 60_000\)/,
	);
	assert.doesNotMatch(host, /createTaskObserver|extension:task-observer/);
});

test("CP-HOST-07 reconciliation drives only typed worker.wake and never writes Node lifecycle itself", async () => {
	const { host, coordinator } = await sources();
	assert.match(host, /callerRef: "platform-host:task-reconciliation"/);
	assert.match(host, /capability: "worker.wake"/);
	assert.match(coordinator, /requestWake\(decision\)/);
	assert.doesNotMatch(
		coordinator,
		/startNode|completeNode|waitNode|reopenNode|approve/,
	);
	assert.doesNotMatch(
		host,
		/universalScheduler|frameRegistry|frameRoleHandshake|persistentTab/i,
	);
});

test("PRESMOKE-B3-OBS-HOST-01 Task/Node mutations kick backend reconciliation; Browser events only get reconcileAll accelerator", async () => {
	const { host } = await sources();
	assert.match(host, /taskMutationOperations/);
	assert.match(host, /reconciliationCoordinator\?\.kick\(input\.taskId\)/);
	assert.match(host, /operation === "task.reconcileAll"/);
	assert.doesNotMatch(host, /operation === "task.reconcile"/);
	assert.doesNotMatch(
		host,
		/operation === "task.wake"|operation === "task.projection"|operation === "task.diagnostic"/,
	);
});

test("PRESMOKE-B4-OBS-HOST-02 Approval decisions kick the same backend reconciliation owner", async () => {
	const { host } = await sources();
	assert.match(host, /const reconcileApproval = async/);
	assert.match(host, /reconciliationCoordinator\?\.kick\(context\.taskId/);
	assert.match(host, /await reconcileApproval\(approvalRef\)/);
	assert.doesNotMatch(host, /approval\.reconcile|approval\.executionContext/);
});

test("PRESMOKE-B4-OBS-HOST-03 durable Execution signals are consumed by backend coordinator, never Extension", async () => {
	const { host, coordinator } = await sources();
	assert.match(host, /listExecutionObserverSignals/);
	assert.match(host, /acknowledgeExecutionObserverSignal/);
	assert.match(coordinator, /RECOVERY_RESUME/);
	assert.match(coordinator, /UNKNOWN_REALITY/);
	assert.match(coordinator, /acknowledgeExecutionSignal/);
});

test("PRESMOKE-B3-SYSOBS-HOST-01 Observer transport retains Browser/Collaboration/System owner views without Task scheduler APIs", async () => {
	const { host } = await sources();
	assert.match(host, /\/application\/observer/);
	assert.match(host, /system\.view/);
	assert.match(host, /system\.reason/);
	assert.match(host, /collaboration\.listPending/);
	assert.match(host, /browser\.permission\.classify/);
	assert.doesNotMatch(
		host,
		/task\.projection|task\.diagnostic|task\.wake|execution\.listSignals|execution\.ackSignal/,
	);
});

test("PRESMOKE-B3-SYSOBS-OWNER-01 bounded System views never borrow another owner's readiness", async () => {
	const { host } = await sources();
	assert.match(host, /owner aggregate projection unavailable/);
	assert.match(host, /no substitute owner readiness is inferred/);
	for (const view of [
		"task",
		"worker",
		"collaboration",
		"execution",
		"carrier",
		"model",
		"deployment",
		"artifact",
	])
		assert.match(host, new RegExp(`view === "${view}"`));
});
