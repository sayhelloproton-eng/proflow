import assert from "node:assert/strict";
import { test } from "node:test";

import {
	assertNodeTransition,
	assertTaskGroupTransition,
	assertTaskTransition,
	createTaskServices,
	publicOperationNames,
	validatePublicInput,
} from "../src/index.ts";

test("the service surface implements every frozen public operation exactly once", () => {
	const unavailable = () => {
		throw new Error("not used by surface inspection");
	};
	const services = createTaskServices({
		store: { read: unavailable, transaction: unavailable },
		workspaceRoot: "/unused",
	});
	assert.deepEqual(
		[
			...Object.keys(services.commands),
			...Object.keys(services.queries),
			...Object.keys(services.documents).filter(
				(name) => name !== "reconcileDocumentIndex",
			),
		].sort(),
		[...publicOperationNames].sort(),
	);
});

test("CP-TASK-ORCH-01 frozen Task, TaskGroup, and Node transitions reject illegal changes", () => {
	for (const [from, to] of [
		["PENDING", "READY"],
		["READY", "ACTIVE"],
		["ACTIVE", "WAITING"],
		["WAITING", "ACTIVE"],
		["ACTIVE", "PAUSED"],
		["PAUSED", "ACTIVE"],
		["ACTIVE", "FAILED"],
		["ACTIVE", "SUCCEEDED"],
	] as const)
		assert.doesNotThrow(() => assertTaskTransition(from, to));
	assert.doesNotThrow(() => assertTaskTransition("ACTIVE", "TERMINATED"));
	assert.throws(() => assertTaskTransition("SUCCEEDED", "ACTIVE"));
	assert.throws(() => assertTaskTransition("PENDING", "SUCCEEDED"));

	assert.doesNotThrow(() => assertTaskGroupTransition("READY", "ACTIVE"));
	assert.doesNotThrow(() => assertTaskGroupTransition("ACTIVE", "SUCCEEDED"));
	assert.throws(() => assertTaskGroupTransition("SUCCEEDED", "ACTIVE"));

	for (const [from, to] of [
		["PENDING", "READY"],
		["READY", "IN_PROGRESS"],
		["IN_PROGRESS", "SUCCEEDED"],
		["IN_PROGRESS", "WAITING"],
		["WAITING", "IN_PROGRESS"],
		["IN_PROGRESS", "FAILED"],
	] as const)
		assert.doesNotThrow(() => assertNodeTransition(from, to));
	assert.throws(() => assertNodeTransition("PENDING", "IN_PROGRESS"));
	assert.throws(() => assertNodeTransition("SUCCEEDED", "IN_PROGRESS"));
});

test("CP-TASK-ORCH-02 public runtime exposes exactly 23 operations and no alternate scheduler", () => {
	assert.deepEqual(publicOperationNames, [
		"createTaskGroup",
		"startTaskGroup",
		"createTask",
		"authorizeTask",
		"bindTaskWorker",
		"startTask",
		"pauseTask",
		"resumeTask",
		"terminateTask",
		"startNode",
		"completeNode",
		"waitNode",
		"failNode",
		"reopenNode",
		"acknowledgeMessage",
		"getTaskGroup",
		"listTasks",
		"getTask",
		"getNodeContext",
		"listPendingMessages",
		"listTaskEvents",
		"putTaskDocument",
		"getTaskDocument",
	]);
	const forbidden = [
		"WorkItem",
		"Claim",
		"Lease",
		"createEdge",
		"assignWorker",
	];
	for (const value of forbidden)
		assert.equal(
			publicOperationNames.some((name) => name.includes(value)),
			false,
		);
});

test("CP-TASK-ORCH-04 public command runtime validation rejects missing command controls and caller workerRef", () => {
	assert.throws(() => validatePublicInput("startTask", { taskId: "task-1" }));
	assert.throws(() =>
		validatePublicInput("startNode", {
			taskId: "task-1",
			nodeId: "node-1",
			workerRef: "worker:caller-selected",
			expectedTaskVersion: 1,
			expectedNodeVersion: 1,
			actorRef: "actor:test",
			idempotencyKey: "idem:start",
		}),
	);
	assert.deepEqual(
		validatePublicInput("startNode", {
			taskId: "task-1",
			nodeId: "node-1",
			expectedTaskVersion: 1,
			expectedNodeVersion: 1,
			actorRef: "actor:test",
			idempotencyKey: "idem:start",
		}),
		{
			taskId: "task-1",
			nodeId: "node-1",
			expectedTaskVersion: 1,
			expectedNodeVersion: 1,
			actorRef: "actor:test",
			idempotencyKey: "idem:start",
		},
	);
});
