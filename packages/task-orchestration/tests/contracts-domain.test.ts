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

const CURRENT_PUBLIC_OPERATIONS = [
	"createTaskGroup",
	"getTaskGroup",
	"startTaskGroup",
	"createTask",
	"listTasks",
	"getTask",
	"startTask",
	"pauseTask",
	"resumeTask",
	"terminateTask",
	"bindTaskWorker",
	"getTaskDriveProjection",
	"getNodeContext",
	"startNode",
	"completeNode",
	"waitNode",
	"failNode",
	"reopenNode",
	"putTaskDocument",
	"getTaskDocument",
	"listPendingMessages",
	"acknowledgeMessage",
	"listTaskEvents",
] as const;

const roleBindings = [
	{
		agentPackageRef: "@tomflow/proflow-agent-product",
		roleRef: "g-product",
		workerRef: null,
		conversationLocator: null,
	},
	{
		agentPackageRef: "@tomflow/proflow-agent-controller-dev",
		roleRef: "g-dev",
		workerRef: null,
		conversationLocator: null,
	},
	{
		agentPackageRef: "@tomflow/proflow-agent-test-ops",
		roleRef: "g-test",
		workerRef: null,
		conversationLocator: null,
	},
] as const;

function createTaskInput() {
	return {
		title: "Task",
		objective: "Objective",
		plan: {
			nodes: [
				{
					nodeId: "node-dev",
					title: "Development",
					objective: "Do work",
					requiredAgentPackageRef: "@tomflow/proflow-agent-controller-dev",
					inputDocuments: ["REQUIREMENT"],
					outputDocuments: ["TECHNICAL_DESIGN"],
				},
			],
		},
		initialDocuments: [{ documentType: "REQUIREMENT", content: "# Requirement\n" }],
		roleBindings,
		actorRef: "extension:new-task",
		idempotencyKey: "idem:create",
	};
}

test("the service surface implements every current public operation exactly once", () => {
	const unavailable = () => {
		throw new Error("not used by surface inspection");
	};
	const services = createTaskServices({
		store: { read: unavailable, transaction: unavailable },
		workspaceRoot: "/unused",
	});
	assert.deepEqual([...publicOperationNames].sort(), [...CURRENT_PUBLIC_OPERATIONS].sort());
	assert.deepEqual(
		[
			...Object.keys(services.commands),
			...Object.keys(services.queries),
			...Object.keys(services.documents).filter(
				(name) => name !== "reconcileDocumentIndex",
			),
		].sort(),
		[...CURRENT_PUBLIC_OPERATIONS].sort(),
	);
	assert.equal((publicOperationNames as readonly string[]).includes("authorizeTask"), false);
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
	assert.deepEqual(publicOperationNames, CURRENT_PUBLIC_OPERATIONS);
	for (const forbidden of ["WorkItem", "Claim", "Lease", "createEdge", "assignWorker"])
		assert.equal(
			(publicOperationNames as readonly string[]).some((name) => name.includes(forbidden)),
			false,
		);
});

test("CP-TASK-ORCH-04 runtime validation requires command controls and forbids caller-selected workerRef", () => {
	assert.throws(() => validatePublicInput("startTask", { taskId: "task-1" }));
	assert.throws(() =>
		validatePublicInput("startNode", {
			taskId: "task-1",
			nodeId: "node-1",
			workerRef: "worker:caller-selected",
			expectedTaskVersion: 1,
			expectedNodeVersion: 1,
			actorRef: "worker:c-dev",
			idempotencyKey: "idem:start",
		}),
	);
	assert.deepEqual(
		validatePublicInput("startNode", {
			taskId: "task-1",
			nodeId: "node-1",
			expectedTaskVersion: 1,
			expectedNodeVersion: 1,
			actorRef: "worker:c-dev",
			idempotencyKey: "idem:start",
		}),
		{
			taskId: "task-1",
			nodeId: "node-1",
			expectedTaskVersion: 1,
			expectedNodeVersion: 1,
			actorRef: "worker:c-dev",
			idempotencyKey: "idem:start",
		},
	);
});

test("remediation T01 createTask enforces agent-package identity and exactly the fixed v1 role bindings", () => {
	const base = createTaskInput();
	assert.deepEqual(validatePublicInput("createTask", base), base);
	assert.throws(() =>
		validatePublicInput("createTask", {
			...base,
			plan: {
				nodes: [{ ...base.plan.nodes[0], requiredAgentPackageRef: undefined }],
			},
		}),
	);
	assert.throws(() =>
		validatePublicInput("createTask", {
			...base,
			plan: {
				nodes: [{ ...base.plan.nodes[0], requiredRoleRef: "g-dev" }],
			},
		}),
	);
	assert.throws(() => validatePublicInput("createTask", { ...base, roleBindings: [] }));
	assert.throws(() =>
		validatePublicInput("createTask", {
			...base,
			roleBindings: roleBindings.slice(0, 2),
		}),
	);
	assert.throws(() => validatePublicInput("createTask", { ...base, taskGroupId: "group-1" }));
	assert.throws(() => validatePublicInput("createTask", { ...base, sequenceNo: 1 }));
	assert.doesNotThrow(() =>
		validatePublicInput("createTask", {
			...base,
			taskGroupId: "group-1",
			sequenceNo: 1,
		}),
	);
});

test("CP-TASK-ORCH-09/10 create starts PENDING and start confirmation is startTask, not authorization", () => {
	const parsed = validatePublicInput("createTask", createTaskInput()) as Record<string, unknown>;
	assert.equal(JSON.stringify(parsed).includes("requiredRoleRef"), false);
	assert.equal(JSON.stringify(parsed).includes("authorizedByRef"), false);
	assert.equal((publicOperationNames as readonly string[]).includes("authorizeTask"), false);
});
