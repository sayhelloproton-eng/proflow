import assert from "node:assert/strict";
import { test } from "node:test";

import {
	createReconciliationCoordinator,
	type ReconciliationCoordinatorOptions,
} from "../src/reconciliation-coordinator.ts";
import {
	decideTaskProgression,
	type TaskDriveProjection,
	type TaskResumeSignal,
} from "../src/task-observer.ts";

function projection(
	overrides: Partial<TaskDriveProjection> = {},
): TaskDriveProjection {
	return {
		taskId: "task:1",
		taskStatus: "ACTIVE",
		taskVersion: 4,
		terminal: false,
		currentNode: {
			nodeId: "dev",
			status: "READY",
			version: 2,
			runNo: 1,
			requiredAgentPackageRef: "@tomflow/proflow-agent-controller-dev",
		},
		roleBinding: {
			agentPackageRef: "@tomflow/proflow-agent-controller-dev",
			roleRef: "g-dev",
			workerRef: "c-dev",
			conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
		},
		canDrive: true,
		blockedReason: null,
		resumeSignalRef: null,
		...overrides,
	};
}
function activeProjection(): TaskDriveProjection {
	return projection({
		currentNode: {
			nodeId: "dev",
			status: "IN_PROGRESS",
			version: 3,
			runNo: 2,
			requiredAgentPackageRef: "@tomflow/proflow-agent-controller-dev",
		},
	});
}
function resume(ref: string): TaskResumeSignal {
	return {
		trigger: "RECOVERY_RESUME",
		ref,
		targetWorkerRef: "c-dev",
		nodeId: "dev",
		runNo: 2,
	};
}
function options(
	overrides: Partial<ReconciliationCoordinatorOptions> = {},
): ReconciliationCoordinatorOptions {
	return {
		async listTaskPage() {
			return { taskIds: [] };
		},
		async listExecutionSignals() {
			return [];
		},
		async acknowledgeExecutionSignal() {},
		async ensureWorkers() {},
		async getProjection() {
			return projection();
		},
		async requestWake() {},
		...overrides,
	};
}
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

test("CP-HOST-RECON-01 READY deterministically becomes one typed WAKE without Model input", () => {
	assert.deepEqual(decideTaskProgression(projection()), {
		kind: "WAKE",
		taskId: "task:1",
		nodeId: "dev",
		runNo: 1,
		roleRef: "g-dev",
		workerRef: "c-dev",
		trigger: "NODE_READY",
		conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
	});
});

test("CP-HOST-RECON-02 terminal stops driving while nonterminal null current node is only a NOOP", () => {
	assert.deepEqual(decideTaskProgression(projection({ terminal: true })), {
		kind: "STOP_DRIVING",
		taskId: "task:1",
		reason: "TERMINAL",
	});
	assert.deepEqual(decideTaskProgression(projection({ currentNode: null })), {
		kind: "NOOP",
		taskId: "task:1",
		reason: "NO_CURRENT_NODE",
	});
});

test("CP-HOST-RECON-03 resume signal is generation- and Worker-fenced", () => {
	const active = activeProjection();
	const signal = resume("execution:1");
	assert.equal(decideTaskProgression(active, signal).kind, "WAKE");
	assert.deepEqual(decideTaskProgression(active, { ...signal, runNo: 1 }), {
		kind: "NOOP",
		taskId: "task:1",
		reason: "RESUME_GENERATION_MISMATCH",
	});
	assert.deepEqual(
		decideTaskProgression(active, { ...signal, targetWorkerRef: "c-old" }),
		{
			kind: "NOOP",
			taskId: "task:1",
			reason: "RESUME_TARGET_NOT_CURRENT_WORKER",
		},
	);
});

test("CP-HOST-RECON-04 bounded sweep rediscovers READY and dedupes the same physical wake intent", async (context) => {
	let workers = 0;
	const wakes: unknown[] = [];
	const coordinator = createReconciliationCoordinator(
		options({
			async listTaskPage() {
				return { taskIds: ["task:1"] };
			},
			async ensureWorkers() {
				workers += 1;
			},
			async requestWake(input) {
				wakes.push(input);
			},
		}),
	);
	context.after(() => coordinator.stop());
	await coordinator.sweep();
	await coordinator.sweep();
	assert.equal(wakes.length, 1);
	assert.equal(workers, 2);

	let clockReads = 0;
	let wakeAttempts = 0;
	const backoffCoordinator = createReconciliationCoordinator(
		options({
			async listTaskPage() {
				return { taskIds: ["task:1"] };
			},
			async requestWake() {
				wakeAttempts += 1;
				throw new Error("injected wake failure");
			},
			now() {
				clockReads += 1;
				return clockReads < 20 ? 0 : 1_000;
			},
		}),
	);
	context.after(() => backoffCoordinator.stop());
	await backoffCoordinator.sweep();
	backoffCoordinator.kick("task:1", { ...resume("execution:retry"), runNo: 1 });
	await new Promise<void>((done) => setImmediate(done));
	assert.ok(clockReads < 10, `backoff spun through ${clockReads} clock reads`);
	assert.equal(wakeAttempts, 1);
});

test("CP-HOST-RECON-05 durable RECOVERY_RESUME is acknowledged only after its wake is applied", async (context) => {
	const acknowledgements: string[] = [];
	let wakeAttempts = 0;
	let now = 0;
	const coordinator = createReconciliationCoordinator(
		options({
			async listExecutionSignals() {
				return acknowledgements.length
					? []
					: [
							{
								signalRef: "signal:1",
								kind: "RECOVERY_RESUME",
								executionRef: "execution:1",
								taskId: "task:1",
								nodeId: "dev",
								runNo: 2,
								workerRef: "c-dev",
							},
						];
			},
			async acknowledgeExecutionSignal(ref) {
				acknowledgements.push(ref);
			},
			async getProjection() {
				return activeProjection();
			},
			async requestWake() {
				wakeAttempts += 1;
				if (wakeAttempts === 1) throw new Error("injected first wake failure");
			},
			now: () => now,
		}),
	);
	context.after(() => coordinator.stop());
	await coordinator.sweep();
	assert.equal(wakeAttempts, 1);
	assert.deepEqual(acknowledgements, []);
	now = 1_000;
	// No signal is supplied here: the failed attempt must have retained it.
	await coordinator.reconcile("task:1");
	assert.equal(wakeAttempts, 2);
	await coordinator.sweep();
	assert.deepEqual(acknowledgements, ["signal:1"]);
	await coordinator.reconcile("task:1", resume("execution:1"));
	assert.equal(wakeAttempts, 2, "applied resume intent must not replay");
});

test("RF-HOST-RECON-01 malformed recovery signal is disposed without any Worker wake", async (context) => {
	const acknowledgements: string[] = [];
	let wakes = 0;
	const coordinator = createReconciliationCoordinator(
		options({
			async listExecutionSignals() {
				return [
					{
						signalRef: "bad:1",
						kind: "RECOVERY_RESUME",
						executionRef: "execution:bad",
						taskId: "task:1",
						workerRef: "c-dev",
					},
				];
			},
			async acknowledgeExecutionSignal(ref) {
				acknowledgements.push(ref);
			},
			async requestWake() {
				wakes += 1;
			},
		}),
	);
	context.after(() => coordinator.stop());
	await coordinator.sweep();
	assert.equal(wakes, 0);
	assert.deepEqual(acknowledgements, ["bad:1"]);
});

test("RF-HOST-RECON-02 UNKNOWN notification is consumed without replaying the durable effect", async (context) => {
	const acknowledgements: string[] = [];
	let wakes = 0;
	const coordinator = createReconciliationCoordinator(
		options({
			async listExecutionSignals() {
				return [
					{
						signalRef: "unknown:1",
						kind: "UNKNOWN_REALITY",
						executionRef: "execution:unknown",
						taskId: "task:1",
						workerRef: "c-dev",
					},
				];
			},
			async acknowledgeExecutionSignal(ref) {
				acknowledgements.push(ref);
			},
			async requestWake() {
				wakes += 1;
			},
		}),
	);
	context.after(() => coordinator.stop());
	await coordinator.sweep();
	assert.equal(wakes, 0);
	assert.deepEqual(acknowledgements, ["unknown:1"]);
});

test("Real3 F08 coalesced distinct signals survive and applied A is not replayed after B", async (context) => {
	const wakes: string[] = [];
	const firstEntered = deferred();
	const release = deferred();
	const coordinator = createReconciliationCoordinator(
		options({
			async getProjection() {
				return activeProjection();
			},
			async requestWake(input) {
				wakes.push(input.underlyingRef ?? "missing");
				if (wakes.length === 1) {
					firstEntered.resolve();
					await release.promise;
				}
			},
		}),
	);
	context.after(() => {
		coordinator.stop();
		release.resolve();
	});
	const first = coordinator.reconcile("task:1", resume("A"));
	await firstEntered.promise;
	coordinator.kick("task:1", resume("B"));
	coordinator.kick("task:1", resume("B"));
	release.resolve();
	await first;
	await coordinator.reconcile("task:1");
	await coordinator.reconcile("task:1", resume("A"));
	assert.deepEqual(wakes, ["A", "B"]);
});

test("Real3 F08 transient binding blockage retains signal until a later successful wake", async (context) => {
	let ready = false;
	let now = 0;
	let wakes = 0;
	const coordinator = createReconciliationCoordinator(
		options({
			async getProjection() {
				return ready
					? activeProjection()
					: { ...activeProjection(), roleBinding: null };
			},
			async requestWake() {
				wakes += 1;
			},
			now: () => now,
		}),
	);
	context.after(() => coordinator.stop());
	await coordinator.reconcile("task:1", resume("blocked"));
	assert.equal(wakes, 0);
	ready = true;
	now = 1_000;
	await coordinator.reconcile("task:1");
	assert.equal(wakes, 1);
});

test("Real3 F12 sweep and kicks share capacity and stop cancels queued and late work", async (context) => {
	const entered = deferred();
	const release = deferred();
	let workerCalls = 0;
	let wakes = 0;
	const coordinator = createReconciliationCoordinator(
		options({
			concurrency: 1,
			maxPendingTasks: 2,
			async listTaskPage() {
				return { taskIds: ["task:1"] };
			},
			async ensureWorkers() {
				workerCalls += 1;
				entered.resolve();
				await release.promise;
			},
			async requestWake() {
				wakes += 1;
			},
		}),
	);
	context.after(() => {
		coordinator.stop();
		release.resolve();
	});
	const sweep = coordinator.sweep();
	await entered.promise;
	coordinator.kick("task:2");
	assert.throws(() => coordinator.kick("task:3"), /CAPACITY_EXCEEDED/);
	const queued = coordinator.reconcile("task:2");
	assert.equal(workerCalls, 1);
	coordinator.stop();
	await queued;
	release.resolve();
	await sweep;
	await coordinator.reconcile("after-stop", resume("late"));
	coordinator.kick("after-stop");
	assert.equal(workerCalls, 1);
	assert.equal(wakes, 0);
});

test("Real3 F12 signal capacity rejects visibly without overwriting accepted intent", async (context) => {
	const entered = deferred();
	const release = deferred();
	const wakes: string[] = [];
	const coordinator = createReconciliationCoordinator(
		options({
			maxPendingSignals: 1,
			async getProjection() {
				return activeProjection();
			},
			async requestWake(input) {
				wakes.push(input.underlyingRef ?? "missing");
				entered.resolve();
				await release.promise;
			},
		}),
	);
	context.after(() => {
		coordinator.stop();
		release.resolve();
	});
	const first = coordinator.reconcile("task:1", resume("accepted"));
	await entered.promise;
	assert.throws(
		() => coordinator.kick("task:1", resume("overflow")),
		/SIGNAL_CAPACITY_EXCEEDED/,
	);
	release.resolve();
	await first;
	assert.deepEqual(wakes, ["accepted"]);
});

test("Real3 F12 bounded task keyset progresses through page 101 and wraps after deletion", async (context) => {
	let ids = Array.from(
		{ length: 101 },
		(_, index) => `task:${String(index + 1).padStart(3, "0")}`,
	);
	const visited: string[] = [];
	const cursors: Array<string | undefined> = [];
	const coordinator = createReconciliationCoordinator(
		options({
			async listTaskPage(input) {
				assert.equal(input.limit, 100);
				cursors.push(input.afterTaskId);
				const page = ids
					.filter((id) => !input.afterTaskId || id > input.afterTaskId)
					.slice(0, input.limit);
				return {
					taskIds: page,
					...(page.length === input.limit
						? { nextAfterTaskId: page.at(-1) as string }
						: {}),
				};
			},
			async getProjection(taskId) {
				visited.push(taskId);
				return projection({ taskId, terminal: true });
			},
		}),
	);
	context.after(() => coordinator.stop());
	await coordinator.sweep();
	await coordinator.sweep();
	assert.equal(new Set(visited).size, 101);
	await coordinator.sweep();
	ids = ["task:001"];
	await coordinator.sweep();
	assert.deepEqual(cursors, [
		undefined,
		"task:100",
		undefined,
		"task:100",
		undefined,
	]);
	assert.equal(visited.at(-1), "task:001");
});
