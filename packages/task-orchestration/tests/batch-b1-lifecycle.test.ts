import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { applyMigrations } from "@tomflow/proflow-task-migration-runner";
import {
	SqliteTaskStore,
	taskMigrations,
} from "@tomflow/proflow-task-store-sqlite";
import {
	createTaskServices,
	type TaskRepositories,
	type TaskResult,
	validatePublicInput,
} from "../src/index.ts";

const execFileAsync = promisify(execFile);
const packages = {
	product: "@tomflow/proflow-agent-product",
	dev: "@tomflow/proflow-agent-controller-dev",
	test: "@tomflow/proflow-agent-test-ops",
} as const;

function ok<T>(result: TaskResult<T>): T {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.data;
}

function errorCode(result: TaskResult<unknown>): string {
	if (result.ok) throw new Error("expected failure");
	return result.error.code;
}

async function runningFixture(context: { after(fn: () => unknown): void }) {
	const root = await mkdtemp(join(tmpdir(), "proflow-b1-task-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	await execFileAsync("git", ["init", "-q"], { cwd: root });
	const databasePath = join(root, ".proflow", "state", "task.sqlite");
	assert.equal(
		applyMigrations({ databasePath, migrations: taskMigrations }).ok,
		true,
	);
	const store = new SqliteTaskStore({ databasePath });
	context.after(() => store.close());
	let tick = 0;
	const services = createTaskServices({
		store,
		workspaceRoot: root,
		now: () => `2026-09-06T01:00:${String(tick++).padStart(2, "0")}.000Z`,
		createId: (prefix) => `${prefix}:${tick}`,
	});
	const taskId = "task:b1";
	const created = ok(
		services.commands.createTask({
			taskId,
			title: "Batch B1 lifecycle",
			objective: "Prove business-only wait and safe recovery",
			plan: {
				nodes: [
					{
						nodeId: "node:dev",
						title: "Dev",
						objective: "Implement",
						requiredAgentPackageRef: packages.dev,
						inputDocuments: ["REQUIREMENT"],
						outputDocuments: [],
					},
					{
						nodeId: "node:test",
						title: "Test",
						objective: "Verify",
						requiredAgentPackageRef: packages.test,
						inputDocuments: ["REQUIREMENT"],
						outputDocuments: [],
					},
				],
			},
			initialDocuments: [{ documentType: "REQUIREMENT", content: "# Ready\n" }],
			roleBindings: [
				{
					agentPackageRef: packages.product,
					roleRef: "g-product",
					workerRef: null,
					conversationLocator: null,
				},
				{
					agentPackageRef: packages.dev,
					roleRef: "g-dev",
					workerRef: null,
					conversationLocator: null,
				},
				{
					agentPackageRef: packages.test,
					roleRef: "g-test",
					workerRef: null,
					conversationLocator: null,
				},
			],
			actorRef: "extension:human",
			idempotencyKey: "b1:create",
		}),
	);
	let taskVersion = created.version;
	for (const [agentPackageRef, roleRef, workerRef] of [
		[packages.product, "g-product", "c-product"],
		[packages.dev, "g-dev", "c-dev"],
		[packages.test, "g-test", "c-test"],
	] as const) {
		const bound = ok(
			services.commands.bindTaskWorker({
				taskId,
				agentPackageRef,
				roleRef,
				workerRef,
				conversationLocator: `https://chatgpt.com/g/${roleRef}/c/${workerRef}`,
				expectedTaskVersion: taskVersion,
				actorRef: "platform-host:worker-provisioning",
				idempotencyKey: `b1:bind:${roleRef}`,
			}),
		);
		taskVersion = bound.version;
	}
	const started = ok(
		services.commands.startTask({
			taskId,
			expectedTaskVersion: taskVersion,
			actorRef: "extension:human",
			idempotencyKey: "b1:start-task",
		}),
	);
	const beforeNode = store.read((tx: TaskRepositories) =>
		tx.nodes.get("node:dev"),
	);
	assert.ok(beforeNode);
	const running = ok(
		services.commands.startNode({
			taskId,
			nodeId: "node:dev",
			expectedTaskVersion: started.version,
			expectedNodeVersion: beforeNode.version,
			actorRef: "worker:c-dev",
			idempotencyKey: "b1:start-node",
		}),
	);
	return { services, store, taskId, running };
}

test("B1-TASK-01 technical wait type is rejected with zero side effect and business wait types are contract-valid", async (context) => {
	const { services, store, taskId, running } = await runningFixture(context);
	const before = store.read((tx: TaskRepositories) => ({
		task: tx.tasks.get(taskId),
		node: tx.nodes.get("node:dev"),
		messages: tx.messages.listPending(),
		events: tx.events.listByTask(taskId),
	}));
	const rejected = services.commands.waitNode({
		taskId,
		nodeId: "node:dev",
		expectedTaskVersion: running.taskVersion,
		expectedNodeVersion: running.nodeVersion,
		actorRef: "worker:c-dev",
		idempotencyKey: "b1:wait:technical",
		waitType: "EXECUTION_GATEWAY_FAILURE",
		reasonCode: "EXECUTION_GATEWAY_FAILURE",
		message: "technical transport failure",
	});
	assert.equal(errorCode(rejected), "INVALID_REQUEST");
	assert.deepEqual(
		store.read((tx: TaskRepositories) => ({
			task: tx.tasks.get(taskId),
			node: tx.nodes.get("node:dev"),
			messages: tx.messages.listPending(),
			events: tx.events.listByTask(taskId),
		})),
		before,
	);
	for (const waitType of [
		"BUSINESS_CONFIRMATION",
		"REQUIREMENT_BLOCKED",
		"EXTERNAL_BUSINESS_DEPENDENCY",
	] as const)
		assert.doesNotThrow(() =>
			validatePublicInput("waitNode", {
				taskId,
				nodeId: "node:dev",
				expectedTaskVersion: running.taskVersion,
				expectedNodeVersion: running.nodeVersion,
				actorRef: "worker:c-dev",
				idempotencyKey: `b1:contract:${waitType}`,
				waitType,
				reasonCode: "BUSINESS_BLOCKER",
				message: "blocked",
			}),
		);
});

test("B1-TASK-02 WAITING resume requires acknowledged blocker and preserves the same run identity", async (context) => {
	const { services, store, taskId, running } = await runningFixture(context);
	const startedAt = running.startedAt;
	const waiting = ok(
		services.commands.waitNode({
			taskId,
			nodeId: "node:dev",
			expectedTaskVersion: running.taskVersion,
			expectedNodeVersion: running.nodeVersion,
			actorRef: "worker:c-dev",
			idempotencyKey: "b1:wait:business",
			waitType: "BUSINESS_CONFIRMATION",
			reasonCode: "PRODUCT_DECISION_REQUIRED",
			message: "Choose one business option",
		}),
	);
	assert.equal(
		errorCode(
			services.commands.resumeTask({
				taskId,
				expectedTaskVersion: waiting.version,
				actorRef: "extension:human",
				idempotencyKey: "b1:resume:blocked",
			}),
		),
		"TASK_BLOCKER_UNRESOLVED",
	);
	const pending = ok(services.queries.listPendingMessages({ taskId })).messages;
	assert.equal(pending.length, 1);
	const pendingMessage = pending[0];
	assert.ok(pendingMessage);
	ok(
		services.commands.acknowledgeMessage({
			messageId: pendingMessage.messageId,
			resolution: "Use option A",
			actorRef: "extension:human",
			idempotencyKey: "b1:ack",
		}),
	);
	const resumed = ok(
		services.commands.resumeTask({
			taskId,
			expectedTaskVersion: waiting.version,
			actorRef: "extension:human",
			idempotencyKey: "b1:resume",
		}),
	);
	assert.equal(resumed.status, "ACTIVE");
	const node = store.read((tx: TaskRepositories) => tx.nodes.get("node:dev"));
	assert.ok(node);
	assert.equal(node.status, "IN_PROGRESS");
	assert.equal(node.runNo, 1);
	assert.equal(node.workerRef, "c-dev");
	assert.equal(node.startedAt, startedAt);
	const resumeProjection = ok(
		services.queries.getTaskDriveProjection({ taskId }),
	);
	assert.match(resumeProjection.resumeSignalRef ?? "", /^task-event:\d+$/);
	const resumeEvent = ok(services.queries.listTaskEvents({ taskId })).events.find(
		(event) => event.eventType === "TASK_RESUMED",
	);
	assert.ok(resumeEvent?.eventId);
	assert.equal(resumeProjection.resumeSignalRef, `task-event:${resumeEvent.eventId}`);
	assert.equal(resumeEvent.taskVersion, resumed.version);
});

test("B1-TASK-03 wait/fail require the exact current running Worker; FAILED reopens as runNo+1 while WAITING cannot reopen", async (context) => {
	const { services, store, taskId, running } = await runningFixture(context);
	assert.equal(
		errorCode(
			services.commands.waitNode({
				taskId,
				nodeId: "node:test",
				expectedTaskVersion: running.taskVersion,
				expectedNodeVersion: 1,
				actorRef: "worker:c-test",
				idempotencyKey: "b1:wait:non-current",
				waitType: "REQUIREMENT_BLOCKED",
				reasonCode: "REQUIREMENT_INCOMPLETE",
				message: "Requirement is incomplete",
			}),
		),
		"NODE_NOT_CURRENT",
	);
	assert.equal(
		errorCode(
			services.commands.failNode({
				taskId,
				nodeId: "node:dev",
				expectedTaskVersion: running.taskVersion,
				expectedNodeVersion: running.nodeVersion,
				actorRef: "worker:c-test",
				idempotencyKey: "b1:fail:wrong-worker",
				errorCode: "CREDIBLE_TEST_FAILURE",
				errorMessage: "failed",
				retryable: true,
			}),
		),
		"WORKER_MISMATCH",
	);
	const failed = ok(
		services.commands.failNode({
			taskId,
			nodeId: "node:dev",
			expectedTaskVersion: running.taskVersion,
			expectedNodeVersion: running.nodeVersion,
			actorRef: "worker:c-dev",
			idempotencyKey: "b1:fail:current-worker",
			errorCode: "CREDIBLE_RUN_FAILURE",
			errorMessage: "current run conclusively failed",
			retryable: true,
		}),
	);
	assert.equal(failed.status, "FAILED");
	assert.equal(
		errorCode(
			services.commands.pauseTask({
				taskId,
				reason: "FAILED already stops the run",
				expectedTaskVersion: failed.version,
				actorRef: "extension:human",
				idempotencyKey: "b1:pause:failed-reject",
			}),
		),
		"TASK_INVALID_STATE",
	);
	assert.equal(
		store.read((tx: TaskRepositories) => tx.tasks.get(taskId))?.status,
		"FAILED",
	);
	const reopened = ok(
		services.commands.reopenNode({
			taskId,
			nodeId: "node:dev",
			reason: "Human-authorized retry",
			expectedTaskVersion: failed.version,
			actorRef: "extension:human",
			idempotencyKey: "b1:reopen",
		}),
	);
	assert.equal(reopened.status, "READY");
	assert.equal(reopened.runNo, 2);

	const second = await runningFixture(context);
	const waiting = ok(
		second.services.commands.waitNode({
			taskId: second.taskId,
			nodeId: "node:dev",
			expectedTaskVersion: second.running.taskVersion,
			expectedNodeVersion: second.running.nodeVersion,
			actorRef: "worker:c-dev",
			idempotencyKey: "b1:wait:reopen-reject",
			waitType: "EXTERNAL_BUSINESS_DEPENDENCY",
			reasonCode: "VENDOR_DECISION_PENDING",
			message: "Await vendor decision",
		}),
	);
	const waitingNode = second.store.read((tx: TaskRepositories) =>
		tx.nodes.get("node:dev"),
	);
	assert.ok(waitingNode);
	assert.equal(
		errorCode(
			second.services.commands.failNode({
				taskId: second.taskId,
				nodeId: "node:dev",
				expectedTaskVersion: waiting.version,
				expectedNodeVersion: waitingNode.version,
				actorRef: "worker:c-dev",
				idempotencyKey: "b1:fail:waiting-reject",
				errorCode: "TECHNICAL_TRANSIENT_MUST_NOT_OVERRIDE_WAITING",
				errorMessage: "business blocker is still authoritative",
				retryable: true,
			}),
		),
		"TASK_INVALID_STATE",
	);
	assert.equal(
		second.store.read((tx: TaskRepositories) => tx.tasks.get(second.taskId))
			?.status,
		"WAITING",
	);
	assert.equal(
		errorCode(
			second.services.commands.reopenNode({
				taskId: second.taskId,
				nodeId: "node:dev",
				reason: "must not bypass blocker",
				expectedTaskVersion: waiting.version,
				actorRef: "extension:human",
				idempotencyKey: "b1:reopen:waiting",
			}),
		),
		"NODE_INVALID_STATE",
	);
});
