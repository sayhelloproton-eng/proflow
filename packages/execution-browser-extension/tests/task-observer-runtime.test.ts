import assert from "node:assert/strict";
import { test } from "node:test";

import {
	createTaskObserver,
	type TaskDriveProjection,
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
					canDrive: true,
					blockedReason: null,
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
