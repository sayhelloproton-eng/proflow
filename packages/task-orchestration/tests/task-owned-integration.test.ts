import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { applyMigrations } from "@tomflow/proflow-task-migration-runner";
import {
	SqliteTaskStore,
	taskMigrations,
} from "@tomflow/proflow-task-store-sqlite";
import { createTaskServices, type TaskResult } from "../src/index.ts";

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
		now: () => `2026-08-15T00:00:${String(tick++).padStart(2, "0")}.000Z`,
		createId: (prefix) => `${prefix}-${++id}`,
	});
	return { root, databasePath, store, services };
}

const PACKAGES = {
	product: "@tomflow/proflow-agent-product",
	dev: "@tomflow/proflow-agent-controller-dev",
	test: "@tomflow/proflow-agent-test-ops",
} as const;

const ROLES = {
	product: "g-product",
	dev: "g-dev",
	test: "g-test",
} as const;

function taskInput(taskId = "task-1") {
	return {
		taskId,
		title: "Build durable task",
		objective: "Prove the current Task owner contract",
		plan: {
			nodes: [
				{
					nodeId: `${taskId}-dev`,
					title: "Development",
					objective: "Write design",
					requiredAgentPackageRef: PACKAGES.dev,
					inputDocuments: ["REQUIREMENT"],
					outputDocuments: ["TECHNICAL_DESIGN"],
				},
				{
					nodeId: `${taskId}-test`,
					title: "Test",
					objective: "Verify result",
					requiredAgentPackageRef: PACKAGES.test,
					inputDocuments: ["REQUIREMENT", "TECHNICAL_DESIGN"],
					outputDocuments: ["TEST_RESULT"],
				},
			],
		},
		initialDocuments: [
			{ documentType: "REQUIREMENT", content: "# Requirement\n" },
		],
		roleBindings: [
			{
				agentPackageRef: PACKAGES.product,
				roleRef: ROLES.product,
				workerRef: null,
				conversationLocator: null,
			},
			{
				agentPackageRef: PACKAGES.dev,
				roleRef: ROLES.dev,
				workerRef: null,
				conversationLocator: null,
			},
			{
				agentPackageRef: PACKAGES.test,
				roleRef: ROLES.test,
				workerRef: null,
				conversationLocator: null,
			},
		],
		actorRef: "extension:new-task",
		idempotencyKey: `idem:create:${taskId}`,
	};
}

async function bindAll(
	services: ReturnType<typeof createTaskServices>,
	taskId: string,
	startVersion: number,
) {
	let version = startVersion;
	for (const [key, agentPackageRef, roleRef, workerRef] of [
		["product", PACKAGES.product, ROLES.product, "c-product"],
		["dev", PACKAGES.dev, ROLES.dev, "c-dev"],
		["test", PACKAGES.test, ROLES.test, "c-test"],
	] as const) {
		const result = ok(
			services.commands.bindTaskWorker({
				taskId,
				agentPackageRef,
				roleRef,
				workerRef,
				conversationLocator: `https://chatgpt.com/g/${roleRef}/c/${workerRef}`,
				expectedTaskVersion: version,
				actorRef: "platform-host:worker-provisioning",
				idempotencyKey: `idem:bind:${taskId}:${key}`,
			}),
		);
		version = result.version;
	}
	return version;
}

function nodeVersion(
	services: ReturnType<typeof createTaskServices>,
	taskId: string,
	nodeId: string,
): { taskVersion: number; nodeVersion: number } {
	const task = ok(services.queries.getTask({ taskId }));
	const node = task.nodes.find((item) => item.nodeId === nodeId);
	assert.ok(node);
	return { taskVersion: task.version, nodeVersion: node.version };
}

test("CP-TASK-ORCH-03 TaskRoleBinding is stable/idempotent and startNode resolves worker via requiredAgentPackageRef", async (context) => {
	const { services } = await fixture(context);
	const created = ok(services.commands.createTask(taskInput()));
	assert.equal(created.status, "PENDING");

	const first = ok(
		services.commands.bindTaskWorker({
			taskId: created.taskId,
			agentPackageRef: PACKAGES.dev,
			roleRef: ROLES.dev,
			workerRef: "c-dev",
			conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
			expectedTaskVersion: created.version,
			actorRef: "platform-host:worker-provisioning",
			idempotencyKey: "idem:bind:dev",
		}),
	);
	const replay = ok(
		services.commands.bindTaskWorker({
			taskId: created.taskId,
			agentPackageRef: PACKAGES.dev,
			roleRef: ROLES.dev,
			workerRef: "c-dev",
			conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
			expectedTaskVersion: first.version,
			actorRef: "platform-host:worker-provisioning",
			idempotencyKey: "idem:bind:dev:replay",
		}),
	);
	assert.equal(replay.version, first.version);
	assert.equal(
		errorCode(
			services.commands.bindTaskWorker({
				taskId: created.taskId,
				agentPackageRef: PACKAGES.dev,
				roleRef: ROLES.dev,
				workerRef: "c-dev-other",
				conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev-other",
				expectedTaskVersion: first.version,
				actorRef: "platform-host:worker-provisioning",
				idempotencyKey: "idem:bind:dev:conflict",
			}),
		),
		"TASK_ROLE_BINDING_CONFLICT",
	);

	let version = first.version;
	for (const [key, agentPackageRef, roleRef, workerRef] of [
		["product", PACKAGES.product, ROLES.product, "c-product"],
		["test", PACKAGES.test, ROLES.test, "c-test"],
	] as const) {
		version = ok(
			services.commands.bindTaskWorker({
				taskId: created.taskId,
				agentPackageRef,
				roleRef,
				workerRef,
				conversationLocator: `https://chatgpt.com/g/${roleRef}/c/${workerRef}`,
				expectedTaskVersion: version,
				actorRef: "platform-host:worker-provisioning",
				idempotencyKey: `idem:bind:${key}`,
			}),
		).version;
	}
	const ready = ok(services.queries.getTask({ taskId: created.taskId }));
	assert.equal(ready.status, "READY");
	const active = ok(
		services.commands.startTask({
			taskId: created.taskId,
			expectedTaskVersion: ready.version,
			actorRef: "human:operator",
			idempotencyKey: "idem:start",
		}),
	);
	const versions = nodeVersion(services, active.taskId, `${active.taskId}-dev`);
	const started = ok(
		services.commands.startNode({
			taskId: active.taskId,
			nodeId: `${active.taskId}-dev`,
			expectedTaskVersion: versions.taskVersion,
			expectedNodeVersion: versions.nodeVersion,
			actorRef: "worker:c-dev",
			idempotencyKey: "idem:start-node:dev",
		}),
	);
	assert.equal(started.workerRef, "c-dev");
});

test("CP-TASK-ORCH-04 stale, duplicate and same-key-different-fingerprint paths have zero partial writes", async (context) => {
	const { services } = await fixture(context);
	const input = taskInput("task-idem");
	const first = services.commands.createTask(input);
	assert.deepEqual(services.commands.createTask(input), first);
	const created = ok(first);
	assert.equal(
		errorCode(
			services.commands.createTask({
				...input,
				title: "different",
				idempotencyKey: input.idempotencyKey,
			}),
		),
		"IDEMPOTENCY_CONFLICT",
	);
	assert.equal(
		errorCode(
			services.commands.bindTaskWorker({
				taskId: created.taskId,
				agentPackageRef: PACKAGES.dev,
				roleRef: ROLES.dev,
				workerRef: "c-dev",
				conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
				expectedTaskVersion: created.version + 99,
				actorRef: "platform-host:worker-provisioning",
				idempotencyKey: "idem:stale",
			}),
		),
		"TASK_VERSION_CONFLICT",
	);
	assert.equal(ok(services.queries.getTask({ taskId: created.taskId })).version, created.version);
});

test("CP-TASK-ORCH-05 reopen preserves binding/conversation/history and increments runNo", async (context) => {
	const { services } = await fixture(context);
	const created = ok(services.commands.createTask(taskInput("task-reopen")));
	await bindAll(services, created.taskId, created.version);
	let task = ok(services.queries.getTask({ taskId: created.taskId }));
	task = ok(
		services.commands.startTask({
			taskId: task.taskId,
			expectedTaskVersion: task.version,
			actorRef: "human:operator",
			idempotencyKey: "reopen:start",
		}),
	);
	let versions = nodeVersion(services, task.taskId, `${task.taskId}-dev`);
	let node = ok(
		services.commands.startNode({
			taskId: task.taskId,
			nodeId: `${task.taskId}-dev`,
			expectedTaskVersion: versions.taskVersion,
			expectedNodeVersion: versions.nodeVersion,
			actorRef: "worker:c-dev",
			idempotencyKey: "reopen:start-node",
		}),
	);
	const doc = ok(
		services.documents.putTaskDocument({
			taskId: task.taskId,
			nodeId: node.nodeId,
			documentType: "TECHNICAL_DESIGN",
			content: "# Design\n",
			expectedTaskVersion: node.taskVersion,
			actorRef: "worker:c-dev",
			idempotencyKey: "reopen:doc",
		}),
	);
	const completed = ok(
		services.commands.completeNode({
			taskId: task.taskId,
			nodeId: node.nodeId,
			resultSummary: "done",
			expectedTaskVersion: doc.taskVersion,
			expectedNodeVersion: node.nodeVersion,
			actorRef: "worker:c-dev",
			idempotencyKey: "reopen:complete",
		}),
	);
	const before = ok(services.queries.getTask({ taskId: task.taskId }));
	const bindingBefore = before.roleBindings.find((binding) => binding.agentPackageRef === PACKAGES.dev);
	assert.ok(bindingBefore);
	const reopened = ok(
		services.commands.reopenNode({
			taskId: task.taskId,
			nodeId: node.nodeId,
			reason: "revise",
			expectedTaskVersion: completed.taskVersion,
			actorRef: "controller:c-dev",
			idempotencyKey: "reopen:command",
		}),
	);
	assert.equal(reopened.currentNodeId, node.nodeId);
	const after = ok(services.queries.getTask({ taskId: task.taskId }));
	const bindingAfter = after.roleBindings.find((binding) => binding.agentPackageRef === PACKAGES.dev);
	assert.deepEqual(bindingAfter, bindingBefore);
	const reopenedNode = after.nodes.find((item) => item.nodeId === node.nodeId);
	assert.ok(reopenedNode);
	assert.equal(reopenedNode.runNo, node.runNo + 1);
	assert.equal(reopenedNode.status, "READY");
	assert.equal(ok(services.queries.getTaskDocument({ taskId: task.taskId, documentType: "TECHNICAL_DESIGN" })).contentHash, doc.contentHash);
});

test("CP-TASK-ORCH-06 + CP-TASK-ORCH-08 TaskDocument remains canonical, safe, output-gated and hash-backed", async (context) => {
	const { services, root } = await fixture(context);
	const created = ok(services.commands.createTask(taskInput("task-doc")));
	await bindAll(services, created.taskId, created.version);
	let task = ok(services.queries.getTask({ taskId: created.taskId }));
	task = ok(
		services.commands.startTask({
			taskId: task.taskId,
			expectedTaskVersion: task.version,
			actorRef: "human:operator",
			idempotencyKey: "doc:start",
		}),
	);
	const versions = nodeVersion(services, task.taskId, `${task.taskId}-dev`);
	const node = ok(
		services.commands.startNode({
			taskId: task.taskId,
			nodeId: `${task.taskId}-dev`,
			expectedTaskVersion: versions.taskVersion,
			expectedNodeVersion: versions.nodeVersion,
			actorRef: "worker:c-dev",
			idempotencyKey: "doc:start-node",
		}),
	);
	assert.equal(
		errorCode(
			services.commands.completeNode({
				taskId: task.taskId,
				nodeId: node.nodeId,
				resultSummary: "missing design",
				expectedTaskVersion: node.taskVersion,
				expectedNodeVersion: node.nodeVersion,
				actorRef: "worker:c-dev",
				idempotencyKey: "doc:complete:missing",
			}),
		),
		"NODE_OUTPUT_MISSING",
	);
	const written = ok(
		services.documents.putTaskDocument({
			taskId: task.taskId,
			nodeId: node.nodeId,
			documentType: "TECHNICAL_DESIGN",
			content: "# Design\n",
			expectedTaskVersion: node.taskVersion,
			actorRef: "worker:c-dev",
			idempotencyKey: "doc:put",
		}),
	);
	assert.match(written.path, /^\.proflow\/tasks\//);
	assert.equal((await stat(join(root, written.path))).isFile(), true);
	assert.match(written.contentHash, /^sha256:/);
	assert.equal(
		(await readFile(join(root, written.path), "utf8")),
		"# Design\n",
	);
	assert.equal(
		errorCode(
			services.documents.putTaskDocument({
				taskId: task.taskId,
				nodeId: node.nodeId,
				documentType: "TECHNICAL_DESIGN",
				content: "bad",
				targetPath: "/tmp/escape.md",
				expectedTaskVersion: written.taskVersion,
				actorRef: "worker:c-dev",
				idempotencyKey: "doc:absolute",
			}),
		),
		"INVALID_REQUEST",
	);
});

test("CP-TASK-ORCH-07 TaskGroup remains serial and predecessor success gates the next Task", async (context) => {
	const { services } = await fixture(context);
	const group = ok(
		services.commands.createTaskGroup({
			taskGroupId: "tg-1",
			title: "Serial chain",
			objective: "one active task",
			maxActiveTasks: 1,
			actorRef: "human:operator",
			idempotencyKey: "group:create",
		}),
	);
	for (const [sequenceNo, taskId] of [[1, "tg-task-1"], [2, "tg-task-2"]] as const) {
		const created = ok(
			services.commands.createTask({
				...taskInput(taskId),
				taskGroupId: group.taskGroupId,
				sequenceNo,
				idempotencyKey: `group:create:${taskId}`,
			}),
		);
		await bindAll(services, created.taskId, created.version);
	}
	const activeGroup = ok(
		services.commands.startTaskGroup({
			taskGroupId: group.taskGroupId,
			expectedGroupVersion: group.version,
			actorRef: "human:operator",
			idempotencyKey: "group:start",
		}),
	);
	assert.equal(activeGroup.status, "ACTIVE");
	const list = ok(services.queries.listTasks({ taskGroupId: group.taskGroupId }));
	const second = list.tasks.find((item) => item.taskId === "tg-task-2");
	assert.ok(second);
	assert.equal(second.canStart, false);
	assert.equal(second.blockedReason, "PREDECESSOR_NOT_SUCCEEDED");
});

test("CP-TASK-ORCH-09 + CP-TASK-ORCH-10 readiness is deterministic and human confirmation directly starts READY Task", async (context) => {
	const { services } = await fixture(context);
	const created = ok(services.commands.createTask(taskInput("task-ready")));
	assert.equal(created.status, "PENDING");
	assert.equal("authorizedByRef" in created, false);
	assert.equal("authorizedAt" in created, false);
	await bindAll(services, created.taskId, created.version);
	const ready = ok(services.queries.getTask({ taskId: created.taskId }));
	assert.equal(ready.status, "READY");
	assert.equal(ready.readiness?.ready ?? true, true);
	const started = ok(
		services.commands.startTask({
			taskId: ready.taskId,
			expectedTaskVersion: ready.version,
			actorRef: "human:operator",
			idempotencyKey: "ready:start",
		}),
	);
	assert.equal(started.status, "ACTIVE");
});

test("Task-owned happy path remains durable after SQLite store close and reopen", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-task-happy-current-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	await execFileAsync("git", ["init", "-q"], { cwd: root });
	const databasePath = join(root, ".proflow", "state", "task.sqlite");
	assert.equal(applyMigrations({ databasePath, migrations: taskMigrations }).ok, true);
	let store = new SqliteTaskStore({ databasePath });
	let services = createTaskServices({ store, workspaceRoot: root });
	const created = ok(services.commands.createTask(taskInput("task-happy")));
	await bindAll(services, created.taskId, created.version);
	let task = ok(services.queries.getTask({ taskId: created.taskId }));
	ok(
		services.commands.startTask({
			taskId: task.taskId,
			expectedTaskVersion: task.version,
			actorRef: "human:operator",
			idempotencyKey: "happy:start",
		}),
	);
	store.close();
	store = new SqliteTaskStore({ databasePath });
	context.after(() => store.close());
	services = createTaskServices({ store, workspaceRoot: root });
	task = ok(services.queries.getTask({ taskId: created.taskId }));
	assert.equal(task.status, "ACTIVE");
	assert.equal(task.roleBindings.length, 3);
	assert.ok(task.roleBindings.every((binding) => binding.workerRef !== null));
	const projection = ok(services.queries.getTaskDriveProjection({ taskId: task.taskId }));
	assert.equal(projection.taskId, task.taskId);
	assert.equal(projection.terminal, false);
});
