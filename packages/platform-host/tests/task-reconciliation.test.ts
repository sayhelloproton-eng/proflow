import assert from "node:assert/strict";
import { test } from "node:test";

import { createReconciliationCoordinator } from "../src/reconciliation-coordinator.ts";
import {
	decideTaskProgression,
	type TaskDriveProjection,
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
	const active = projection({
		currentNode: {
			nodeId: "dev",
			status: "IN_PROGRESS",
			version: 3,
			runNo: 2,
			requiredAgentPackageRef: "@tomflow/proflow-agent-controller-dev",
		},
	});
	const signal = {
		trigger: "RECOVERY_RESUME" as const,
		ref: "execution:1",
		targetWorkerRef: "c-dev",
		nodeId: "dev",
		runNo: 2,
	};
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

test("CP-HOST-RECON-04 bounded sweep rediscovers READY and dedupes the same physical wake intent", async () => {
	let workers = 0;
	const wakes: unknown[] = [];
	const coordinator = createReconciliationCoordinator({
		async listTaskIds() {
			return ["task:1"];
		},
		async listExecutionSignals() {
			return [];
		},
		async acknowledgeExecutionSignal() {},
		async ensureWorkers() {
			workers += 1;
		},
		async getProjection() {
			return projection();
		},
		async requestWake(input) {
			wakes.push(input);
		},
	});
	await coordinator.sweep();
	await coordinator.sweep();
	assert.equal(wakes.length, 1);
	assert.equal(workers, 2);
	coordinator.stop();

	let clockReads = 0;
	let wakeAttempts = 0;
	const backoffCoordinator = createReconciliationCoordinator({
		async listTaskIds() {
			return ["task:1"];
		},
		async listExecutionSignals() {
			return [];
		},
		async acknowledgeExecutionSignal() {},
		async ensureWorkers() {},
		async getProjection() {
			return projection();
		},
		async requestWake() {
			wakeAttempts += 1;
			throw new Error("injected wake failure");
		},
		now() {
			clockReads += 1;
			return clockReads < 20 ? 0 : 1_000;
		},
	});
	await backoffCoordinator.sweep();
	backoffCoordinator.kick("task:1", {
		trigger: "RECOVERY_RESUME",
		ref: "execution:retry",
		targetWorkerRef: "c-dev",
		nodeId: "dev",
		runNo: 1,
	});
	await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
	assert.ok(clockReads < 10, `backoff spun through ${clockReads} clock reads`);
	assert.equal(wakeAttempts, 1);
	backoffCoordinator.stop();
});

test("CP-HOST-RECON-05 durable RECOVERY_RESUME is acknowledged only after its wake is applied", async () => {
	const acknowledgements: string[] = [];
	const wakes: unknown[] = [];
	const active = projection({
		currentNode: {
			nodeId: "dev",
			status: "IN_PROGRESS",
			version: 3,
			runNo: 2,
			requiredAgentPackageRef: "@tomflow/proflow-agent-controller-dev",
		},
	});
	const coordinator = createReconciliationCoordinator({
		async listTaskIds() {
			return [];
		},
		async listExecutionSignals() {
			return [
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
		async ensureWorkers() {},
		async getProjection() {
			return active;
		},
		async requestWake(input) {
			wakes.push(input);
		},
	});
	await coordinator.sweep();
	assert.equal(wakes.length, 1);
	assert.deepEqual(acknowledgements, ["signal:1"]);
	coordinator.stop();
});

test("RF-HOST-RECON-01 malformed recovery signal is disposed without any Worker wake", async () => {
	const acknowledgements: string[] = [];
	let wakes = 0;
	const coordinator = createReconciliationCoordinator({
		async listTaskIds() {
			return [];
		},
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
		async ensureWorkers() {},
		async getProjection() {
			return projection();
		},
		async requestWake() {
			wakes += 1;
		},
	});
	await coordinator.sweep();
	assert.equal(wakes, 0);
	assert.deepEqual(acknowledgements, ["bad:1"]);
	coordinator.stop();
});

test("RF-HOST-RECON-02 UNKNOWN notification is consumed without replaying the durable effect", async () => {
	const acknowledgements: string[] = [];
	let wakes = 0;
	const coordinator = createReconciliationCoordinator({
		async listTaskIds() {
			return [];
		},
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
		async ensureWorkers() {},
		async getProjection() {
			return projection();
		},
		async requestWake() {
			wakes += 1;
		},
	});
	await coordinator.sweep();
	assert.equal(wakes, 0);
	assert.deepEqual(acknowledgements, ["unknown:1"]);
	coordinator.stop();
});
