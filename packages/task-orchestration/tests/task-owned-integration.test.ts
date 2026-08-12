import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
	type TaskResult,
	type TaskStore,
} from "../src/index.ts";

const execFileAsync = promisify(execFile);

function ok<T>(result: TaskResult<T>): T {
	if (!result.ok) throw new Error(JSON.stringify(result));
	return result.data;
}

function errorCode(result: TaskResult<unknown>): string {
	if (result.ok) throw new Error(JSON.stringify(result));
	return result.error.code;
}

async function fixture(context: { after: (fn: () => unknown) => void }) {
	const root = await mkdtemp(join(tmpdir(), "proflow-task-domain-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	await execFileAsync("git", ["init", "-q"], { cwd: root });
	const databasePath = join(root, ".proflow", "state", "task.sqlite");
	assert.equal(
		applyMigrations({ databasePath, migrations: taskMigrations }).ok,
		true,
	);
	const store = new SqliteTaskStore({ databasePath, busyTimeoutMs: 2_500 });
	context.after(() => store.close());
	let id = 0;
	let tick = 0;
	const services = createTaskServices({
		store,
		workspaceRoot: root,
		now: () => `2026-08-13T00:00:${String(tick++).padStart(2, "0")}.000Z`,
		createId: (prefix) => `${prefix}-${++id}`,
	});
	return { root, databasePath, store, services };
}

function taskInput(taskId = "task-1") {
	return {
		taskId,
		title: "Build durable task",
		objective: "Prove the Task owner",
		plan: {
			nodes: [
				{
					nodeId: `${taskId}-product`,
					title: "Product",
					objective: "Write PRD",
					requiredRoleRef: "role:product",
					inputDocuments: ["REQUIREMENT"],
					outputDocuments: ["PRD"],
				},
				{
					nodeId: `${taskId}-dev`,
					title: "Development",
					objective: "Write design",
					requiredRoleRef: "role:dev",
					inputDocuments: ["REQUIREMENT", "PRD"],
					outputDocuments: ["TECHNICAL_DESIGN"],
				},
			],
		},
		initialDocuments: [
			{ documentType: "REQUIREMENT", content: "# Requirement\n" },
		],
		roleBindings: [
			{ roleRef: "role:product", workerRef: "worker:product" },
			{ roleRef: "role:dev", workerRef: null },
		],
		actorRef: "actor:product",
		idempotencyKey: `idem:create:${taskId}`,
	};
}

test("CP-TASK-ORCH-03 binding is one-time and startNode resolves the stable worker automatically", async (context) => {
	const { services } = await fixture(context);
	const created = ok(services.commands.createTask(taskInput()));
	const authorized = ok(
		services.commands.authorizeTask({
			taskId: created.taskId,
			expectedTaskVersion: created.version,
			actorRef: "human:operator",
			idempotencyKey: "idem:authorize",
		}),
	);
	const bound = ok(
		services.commands.bindTaskWorker({
			taskId: created.taskId,
			roleRef: "role:dev",
			workerRef: "worker:dev",
			expectedTaskVersion: authorized.version,
			actorRef: "actor:provisioner",
			idempotencyKey: "idem:bind",
		}),
	);
	const replay = ok(
		services.commands.bindTaskWorker({
			taskId: created.taskId,
			roleRef: "role:dev",
			workerRef: "worker:dev",
			expectedTaskVersion: bound.version,
			actorRef: "actor:provisioner",
			idempotencyKey: "idem:bind:replay",
		}),
	);
	assert.equal(replay.version, bound.version);
	assert.equal(
		errorCode(
			services.commands.bindTaskWorker({
				taskId: created.taskId,
				roleRef: "role:dev",
				workerRef: "worker:different",
				expectedTaskVersion: bound.version,
				actorRef: "actor:provisioner",
				idempotencyKey: "idem:bind:conflict",
			}),
		),
		"TASK_ROLE_BINDING_CONFLICT",
	);
	const startTaskInput = {
		taskId: created.taskId,
		expectedTaskVersion: bound.version,
		actorRef: "actor:driver",
		idempotencyKey: "idem:start-task",
	};
	const startTaskResult = services.commands.startTask(startTaskInput);
	const startedTask = ok(startTaskResult);
	assert.deepEqual(
		services.commands.startTask(startTaskInput),
		startTaskResult,
	);
	const startNodeInput = {
		taskId: created.taskId,
		nodeId: `${created.taskId}-product`,
		expectedTaskVersion: startedTask.version,
		expectedNodeVersion: 2,
		actorRef: "actor:driver",
		idempotencyKey: "idem:start-node",
	};
	const startNodeResult = services.commands.startNode(startNodeInput);
	const startedNode = ok(startNodeResult);
	assert.deepEqual(
		services.commands.startNode(startNodeInput),
		startNodeResult,
	);
	assert.equal(startedNode.workerRef, "worker:product");
});

test("CP-TASK-ORCH-04 stale, duplicate, and fingerprint conflict paths have zero partial writes", async (context) => {
	const { services } = await fixture(context);
	const created = ok(services.commands.createTask(taskInput("task-idem")));
	const input = {
		taskId: created.taskId,
		expectedTaskVersion: created.version,
		actorRef: "human:operator",
		idempotencyKey: "idem:authorize:idempotent",
	};
	const first = services.commands.authorizeTask(input);
	const replay = services.commands.authorizeTask(input);
	assert.deepEqual(replay, first);
	assert.equal(
		errorCode(
			services.commands.authorizeTask({
				...input,
				actorRef: "human:different",
			}),
		),
		"IDEMPOTENCY_CONFLICT",
	);
	const before = ok(services.queries.getTask({ taskId: created.taskId }));
	assert.equal(
		errorCode(
			services.commands.pauseTask({
				taskId: created.taskId,
				reason: "stale",
				expectedTaskVersion: created.version,
				actorRef: "human:operator",
				idempotencyKey: "idem:stale",
			}),
		),
		"TASK_VERSION_CONFLICT",
	);
	assert.deepEqual(
		ok(services.queries.getTask({ taskId: created.taskId })),
		before,
	);
	const disposable = ok(
		services.commands.createTask(taskInput("task-terminate")),
	);
	const terminated = ok(
		services.commands.terminateTask({
			taskId: disposable.taskId,
			reason: "cancel",
			expectedTaskVersion: disposable.version,
			actorRef: "human:operator",
			idempotencyKey: "idem:terminate",
		}),
	);
	assert.equal(terminated.status, "TERMINATED");
	assert.equal(
		ok(services.queries.getTask({ taskId: disposable.taskId })).nodes.every(
			(item) => item.status === "TERMINATED",
		),
		true,
	);
});

test("CP-TASK-ORCH-05 reopen preserves history/binding/documents/events and starts a new run", async (context) => {
	const { services } = await fixture(context);
	let task = ok(services.commands.createTask(taskInput("task-reopen")));
	task = ok(
		services.commands.authorizeTask({
			taskId: task.taskId,
			expectedTaskVersion: task.version,
			actorRef: "human:operator",
			idempotencyKey: "idem:authorize:reopen",
		}),
	);
	task = ok(
		services.commands.bindTaskWorker({
			taskId: task.taskId,
			roleRef: "role:dev",
			workerRef: "worker:dev",
			expectedTaskVersion: task.version,
			actorRef: "actor:provisioner",
			idempotencyKey: "idem:bind:reopen",
		}),
	);
	task = ok(
		services.commands.startTask({
			taskId: task.taskId,
			expectedTaskVersion: task.version,
			actorRef: "actor:driver",
			idempotencyKey: "idem:start:reopen",
		}),
	);
	let node = ok(
		services.commands.startNode({
			taskId: task.taskId,
			nodeId: "task-reopen-product",
			expectedTaskVersion: task.version,
			expectedNodeVersion: 2,
			actorRef: "actor:driver",
			idempotencyKey: "idem:start-node:reopen",
		}),
	);
	const document = ok(
		services.documents.putTaskDocument({
			taskId: task.taskId,
			nodeId: node.nodeId,
			documentType: "PRD",
			content: "# PRD\n",
			expectedTaskVersion: node.taskVersion,
			actorRef: "worker:product",
			idempotencyKey: "idem:prd:reopen",
		}),
	);
	node = ok(
		services.commands.completeNode({
			taskId: task.taskId,
			nodeId: node.nodeId,
			resultSummary: "done",
			expectedTaskVersion: document.taskVersion,
			expectedNodeVersion: node.nodeVersion,
			actorRef: "worker:product",
			idempotencyKey: "idem:complete:reopen",
		}),
	);
	assert.equal(
		errorCode(
			services.commands.reopenNode({
				taskId: task.taskId,
				nodeId: "missing-node",
				reason: "invalid",
				expectedTaskVersion: node.taskVersion,
				actorRef: "actor:controller",
				idempotencyKey: "idem:reopen:invalid",
			}),
		),
		"NODE_NOT_FOUND",
	);
	assert.equal(
		errorCode(
			services.commands.reopenNode({
				taskId: task.taskId,
				nodeId: "task-reopen-product",
				reason: "stale",
				expectedTaskVersion: node.taskVersion - 1,
				actorRef: "actor:controller",
				idempotencyKey: "idem:reopen:stale",
			}),
		),
		"TASK_VERSION_CONFLICT",
	);
	const reopenInput = {
		taskId: task.taskId,
		nodeId: "task-reopen-product",
		reason: "revise",
		expectedTaskVersion: node.taskVersion,
		actorRef: "actor:controller",
		idempotencyKey: "idem:reopen",
	};
	const reopenResult = services.commands.reopenNode(reopenInput);
	const reopened = ok(reopenResult);
	assert.deepEqual(services.commands.reopenNode(reopenInput), reopenResult);
	assert.equal(reopened.runNo, 2);
	assert.equal(reopened.workerRef, null);
	const view = ok(services.queries.getTask({ taskId: task.taskId }));
	assert.equal(view.currentNodeId, "task-reopen-product");
	assert.equal(view.nodes[1]?.status, "PENDING");
	assert.equal(
		view.roleBindings.find((item) => item.roleRef === "role:product")
			?.workerRef,
		"worker:product",
	);
	assert.equal(
		view.executionHistory.some((item) => item.nodeId === "task-reopen-product"),
		true,
	);
	assert.equal(
		ok(
			services.documents.getTaskDocument({
				taskId: task.taskId,
				documentType: "PRD",
			}),
		).content,
		"# PRD\n",
	);
	const events = ok(
		services.queries.listTaskEvents({ taskId: task.taskId }),
	).events;
	assert.equal(events.length > 0, true);
	const restarted = ok(
		services.commands.startNode({
			taskId: task.taskId,
			nodeId: "task-reopen-product",
			expectedTaskVersion: reopened.taskVersion,
			expectedNodeVersion: reopened.nodeVersion,
			actorRef: "actor:driver",
			idempotencyKey: "idem:restart:reopen",
		}),
	);
	assert.equal(restarted.workerRef, "worker:product");
});

test("CP-TASK-ORCH-06/08 real Markdown/Git context, output gate, safe path, hash, and reconciliation", async (context) => {
	const { root, store, services } = await fixture(context);
	let task = ok(services.commands.createTask(taskInput("task-doc")));
	const git = await execFileAsync(
		"git",
		["status", "--short", "--untracked-files=all", "--", ".proflow"],
		{ cwd: root },
	);
	assert.match(
		git.stdout,
		/\.proflow\/tasks\/task-doc\/documents\/requirement\.md/,
	);
	const requirement = ok(
		services.documents.getTaskDocument({
			taskId: task.taskId,
			documentType: "REQUIREMENT",
		}),
	);
	assert.equal(
		await readFile(join(root, requirement.path), "utf8"),
		"# Requirement\n",
	);
	assert.match(requirement.contentHash, /^sha256:[0-9a-f]{64}$/);
	assert.equal(
		errorCode(
			services.documents.putTaskDocument({
				taskId: task.taskId,
				nodeId: "task-doc-product",
				documentType: "../escape",
				content: "bad",
				expectedTaskVersion: task.version,
				actorRef: "actor:test",
				idempotencyKey: "idem:escape",
			}),
		),
		"DOCUMENT_TYPE_NOT_ALLOWED",
	);
	assert.equal(
		errorCode(
			services.documents.putTaskDocument({
				taskId: task.taskId,
				nodeId: "task-doc-product",
				documentType: "PRD",
				content: "bad",
				targetPath: "/tmp/escape.md",
				expectedTaskVersion: task.version,
				actorRef: "actor:test",
				idempotencyKey: "idem:absolute",
			}),
		),
		"INVALID_REQUEST",
	);
	task = ok(
		services.commands.authorizeTask({
			taskId: task.taskId,
			expectedTaskVersion: task.version,
			actorRef: "human:operator",
			idempotencyKey: "idem:doc:authorize",
		}),
	);
	task = ok(
		services.commands.bindTaskWorker({
			taskId: task.taskId,
			roleRef: "role:dev",
			workerRef: "worker:dev",
			expectedTaskVersion: task.version,
			actorRef: "actor:provisioner",
			idempotencyKey: "idem:doc:bind",
		}),
	);
	task = ok(
		services.commands.startTask({
			taskId: task.taskId,
			expectedTaskVersion: task.version,
			actorRef: "actor:driver",
			idempotencyKey: "idem:doc:start",
		}),
	);
	const started = ok(
		services.commands.startNode({
			taskId: task.taskId,
			nodeId: "task-doc-product",
			expectedTaskVersion: task.version,
			expectedNodeVersion: 2,
			actorRef: "actor:driver",
			idempotencyKey: "idem:doc:start-node",
		}),
	);
	assert.equal(
		errorCode(
			services.commands.completeNode({
				taskId: task.taskId,
				nodeId: started.nodeId,
				resultSummary: "missing",
				expectedTaskVersion: started.taskVersion,
				expectedNodeVersion: started.nodeVersion,
				actorRef: "worker:product",
				idempotencyKey: "idem:doc:missing",
			}),
		),
		"NODE_OUTPUT_MISSING",
	);
	const contextView = ok(
		services.queries.getNodeContext({
			taskId: task.taskId,
			nodeId: started.nodeId,
		}),
	);
	assert.deepEqual(
		contextView.documents.map((item) => item.documentType),
		["REQUIREMENT"],
	);

	let fail = true;
	const failingStore: TaskStore = {
		read: store.read.bind(store),
		transaction: (work) => {
			if (fail) {
				fail = false;
				throw new Error("injected index failure");
			}
			return store.transaction(work);
		},
	};
	const failingServices = createTaskServices({
		store: failingStore,
		workspaceRoot: root,
	});
	assert.equal(
		errorCode(
			failingServices.documents.putTaskDocument({
				taskId: task.taskId,
				nodeId: started.nodeId,
				documentType: "PRD",
				content: "# PRD recovered\n",
				expectedTaskVersion: started.taskVersion,
				actorRef: "worker:product",
				idempotencyKey: "idem:doc:failure",
			}),
		),
		"DOCUMENT_WRITE_FAILED",
	);
	assert.equal(
		ok(
			services.documents.reconcileDocumentIndex({
				taskId: task.taskId,
				actorRef: "actor:reconcile",
			}),
		).reconciled,
		1,
	);
	assert.equal(
		ok(
			services.documents.getTaskDocument({
				taskId: task.taskId,
				documentType: "PRD",
			}),
		).content,
		"# PRD recovered\n",
	);
});

test("CP-TASK-ORCH-07 TaskGroup blocks ACTIVE/WAITING/FAILED/PAUSED and releases only after success", async (context) => {
	const { services } = await fixture(context);
	const group = ok(
		services.commands.createTaskGroup({
			taskGroupId: "tg-1",
			title: "Chain",
			objective: "Serial",
			maxActiveTasks: 1,
			actorRef: "human:operator",
			idempotencyKey: "idem:group:create",
		}),
	);
	for (const [sequenceNo, taskId] of [
		[1, "task-group-1"],
		[2, "task-group-2"],
	] as const) {
		ok(
			services.commands.createTask({
				...taskInput(taskId),
				taskGroupId: group.taskGroupId,
				sequenceNo,
				plan: {
					nodes: [
						{
							nodeId: `${taskId}-node`,
							title: "Node",
							objective: "Finish",
							requiredRoleRef: "role:product",
							inputDocuments: ["REQUIREMENT"],
							outputDocuments: [],
						},
					],
				},
			}),
		);
	}
	assert.equal(
		errorCode(
			services.commands.startTaskGroup({
				taskGroupId: group.taskGroupId,
				expectedGroupVersion: group.version + 1,
				actorRef: "human:operator",
				idempotencyKey: "idem:group:stale",
			}),
		),
		"TASK_GROUP_VERSION_CONFLICT",
	);
	assert.equal(
		ok(services.queries.getTaskGroup({ taskGroupId: group.taskGroupId }))
			.status,
		"READY",
	);
	const activeGroup = ok(
		services.commands.startTaskGroup({
			taskGroupId: group.taskGroupId,
			expectedGroupVersion: group.version,
			actorRef: "human:operator",
			idempotencyKey: "idem:group:start",
		}),
	);
	assert.equal(activeGroup.status, "ACTIVE");
	let task = ok(
		services.commands.startTask({
			taskId: "task-group-1",
			expectedTaskVersion: 2,
			actorRef: "actor:driver",
			idempotencyKey: "idem:group:start-task",
		}),
	);
	const canStart = () =>
		ok(
			services.queries.listTasks({ taskGroupId: group.taskGroupId }),
		).tasks.find((item) => item.taskId === "task-group-2");
	assert.equal(canStart()?.canStart, false);
	let node = ok(
		services.commands.startNode({
			taskId: task.taskId,
			nodeId: "task-group-1-node",
			expectedTaskVersion: task.version,
			expectedNodeVersion: 2,
			actorRef: "actor:driver",
			idempotencyKey: "idem:group:start-node",
		}),
	);
	task = ok(
		services.commands.waitNode({
			taskId: task.taskId,
			nodeId: node.nodeId,
			waitType: "BUSINESS_CONFIRMATION",
			reasonCode: "WAIT",
			message: "wait",
			expectedTaskVersion: node.taskVersion,
			expectedNodeVersion: node.nodeVersion,
			actorRef: "worker:product",
			idempotencyKey: "idem:group:wait",
		}),
	);
	assert.equal(canStart()?.blockedReason, "PREDECESSOR_NOT_SUCCEEDED");
	const pendingMessages = ok(
		services.queries.listPendingMessages({ taskId: task.taskId }),
	).messages;
	assert.equal(pendingMessages.length, 1);
	const pendingMessage = pendingMessages[0];
	assert.ok(pendingMessage);
	ok(
		services.commands.acknowledgeMessage({
			messageId: pendingMessage.messageId,
			resolution: "continue",
			actorRef: "human:operator",
			idempotencyKey: "idem:group:ack",
		}),
	);
	assert.equal(
		ok(services.queries.getTask({ taskId: task.taskId })).status,
		"WAITING",
	);
	assert.equal(
		ok(services.queries.listPendingMessages({ taskId: task.taskId })).messages
			.length,
		0,
	);
	task = ok(
		services.commands.resumeTask({
			taskId: task.taskId,
			expectedTaskVersion: task.version,
			actorRef: "human:operator",
			idempotencyKey: "idem:group:resume",
		}),
	);
	const current = ok(services.queries.getTask({ taskId: task.taskId }))
		.nodes[0];
	assert.ok(current);
	task = ok(
		services.commands.failNode({
			taskId: task.taskId,
			nodeId: current.nodeId,
			errorCode: "EXECUTION_UNAVAILABLE",
			errorMessage: "down",
			retryable: true,
			expectedTaskVersion: task.version,
			expectedNodeVersion: current.version,
			actorRef: "actor:execution",
			idempotencyKey: "idem:group:fail",
		}),
	);
	assert.equal(canStart()?.canStart, false);
	task = ok(
		services.commands.pauseTask({
			taskId: task.taskId,
			reason: "pause",
			expectedTaskVersion: task.version,
			actorRef: "human:operator",
			idempotencyKey: "idem:group:pause",
		}),
	);
	assert.equal(canStart()?.canStart, false);
	const reopened = ok(
		services.commands.reopenNode({
			taskId: task.taskId,
			nodeId: current.nodeId,
			reason: "recover",
			expectedTaskVersion: task.version,
			actorRef: "human:operator",
			idempotencyKey: "idem:group:reopen",
		}),
	);
	node = ok(
		services.commands.startNode({
			taskId: task.taskId,
			nodeId: current.nodeId,
			expectedTaskVersion: reopened.taskVersion,
			expectedNodeVersion: reopened.nodeVersion,
			actorRef: "actor:driver",
			idempotencyKey: "idem:group:restart-node",
		}),
	);
	const completed = ok(
		services.commands.completeNode({
			taskId: task.taskId,
			nodeId: current.nodeId,
			resultSummary: "done",
			expectedTaskVersion: node.taskVersion,
			expectedNodeVersion: node.nodeVersion,
			actorRef: "worker:product",
			idempotencyKey: "idem:group:complete",
		}),
	);
	assert.equal(completed.taskStatus, "SUCCEEDED");
	assert.equal(canStart()?.canStart, true);
});

test("Task-owned happy path remains complete after SQLite store close and reopen", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-task-happy-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	await execFileAsync("git", ["init", "-q"], { cwd: root });
	const databasePath = join(root, ".proflow", "state", "task.sqlite");
	assert.equal(
		applyMigrations({ databasePath, migrations: taskMigrations }).ok,
		true,
	);
	let store = new SqliteTaskStore({ databasePath });
	let services = createTaskServices({ store, workspaceRoot: root });
	let task = ok(services.commands.createTask(taskInput("task-happy")));
	task = ok(
		services.commands.authorizeTask({
			taskId: task.taskId,
			expectedTaskVersion: task.version,
			actorRef: "human:operator",
			idempotencyKey: "happy:authorize",
		}),
	);
	task = ok(
		services.commands.bindTaskWorker({
			taskId: task.taskId,
			roleRef: "role:dev",
			workerRef: "worker:dev",
			expectedTaskVersion: task.version,
			actorRef: "actor:provisioner",
			idempotencyKey: "happy:bind",
		}),
	);
	task = ok(
		services.commands.startTask({
			taskId: task.taskId,
			expectedTaskVersion: task.version,
			actorRef: "actor:driver",
			idempotencyKey: "happy:start-task",
		}),
	);
	let node = ok(
		services.commands.startNode({
			taskId: task.taskId,
			nodeId: "task-happy-product",
			expectedTaskVersion: task.version,
			expectedNodeVersion: 2,
			actorRef: "actor:driver",
			idempotencyKey: "happy:start-product",
		}),
	);
	let document = ok(
		services.documents.putTaskDocument({
			taskId: task.taskId,
			nodeId: node.nodeId,
			documentType: "PRD",
			content: "# PRD\n",
			expectedTaskVersion: node.taskVersion,
			actorRef: "worker:product",
			idempotencyKey: "happy:prd",
		}),
	);
	const completeProductInput = {
		taskId: task.taskId,
		nodeId: node.nodeId,
		resultSummary: "product complete",
		expectedTaskVersion: document.taskVersion,
		expectedNodeVersion: node.nodeVersion,
		actorRef: "worker:product",
		idempotencyKey: "happy:complete-product",
	};
	const completeProductResult =
		services.commands.completeNode(completeProductInput);
	node = ok(completeProductResult);
	assert.deepEqual(
		services.commands.completeNode(completeProductInput),
		completeProductResult,
	);
	node = ok(
		services.commands.startNode({
			taskId: task.taskId,
			nodeId: "task-happy-dev",
			expectedTaskVersion: node.taskVersion,
			expectedNodeVersion: 2,
			actorRef: "actor:driver",
			idempotencyKey: "happy:start-dev",
		}),
	);
	document = ok(
		services.documents.putTaskDocument({
			taskId: task.taskId,
			nodeId: node.nodeId,
			documentType: "TECHNICAL_DESIGN",
			content: "# Design\n",
			expectedTaskVersion: node.taskVersion,
			actorRef: "worker:dev",
			idempotencyKey: "happy:design",
		}),
	);
	const completed = ok(
		services.commands.completeNode({
			taskId: task.taskId,
			nodeId: node.nodeId,
			resultSummary: "development complete",
			expectedTaskVersion: document.taskVersion,
			expectedNodeVersion: node.nodeVersion,
			actorRef: "worker:dev",
			idempotencyKey: "happy:complete-dev",
		}),
	);
	assert.equal(completed.taskStatus, "SUCCEEDED");
	store.close();
	store = new SqliteTaskStore({ databasePath });
	context.after(() => store.close());
	services = createTaskServices({ store, workspaceRoot: root });
	const recovered = ok(services.queries.getTask({ taskId: task.taskId }));
	assert.equal(recovered.status, "SUCCEEDED");
	assert.equal(recovered.currentNodeId, null);
	assert.deepEqual(
		recovered.nodes.map((item) => item.status),
		["SUCCEEDED", "SUCCEEDED"],
	);
	assert.equal(recovered.executionHistory.length, 2);
	assert.equal(
		recovered.roleBindings.every((item) => item.workerRef !== null),
		true,
	);
	assert.deepEqual(
		recovered.documents.map((item) => item.documentType),
		["PRD", "REQUIREMENT", "TECHNICAL_DESIGN"],
	);
});
