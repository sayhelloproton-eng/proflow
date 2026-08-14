import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
	createTaskServices,
	publicOperationNames,
	validatePublicInput,
} from "../src/index.ts";

const FIXED_PACKAGES = [
	"@tomflow/proflow-agent-product",
	"@tomflow/proflow-agent-controller-dev",
	"@tomflow/proflow-agent-test-ops",
] as const;

const CURRENT_OPERATIONS = [
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

function surface() {
	const unavailable = () => {
		throw new Error("not used by surface inspection");
	};
	return createTaskServices({
		store: { read: unavailable, transaction: unavailable },
		workspaceRoot: "/unused",
	});
}

function newTaskInput() {
	return {
		title: "Task Journey fixture",
		objective: "Prove Extension-first Task ownership",
		plan: {
			nodes: [
				{
					nodeId: "node-dev",
					title: "Develop",
					objective: "Implement",
					requiredAgentPackageRef: FIXED_PACKAGES[1],
					inputDocuments: ["REQUIREMENT"],
					outputDocuments: ["TECHNICAL_DESIGN"],
				},
			],
		},
		initialDocuments: [
			{ documentType: "REQUIREMENT", content: "Current requirement" },
		],
		roleBindings: FIXED_PACKAGES.map((agentPackageRef, index) => ({
			agentPackageRef,
			roleRef: ["g-product", "g-dev", "g-test"][index],
			workerRef: null,
			conversationLocator: null,
		})),
		actorRef: "extension:new-task",
		idempotencyKey: "idem:new-task",
	};
}

test("CP-TASK-ORCH-09 createTask is Extension-first, PENDING-compatible and keyed by fixed agentPackageRef bindings", () => {
	const parsed = validatePublicInput("createTask", newTaskInput());
	assert.deepEqual(parsed, newTaskInput());
	assert.equal(JSON.stringify(parsed).includes("requiredRoleRef"), false);
	assert.equal(JSON.stringify(parsed).includes("authorizedByRef"), false);
	assert.equal(JSON.stringify(parsed).includes("authorizedAt"), false);
});

test("CP-TASK-ORCH-10 v1 has no authorizeTask or persisted Task approval/authorization surface", async () => {
	assert.deepEqual(publicOperationNames, CURRENT_OPERATIONS);
	assert.equal(publicOperationNames.includes("authorizeTask" as never), false);
	const services = surface();
	assert.equal("authorizeTask" in services.commands, false);
	const modelSource = await readFile(new URL("../src/model.ts", import.meta.url), "utf8");
	const serviceSource = await readFile(new URL("../src/services.ts", import.meta.url), "utf8");
	assert.doesNotMatch(modelSource, /authorizedByRef|authorizedAt|APPROVAL_PENDING/);
	assert.doesNotMatch(serviceSource, /TASK_AUTHORIZED|authorizeTask/);
});

test("CP-TASK-ORCH-11 Task Observer receives a bounded read-only drive projection and cannot mutate Task through it", () => {
	assert.equal(publicOperationNames.includes("getTaskDriveProjection" as never), true);
	const services = surface();
	assert.equal("getTaskDriveProjection" in services.queries, true);
	assert.equal("getTaskDriveProjection" in services.commands, false);
	assert.equal("getTaskDriveProjection" in services.documents, false);
});

test("CP-TASK-ORCH-12 async Execution/Collaboration/Carrier pending is not a hidden Task WAIT command", async () => {
	const contractSource = await readFile(new URL("../src/contracts.ts", import.meta.url), "utf8");
	for (const forbidden of [
		"executionResultPending",
		"peerReplyPending",
		"carrierDeliveryPending",
		"waitForExecution",
		"waitForPeer",
		"waitForCarrier",
	]) {
		assert.doesNotMatch(contractSource, new RegExp(forbidden, "i"));
	}
	assert.equal(publicOperationNames.includes("waitNode"), true);
});

test("CP-TASK-ORCH-13 reopen/terminal contracts preserve stable Task binding semantics and stop-driving is a projection concern", async () => {
	const contractSource = await readFile(new URL("../src/contracts.ts", import.meta.url), "utf8");
	const modelSource = await readFile(new URL("../src/model.ts", import.meta.url), "utf8");
	assert.match(`${contractSource}\n${modelSource}`, /agentPackageRef/);
	assert.match(`${contractSource}\n${modelSource}`, /conversationLocator/);
	assert.doesNotMatch(`${contractSource}\n${modelSource}`, /frameId|persistentTabId|taskDriverState/);
	assert.equal(publicOperationNames.includes("reopenNode"), true);
	assert.equal(publicOperationNames.includes("getTaskDriveProjection" as never), true);
});
