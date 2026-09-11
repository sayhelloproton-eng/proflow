import assert from "node:assert/strict";
import { test } from "node:test";

import { createReconciliationCoordinator } from "../src/reconciliation-coordinator.ts";
import type { TaskDriveProjection } from "../src/task-observer.ts";

function readyProjection(): TaskDriveProjection {
	return {
		taskId: "task:retry",
		taskStatus: "ACTIVE",
		taskVersion: 10,
		terminal: false,
		currentNode: {
			nodeId: "test",
			status: "READY",
			version: 3,
			runNo: 1,
			requiredAgentPackageRef: "@tomflow/proflow-agent-test-ops",
		},
		roleBinding: {
			agentPackageRef: "@tomflow/proflow-agent-test-ops",
			roleRef: "g-test",
			workerRef: "c-test",
			conversationLocator: "https://chatgpt.com/g/g-test/c/c-test",
		},
		canDrive: true,
		blockedReason: null,
		resumeSignalRef: null,
	};
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

test("Real3 regression NODE_READY wake transport failure retries without sweep or second kick", async (context) => {
	let wakeAttempts = 0;
	let clockReads = 0;
	const retried = deferred();
	const coordinator = createReconciliationCoordinator({
		async listTaskPage() {
			return { taskIds: [] };
		},
		async listExecutionSignals() {
			return [];
		},
		async acknowledgeExecutionSignal() {},
		async ensureWorkers() {},
		async getProjection() {
			return readyProjection();
		},
		async requestWake() {
			wakeAttempts += 1;
			if (wakeAttempts === 1) throw new Error("injected transport failure");
			retried.resolve();
		},
		now() {
			clockReads += 1;
			return clockReads <= 2 ? 0 : 1_000;
		},
	});
	context.after(() => coordinator.stop());

	coordinator.kick("task:retry");
	await Promise.race([
		retried.promise,
		new Promise<void>((_, reject) => {
			const timeout = setTimeout(
				() => reject(new Error("automatic reconciliation retry did not run")),
				500,
			);
			timeout.unref?.();
		}),
	]);
	assert.equal(wakeAttempts, 2);
	await new Promise<void>((done) => setTimeout(done, 20));
	assert.equal(wakeAttempts, 2, "successful wake must not keep retrying");
});
