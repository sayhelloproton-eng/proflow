import assert from "node:assert/strict";
import { test } from "node:test";

import type {
	ExecuteCapabilityRequest,
	ExecutionRecord,
} from "@tomflow/proflow-execution-contracts";
import { createExecutionBrowserTaskDriver } from "../src/task-driver.ts";

function fixture() {
	let task = {
		taskId: "task:driver",
		status: "READY",
		version: 2,
		currentNodeId: null as string | null,
		roleBindings: [
			{ roleRef: "g-dev", workerRef: null as string | null },
			{ roleRef: "g-test", workerRef: null as string | null },
		],
	};
	let node = {
		nodeId: "node:dev",
		status: "READY",
		version: 2,
		runNo: 1,
		requiredRoleRef: "g-dev",
		workerRef: null as string | null,
	};
	const executed: ExecuteCapabilityRequest[] = [];
	const driver = createExecutionBrowserTaskDriver({
		task: {
			async getTask() {
				return structuredClone(task);
			},
			async getNodeContext() {
				return {
					task: {
						taskId: task.taskId,
						status: task.status,
						version: task.version,
					},
					node: structuredClone(node),
				};
			},
			async startTask() {
				task = {
					...task,
					status: "ACTIVE",
					version: task.version + 1,
					currentNodeId: node.nodeId,
				};
				return task;
			},
			async startNode() {
				node = {
					...node,
					status: "IN_PROGRESS",
					version: node.version + 1,
					workerRef: "c-dev",
				};
				task = { ...task, version: task.version + 1 };
				return node;
			},
		},
		identity: {
			async getRegisteredRole(roleRef) {
				return { roleRef };
			},
		},
		execution: {
			async executeCapability(request) {
				executed.push(request);
				if (request.capability === "worker.create") {
					const workerRef =
						request.input.roleRef === "g-dev" ? "c-dev" : "c-test";
					task.roleBindings = task.roleBindings.map((binding) =>
						binding.roleRef === request.input.roleRef
							? { ...binding, workerRef }
							: binding,
					);
					task = { ...task, version: task.version + 1 };
					return {
						contract: "execution",
						contractVersion: "1.0.0",
						executionRef: `execution:${request.input.roleRef}`,
						status: "SUCCEEDED",
						sideEffectState: "APPLIED",
						callerRef: request.callerRef,
						capability: request.capability,
						idempotencyKey: request.idempotencyKey,
						inputFingerprint: `sha256:${"a".repeat(64)}`,
						retryable: false,
						evidence: [],
						attemptCount: 1,
						createdAt: "2026-08-13T00:00:00.000Z",
						updatedAt: "2026-08-13T00:00:00.000Z",
						result: {
							capability: "worker.create",
							data: {
								roleRef: request.input.roleRef,
								workerRef,
								conversationUrl: `https://chatgpt.com/g/${request.input.roleRef}/c/${workerRef}`,
								verified: true,
							},
						},
					} as ExecutionRecord;
				}
				return {
					contract: "execution",
					contractVersion: "1.0.0",
					executionRef: "execution:wake",
					status: "SUCCEEDED",
					sideEffectState: "APPLIED",
					callerRef: request.callerRef,
					capability: request.capability,
					idempotencyKey: request.idempotencyKey,
					inputFingerprint: `sha256:${"b".repeat(64)}`,
					retryable: false,
					evidence: [],
					attemptCount: 1,
					createdAt: "2026-08-13T00:00:00.000Z",
					updatedAt: "2026-08-13T00:00:00.000Z",
					result: {
						capability: "worker.wake",
						data: {
							roleRef: "g-dev",
							workerRef: "c-dev",
							triggerFingerprint: "wake:task:driver:node:dev:1",
							delivered: true,
						},
					},
				} as ExecutionRecord;
			},
		},
		roleUrl: (roleRef) => `https://chatgpt.com/g/${roleRef}`,
	});
	return { driver, executed, task: () => task, node: () => node };
}

test("Task Driver plans and applies only missing real Worker CREATE operations", async () => {
	const value = fixture();
	const plan = await value.driver.planProvision("task:driver");
	assert.deepEqual(
		plan.requests.map((request) => request.capability),
		["worker.create", "worker.create"],
	);
	await value.driver.applyProvision({
		plan,
		approvalRefs: { "g-dev": "approval:dev", "g-test": "approval:test" },
	});
	assert.deepEqual(
		value.task().roleBindings.map((binding) => binding.workerRef),
		["c-dev", "c-test"],
	);
	assert.deepEqual(
		(await value.driver.planProvision("task:driver")).requests,
		[],
	);
});

test("Task Driver starts Task and Node before one minimal idempotent WAKE", async () => {
	const value = fixture();
	const provision = await value.driver.planProvision("task:driver");
	await value.driver.applyProvision({
		plan: provision,
		approvalRefs: { "g-dev": "approval:dev", "g-test": "approval:test" },
	});
	await value.driver.startTask("task:driver");
	const wake = await value.driver.planNodeWake("task:driver");
	assert.match(wake.request.input.trigger, /^NODE_READY task=/);
	assert.doesNotMatch(
		wake.request.input.trigger,
		/Requirement|PRD|TaskDocument/,
	);
	const record = await value.driver.applyNodeWake({
		plan: wake,
		approvalRef: "approval:wake",
	});
	assert.equal(value.node().status, "IN_PROGRESS");
	assert.equal(record.status, "SUCCEEDED");
	assert.equal(value.executed.at(-1)?.capability, "worker.wake");
});

test("Task Driver rejects stale operator plans before any effect", async () => {
	const value = fixture();
	const plan = await value.driver.planProvision("task:driver");
	plan.requests.pop();
	await assert.rejects(
		() =>
			value.driver.applyProvision({
				plan,
				approvalRefs: { "g-dev": "approval:dev" },
			}),
		/PROVISION_PLAN_STALE/,
	);
	assert.equal(value.executed.length, 0);
});
