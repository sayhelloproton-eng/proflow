import assert from "node:assert/strict";
import { test } from "node:test";

import {
	createTaskObserver,
	type TaskDriveProjection,
	type TaskObserverResumeSignal,
} from "../src/task-observer.ts";

function projection(
	overrides: Partial<TaskDriveProjection> = {},
): TaskDriveProjection {
	return {
		taskId: "task:1",
		taskStatus: "ACTIVE",
		taskVersion: 7,
		terminal: false,
		currentNode: {
			nodeId: "node:dev",
			status: "READY",
			version: 3,
			runNo: 1,
			requiredAgentPackageRef: "@tomflow/proflow-agent-controller-dev",
		},
		roleBinding: {
			agentPackageRef: "@tomflow/proflow-agent-controller-dev",
			roleRef: "g-controller",
			workerRef: "c-dev",
			conversationLocator: "https://chatgpt.com/g/g-controller/c/c-dev",
		},
		canDrive: true,
		blockedReason: null,
		resumeSignalRef: null,
		...overrides,
	};
}

test("PRESMOKE-B3-OBSERVER-01 READY deterministically emits one typed NODE_READY wake and never mutates Task", async () => {
	const wakes: unknown[] = [];
	const observer = createTaskObserver({
		owner: {
			async getTaskDriveProjection() {
				return projection();
			},
		},
		carrier: {
			async requestWake(input) {
				wakes.push(input);
				return { status: "DELIVERED" };
			},
		},
	});
	const decision = await observer.drive("task:1");
	assert.equal(decision.kind, "WAKE");
	assert.deepEqual(wakes, [
		{
			taskId: "task:1",
			nodeId: "node:dev",
			runNo: 1,
			roleRef: "g-controller",
			workerRef: "c-dev",
			trigger: "NODE_READY",
			conversationLocator: "https://chatgpt.com/g/g-controller/c/c-dev",
		},
	]);
});

test("PRESMOKE-B3-OBSERVER-02 reopened run keeps same durable binding and emits distinct REOPEN trigger", async () => {
	const wakes: Array<{ trigger: string; workerRef: string }> = [];
	const observer = createTaskObserver({
		owner: {
			async getTaskDriveProjection() {
				return projection({
					currentNode: {
						nodeId: "node:dev",
						status: "READY",
						version: 8,
						runNo: 2,
						requiredAgentPackageRef: "@tomflow/proflow-agent-controller-dev",
					},
				});
			},
		},
		carrier: {
			async requestWake(input) {
				wakes.push({ trigger: input.trigger, workerRef: input.workerRef });
				return {};
			},
		},
	});
	assert.equal((await observer.drive("task:1")).kind, "WAKE");
	assert.deepEqual(wakes, [{ trigger: "REOPEN", workerRef: "c-dev" }]);
});

test("PRESMOKE-B3-OBSERVER-03 terminal or unbound projection stops/noops without Browser effect", async () => {
	let wakeCount = 0;
	let current = projection({ terminal: true, currentNode: null });
	const observer = createTaskObserver({
		owner: {
			async getTaskDriveProjection() {
				return current;
			},
		},
		carrier: {
			async requestWake() {
				wakeCount += 1;
			},
		},
	});
	assert.deepEqual(await observer.drive("task:1"), {
		kind: "STOP_DRIVING",
		taskId: "task:1",
		reason: "TERMINAL",
	});
	current = projection({
		roleBinding: {
			agentPackageRef: "@tomflow/proflow-agent-controller-dev",
			roleRef: "g-controller",
			workerRef: "c-dev",
			conversationLocator: null,
		},
	});
	assert.equal((await observer.drive("task:1")).kind, "NOOP");
	assert.equal(wakeCount, 0);
});

test("PRESMOKE-B3-OBSERVER-04 async owner event emits RESUME with the same durable binding and underlying ref", async () => {
	const wakes: unknown[] = [];
	const observer = createTaskObserver({
		owner: {
			async getTaskDriveProjection() {
				return projection({
					currentNode: {
						nodeId: "node:dev",
						status: "IN_PROGRESS",
						version: 4,
						runNo: 1,
						requiredAgentPackageRef: "@tomflow/proflow-agent-controller-dev",
					},
					canDrive: false,
					blockedReason: "NODE_NOT_READY",
				});
			},
		},
		carrier: {
			async requestWake(input) {
				wakes.push(input);
			},
		},
	});

	const decision = await observer.drive("task:1", {
		trigger: "PEER_REPLY_READY",
		ref: "message:reply-1",
		targetWorkerRef: "c-dev",
		nodeId: "node:dev",
		runNo: 1,
	});
	assert.deepEqual(decision, {
		kind: "RESUME",
		taskId: "task:1",
		nodeId: "node:dev",
		runNo: 1,
		roleRef: "g-controller",
		workerRef: "c-dev",
		trigger: "PEER_REPLY_READY",
		conversationLocator: "https://chatgpt.com/g/g-controller/c/c-dev",
		underlyingRef: "message:reply-1",
	});
	assert.equal(
		(wakes[0] as { underlyingRef: string }).underlyingRef,
		"message:reply-1",
	);
});

test("B1-OBSERVER-01 TASK_RESUMED resumes only the exact current node generation and Worker", async () => {
	const wakes: unknown[] = [];
	const observer = createTaskObserver({
		owner: {
			async getTaskDriveProjection() {
				return projection({
					currentNode: {
						nodeId: "node:dev",
						status: "IN_PROGRESS",
						version: 5,
						runNo: 3,
						requiredAgentPackageRef: "@tomflow/proflow-agent-controller-dev",
					},
					canDrive: false,
					blockedReason: "NODE_NOT_READY",
				});
			},
		},
		carrier: {
			async requestWake(input) {
				wakes.push(input);
			},
		},
	});
	const exact = await observer.drive("task:1", {
		trigger: "TASK_RESUMED",
		ref: "resume:task:1:v8",
		targetWorkerRef: "c-dev",
		nodeId: "node:dev",
		runNo: 3,
	});
	assert.equal(exact.kind, "RESUME");
	assert.equal(wakes.length, 1);
	for (const stale of [
		{ nodeId: "node:old", runNo: 3, targetWorkerRef: "c-dev" },
		{ nodeId: "node:dev", runNo: 2, targetWorkerRef: "c-dev" },
		{ nodeId: "node:dev", runNo: 3, targetWorkerRef: "c-other" },
	]) {
		const decision = await observer.drive("task:1", {
			trigger: "TASK_RESUMED",
			ref: "resume:stale",
			...stale,
		});
		assert.equal(decision.kind, "NOOP");
	}
	assert.equal(wakes.length, 1);
});

test("B1-OBSERVER-02 an arbitrary ACTIVE IN_PROGRESS startup scan never resumes a Worker without an explicit signal", async () => {
	let wakeCount = 0;
	const observer = createTaskObserver({
		owner: {
			async getTaskDriveProjection() {
				return projection({
					currentNode: {
						nodeId: "node:dev",
						status: "IN_PROGRESS",
						version: 4,
						runNo: 1,
						requiredAgentPackageRef: "@tomflow/proflow-agent-controller-dev",
					},
					canDrive: false,
					blockedReason: "NODE_NOT_READY",
				});
			},
		},
		carrier: {
			async requestWake() {
				wakeCount += 1;
			},
		},
	});
	assert.deepEqual(await observer.drive("task:1"), {
		kind: "NOOP",
		taskId: "task:1",
		reason: "NO_NEXT_STEP",
	});
	assert.equal(wakeCount, 0);
});

test("B1-OBSERVER-03 durable TASK_RESUMED owner event reconstructs the same resume intent after transient bridge loss", async () => {
	const wakes: Array<{ trigger: string; underlyingRef?: string }> = [];
	const observer = createTaskObserver({
		owner: {
			async getTaskDriveProjection() {
				return projection({
					currentNode: {
						nodeId: "node:dev",
						status: "IN_PROGRESS",
						version: 6,
						runNo: 1,
						requiredAgentPackageRef: "@tomflow/proflow-agent-controller-dev",
					},
					canDrive: false,
					blockedReason: "NODE_NOT_READY",
					resumeSignalRef: "task-event:42",
				});
			},
		},
		carrier: {
			async requestWake(input) {
				wakes.push({
					trigger: input.trigger,
					...(input.underlyingRef !== undefined
						? { underlyingRef: input.underlyingRef }
						: {}),
				});
			},
		},
	});
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const decision = await observer.drive("task:1");
		assert.equal(decision.kind, "RESUME");
	}
	assert.deepEqual(wakes, [
		{ trigger: "TASK_RESUMED", underlyingRef: "task-event:42" },
		{ trigger: "TASK_RESUMED", underlyingRef: "task-event:42" },
	]);
});

test("PRESMOKE-B3-OBSERVER-05 async readiness is ignored when binding target/locator does not match current worker", async () => {
	let wakeCount = 0;
	const observer = createTaskObserver({
		owner: {
			async getTaskDriveProjection() {
				return projection({
					currentNode: {
						nodeId: "node:dev",
						status: "IN_PROGRESS",
						version: 4,
						runNo: 1,
						requiredAgentPackageRef: "@tomflow/proflow-agent-controller-dev",
					},
					canDrive: false,
					blockedReason: "NODE_NOT_READY",
				});
			},
		},
		carrier: {
			async requestWake() {
				wakeCount += 1;
			},
		},
	});

	const wrongWorker = await observer.drive("task:1", {
		trigger: "RECOVERY_RESUME",
		ref: "recovery:1",
		targetWorkerRef: "c-other",
		nodeId: "node:dev",
		runNo: 1,
	});
	assert.deepEqual(wrongWorker, {
		kind: "NOOP",
		taskId: "task:1",
		reason: "RESUME_TARGET_NOT_CURRENT_WORKER",
	});
	assert.equal(wakeCount, 0);
});

test("PRESMOKE-B3-OBSERVER-06 abnormal single-Task reality invokes bounded diagnostic only and never performs Carrier effect", async () => {
	let wakeCount = 0;
	const diagnostics: unknown[] = [];
	const observer = createTaskObserver({
		owner: {
			async getTaskDriveProjection() {
				return projection({
					currentNode: {
						nodeId: "node:dev",
						status: "IN_PROGRESS",
						version: 4,
						runNo: 1,
						requiredAgentPackageRef: "@tomflow/proflow-agent-controller-dev",
					},
					canDrive: false,
					blockedReason: "NODE_NOT_READY",
				});
			},
		},
		carrier: {
			async requestWake() {
				wakeCount += 1;
			},
		},
		diagnostic: {
			async assess(input) {
				diagnostics.push(input);
				return {
					finding: "Delivery reality is ambiguous",
					probableCause: "Carrier observation conflict",
					confidence: 0.72,
					recommendedNextObservation: "Observe current Conversation reality",
					recommendedRecoveryAction: "Reconcile without replay",
					needsHumanAttention: false,
				};
			},
		},
	});

	const decision = await observer.drive("task:1", undefined, {
		kind: "UNKNOWN_REALITY",
		ref: "execution:unknown-1",
		facts: {
			executionStatus: "UNKNOWN",
			deliveryEvidencePresent: false,
		},
	});
	assert.equal(decision.kind, "DIAGNOSTIC");
	assert.equal(diagnostics.length, 1);
	assert.equal(wakeCount, 0);
});

test("PRESMOKE-B3-TASKOBS-REPLAY-01 repeated recovery of the same READY run emits the same deterministic wake intent", async () => {
	const wakes: unknown[] = [];
	const observer = createTaskObserver({
		owner: {
			async getTaskDriveProjection() {
				return {
					taskId: "task:stable",
					taskStatus: "ACTIVE",
					taskVersion: 7,
					terminal: false,
					currentNode: {
						nodeId: "node:1",
						status: "READY",
						version: 3,
						runNo: 1,
						requiredAgentPackageRef: "@tomflow/proflow-agent-controller-dev",
					},
					roleBinding: {
						agentPackageRef: "@tomflow/proflow-agent-controller-dev",
						roleRef: "g-controller",
						workerRef: "c-controller",
						conversationLocator:
							"https://chatgpt.com/g/g-controller/c/c-controller",
					},
					canDrive: true,
					blockedReason: null,
					resumeSignalRef: null,
				};
			},
		},
		carrier: {
			async requestWake(input) {
				wakes.push(input);
			},
		},
	});

	await observer.drive("task:stable");
	await observer.drive("task:stable");
	assert.equal(wakes.length, 2);
	assert.deepEqual(wakes[0], wakes[1]);
});

test("PRESMOKE-B5-TASK-DIAG-02 typed Model diagnostic failure defers without Carrier or workflow authority", async () => {
	let wakes = 0;
	const observer = createTaskObserver({
		owner: {
			async getTaskDriveProjection(taskId) {
				return {
					taskId,
					taskStatus: "ACTIVE",
					taskVersion: 1,
					terminal: false,
					currentNode: {
						nodeId: "node:1",
						status: "IN_PROGRESS",
						version: 1,
						runNo: 1,
						requiredAgentPackageRef: "@tomflow/proflow-agent-controller-dev",
					},
					roleBinding: {
						agentPackageRef: "@tomflow/proflow-agent-controller-dev",
						roleRef: "g-controller",
						workerRef: "worker:1",
						conversationLocator: "https://chatgpt.com/c/1",
					},
					canDrive: false,
					blockedReason: "NODE_NOT_READY",
					resumeSignalRef: null,
				};
			},
		},
		carrier: {
			async requestWake() {
				wakes += 1;
			},
		},
		diagnostic: {
			async assess() {
				return { ok: false, errorCode: "REASON_UNAVAILABLE" as const };
			},
		},
	});
	const decision = await observer.drive("task:1", undefined, {
		kind: "UNKNOWN_REALITY",
		ref: "execution:1",
		facts: { status: "UNKNOWN" },
	});
	assert.equal(decision.kind, "NOOP");
	if (decision.kind === "NOOP")
		assert.equal(decision.reason, "DIAGNOSTIC_UNAVAILABLE");
	assert.equal(wakes, 0);
});

test("RF-B3-OBSERVER-RESUME-01 resume is fenced by active IN_PROGRESS state and current generation", async () => {
	let current = projection({
		currentNode: {
			nodeId: "node:dev",
			status: "IN_PROGRESS",
			version: 4,
			runNo: 2,
			requiredAgentPackageRef: "@tomflow/proflow-agent-controller-dev",
		},
		canDrive: false,
		blockedReason: "NODE_NOT_READY",
	});
	let wakeCount = 0;
	const observer = createTaskObserver({
		owner: {
			async getTaskDriveProjection() {
				return current;
			},
		},
		carrier: {
			async requestWake() {
				wakeCount += 1;
			},
		},
	});
	const signal = {
		trigger: "RECOVERY_RESUME" as const,
		ref: "execution:old-run",
		targetWorkerRef: "c-dev",
		nodeId: "node:dev",
		runNo: 1,
	};
	const currentRun = await observer.drive("task:1", {
		...signal,
		ref: "execution:current-run",
		runNo: 2,
	});
	assert.equal(currentRun.kind, "RESUME");
	assert.equal(wakeCount, 1);

	const missingGeneration = await observer.drive("task:1", {
		trigger: "RECOVERY_RESUME",
		ref: "execution:missing-generation",
		targetWorkerRef: "c-dev",
	} as unknown as TaskObserverResumeSignal);
	assert.deepEqual(missingGeneration, {
		kind: "NOOP",
		taskId: "task:1",
		reason: "RESUME_GENERATION_REQUIRED",
	});
	assert.equal(wakeCount, 1);

	const stale = await observer.drive("task:1", signal);
	assert.deepEqual(stale, {
		kind: "NOOP",
		taskId: "task:1",
		reason: "RESUME_GENERATION_MISMATCH",
	});
	assert.equal(wakeCount, 1);

	const staleNode = await observer.drive("task:1", {
		...signal,
		ref: "execution:stale-node",
		nodeId: "node:old",
		runNo: 2,
	});
	assert.deepEqual(staleNode, {
		kind: "NOOP",
		taskId: "task:1",
		reason: "RESUME_GENERATION_MISMATCH",
	});
	assert.equal(wakeCount, 1);

	current = { ...current, taskStatus: "PAUSED" };
	const paused = await observer.drive("task:1", {
		...signal,
		ref: "execution:current-paused",
		runNo: 2,
	});
	assert.deepEqual(paused, {
		kind: "NOOP",
		taskId: "task:1",
		reason: "BINDING_NOT_READY",
	});
	assert.equal(wakeCount, 1);

	const currentNode = current.currentNode;
	assert.ok(currentNode);
	current = {
		...current,
		taskStatus: "WAITING",
		currentNode: { ...currentNode, status: "WAITING" },
	};
	const waiting = await observer.drive("task:1", {
		...signal,
		ref: "execution:current-waiting",
		runNo: 2,
	});
	assert.deepEqual(waiting, {
		kind: "NOOP",
		taskId: "task:1",
		reason: "BINDING_NOT_READY",
	});
	assert.equal(wakeCount, 1);
});
