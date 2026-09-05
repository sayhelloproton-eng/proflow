import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { applyMigrations } from "@tomflow/proflow-task-migration-runner";
import { createTaskServices } from "@tomflow/proflow-task-orchestration";
import {
	SqliteTaskStore,
	taskMigrations,
} from "@tomflow/proflow-task-store-sqlite";

import { createPlatformHost, parsePlatformHostConfig } from "../src/index.ts";

const packages = {
	product: "@tomflow/proflow-agent-product",
	dev: "@tomflow/proflow-agent-controller-dev",
	test: "@tomflow/proflow-agent-test-ops",
} as const;
const roles = { product: "g-product", dev: "g-dev", test: "g-test" } as const;
const workers = {
	product: "c-product",
	dev: "c-dev",
	test: "c-test",
} as const;

function ok<T>(result: { ok: boolean; data?: T; error?: unknown }): T {
	if (!result.ok || result.data === undefined)
		throw new Error(JSON.stringify(result.error));
	return result.data;
}

async function readinessStub() {
	const server = createServer((_request, response) => {
		response.setHeader("content-type", "application/json");
		response.end(JSON.stringify({ status: "READY" }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") assert.fail("missing stub port");
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

function identityHost(stateRoot: string, workspaceRoot: string, dependencyBaseUrl: string) {
	return createPlatformHost({
		config: parsePlatformHostConfig({
			stateRoot,
			workspaceRoot,
			host: "127.0.0.1",
			port: 0,
			executionBaseUrl: dependencyBaseUrl,
			modelBaseUrl: dependencyBaseUrl,
			roles: [
				{
					agentPackageRef: packages.product,
					registeredPackageVersion: "0.1.0",
					roleRef: roles.product,
					carrierUrl: `https://chatgpt.com/g/${roles.product}`,
				},
				{
					agentPackageRef: packages.dev,
					registeredPackageVersion: "0.1.0",
					roleRef: roles.dev,
					carrierUrl: `https://chatgpt.com/g/${roles.dev}`,
				},
				{
					agentPackageRef: packages.test,
					registeredPackageVersion: "0.1.0",
					roleRef: roles.test,
					carrierUrl: `https://chatgpt.com/g/${roles.test}`,
				},
			],
		}),
	});
}

async function seedTask(
	stateRoot: string,
	workspaceRoot: string,
	nodeState: "READY" | "IN_PROGRESS" | "PAUSED" = "READY",
) {
	await mkdir(workspaceRoot, { recursive: true });
	const databasePath = join(stateRoot, "state", "task.sqlite");
	assert.equal(
		applyMigrations({ databasePath, migrations: taskMigrations }).ok,
		true,
	);
	const store = new SqliteTaskStore({ databasePath });
	try {
		const services = createTaskServices({ store, workspaceRoot });
		const created = ok(
			services.commands.createTask({
				taskId: "task-execution-identity",
				title: "Execution identity admission",
				objective: "Prove worker.wake Task generation fencing",
				plan: {
					nodes: [
						{
							nodeId: "node-dev",
							title: "Dev",
							objective: "Current node",
							requiredAgentPackageRef: packages.dev,
							inputDocuments: ["REQUIREMENT"],
							outputDocuments: ["TECHNICAL_DESIGN"],
						},
						{
							nodeId: "node-dev-later",
							title: "Dev later",
							objective: "Existing but non-current node",
							requiredAgentPackageRef: packages.dev,
							inputDocuments: ["TECHNICAL_DESIGN"],
							outputDocuments: ["TEST_RESULT"],
						},
					],
				},
				initialDocuments: [
					{ documentType: "REQUIREMENT", content: "# Requirement\n" },
				],
				roleBindings: [
					{
						agentPackageRef: packages.product,
						roleRef: roles.product,
						workerRef: null,
						conversationLocator: null,
					},
					{
						agentPackageRef: packages.dev,
						roleRef: roles.dev,
						workerRef: null,
						conversationLocator: null,
					},
					{
						agentPackageRef: packages.test,
						roleRef: roles.test,
						workerRef: null,
						conversationLocator: null,
					},
				],
				actorRef: "extension:new-task",
				idempotencyKey: "create:execution-identity",
			}),
		);
		let version = created.version;
		for (const [agentPackageRef, roleRef, workerRef] of [
			[packages.product, roles.product, workers.product],
			[packages.dev, roles.dev, workers.dev],
			[packages.test, roles.test, workers.test],
		] as const) {
			const bound = ok(
				services.commands.bindTaskWorker({
					taskId: created.taskId,
					agentPackageRef,
					roleRef,
					workerRef,
					conversationLocator: `https://chatgpt.com/g/${roleRef}/c/${workerRef}`,
					expectedTaskVersion: version,
					actorRef: "platform-host:worker-provisioning",
					idempotencyKey: `bind:execution-identity:${agentPackageRef}`,
				}),
			);
			version = bound.version;
		}
		const started = ok(
			services.commands.startTask({
				taskId: created.taskId,
				expectedTaskVersion: version,
				actorRef: "human:operator",
				idempotencyKey: "start:execution-identity",
			}),
		);
		let projection = ok(
			services.queries.getTaskDriveProjection({ taskId: created.taskId }),
		);
		if (nodeState !== "READY") {
			const context = ok(
				services.queries.getNodeContext({
					taskId: created.taskId,
					nodeId: "node-dev",
				}),
			);
			const running = ok(
				services.commands.startNode({
					taskId: created.taskId,
					nodeId: "node-dev",
					expectedTaskVersion: started.version,
					expectedNodeVersion: context.node.version,
					actorRef: `worker:${workers.dev}`,
					idempotencyKey: "start-node:execution-identity",
				}),
			);
			if (nodeState === "PAUSED")
				ok(
					services.commands.pauseTask({
						taskId: created.taskId,
						reason: "identity admission pause",
						expectedTaskVersion: running.taskVersion,
						actorRef: "human:operator",
						idempotencyKey: "pause:execution-identity",
					}),
				);
			projection = ok(
				services.queries.getTaskDriveProjection({ taskId: created.taskId }),
			);
		}
		assert.equal(projection.taskStatus, nodeState === "PAUSED" ? "PAUSED" : "ACTIVE");
		assert.equal(projection.currentNode?.nodeId, "node-dev");
		assert.equal(
			projection.currentNode?.status,
			nodeState === "READY" ? "READY" : "IN_PROGRESS",
		);
		assert.equal(projection.currentNode?.runNo, 1);
		assert.equal(projection.roleBinding?.roleRef, roles.dev);
		assert.equal(projection.roleBinding?.workerRef, workers.dev);
		return { taskId: created.taskId, currentNodeId: "node-dev", runNo: 1 };
	} finally {
		store.close();
	}
}

function wakeRequest(input: {
	taskId: string;
	nodeId: string;
	runNo: number;
	roleRef: string;
	workerRef: string;
	workspaceRoot: string;
	trigger?: "NODE_READY" | "REOPEN" | "EXECUTION_RESULT_READY" | "RECOVERY_RESUME";
}) {
	const trigger = input.trigger ?? "NODE_READY";
	return {
		callerRef: "extension:task-observer",
		roleRef: input.roleRef,
		taskId: input.taskId,
		nodeId: input.nodeId,
		runNo: input.runNo,
		workerRef: input.workerRef,
		projectRoot: input.workspaceRoot,
		capability: "worker.wake",
		input: {
			roleRef: input.roleRef,
			workerRef: input.workerRef,
			taskId: input.taskId,
			nodeId: input.nodeId,
			runNo: input.runNo,
			trigger,
			fingerprint: `wake:${input.taskId}:${input.nodeId}:${input.runNo}:${trigger}`,
		},
	};
}

test("RF-HOST-EXEC-IDENTITY-01 worker.wake admission fences current node generation and bound identity", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-execution-identity-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const stateRoot = join(root, ".proflow");
	const workspaceRoot = join(root, "project");
	const seeded = await seedTask(stateRoot, workspaceRoot);
	const dependency = await readinessStub();
	context.after(() => dependency.close());
	const host = createPlatformHost({
		config: parsePlatformHostConfig({
			stateRoot,
			workspaceRoot,
			host: "127.0.0.1",
			port: 0,
			executionBaseUrl: dependency.baseUrl,
			modelBaseUrl: dependency.baseUrl,
			roles: [
				{
					agentPackageRef: packages.product,
					registeredPackageVersion: "0.1.0",
					roleRef: roles.product,
					carrierUrl: `https://chatgpt.com/g/${roles.product}`,
				},
				{
					agentPackageRef: packages.dev,
					registeredPackageVersion: "0.1.0",
					roleRef: roles.dev,
					carrierUrl: `https://chatgpt.com/g/${roles.dev}`,
				},
				{
					agentPackageRef: packages.test,
					registeredPackageVersion: "0.1.0",
					roleRef: roles.test,
					carrierUrl: `https://chatgpt.com/g/${roles.test}`,
				},
			],
		}),
	});
	context.after(() => host.stop());
	await host.start();

	const base = {
		taskId: seeded.taskId,
		nodeId: seeded.currentNodeId,
		runNo: seeded.runNo,
		roleRef: roles.dev,
		workerRef: workers.dev,
		workspaceRoot,
	};

	const matrix = {
		current: await host.executionIdentity.authorize(wakeRequest(base)),
		staleRun: await host.executionIdentity.authorize(
			wakeRequest({ ...base, runNo: seeded.runNo + 1 }),
		),
		wrongWorker: await host.executionIdentity.authorize(
			wakeRequest({ ...base, workerRef: "c-dev-wrong" }),
		),
		wrongRole: await host.executionIdentity.authorize(
			wakeRequest({ ...base, roleRef: roles.test, workerRef: workers.test }),
		),
		wrongNode: await host.executionIdentity.authorize(
			wakeRequest({ ...base, nodeId: "node-dev-later" }),
		),
		readyGenericExecution: await host.executionIdentity.authorize(
			nodeExecutionRequest(base),
		),
		resumeTriggerOnReady: await host.executionIdentity.authorize(
			wakeRequest({ ...base, trigger: "RECOVERY_RESUME" }),
		),
		reopenTriggerOnRun1: await host.executionIdentity.authorize(
			wakeRequest({ ...base, trigger: "REOPEN" }),
		),
		nodeWithoutRunNo: await host.executionIdentity.authorize({
			...nodeExecutionRequest(base),
			runNo: undefined,
		}),
		runNoWithoutNode: await host.executionIdentity.authorize({
			...nodeExecutionRequest(base),
			nodeId: undefined,
		}),
	};
	assert.deepEqual(matrix, {
		current: true,
		staleRun: false,
		wrongWorker: false,
		wrongRole: false,
		wrongNode: false,
		readyGenericExecution: false,
		resumeTriggerOnReady: false,
		reopenTriggerOnRun1: false,
		nodeWithoutRunNo: false,
		runNoWithoutNode: false,
	});
});


function nodeExecutionRequest(input: {
	taskId: string;
	nodeId: string;
	runNo: number;
	roleRef: string;
	workerRef: string;
	workspaceRoot: string;
}) {
	return {
		callerRef: input.roleRef,
		roleRef: input.roleRef,
		taskId: input.taskId,
		nodeId: input.nodeId,
		runNo: input.runNo,
		workerRef: input.workerRef,
		projectRoot: input.workspaceRoot,
		capability: "project.info",
		input: {},
	};
}

test("RF-HOST-EXEC-IDENTITY-02 IN_PROGRESS node Execution keeps current generation/role/worker fencing", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-execution-identity-running-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const stateRoot = join(root, ".proflow");
	const workspaceRoot = join(root, "project");
	const seeded = await seedTask(stateRoot, workspaceRoot, "IN_PROGRESS");
	const dependency = await readinessStub();
	context.after(() => dependency.close());
	const host = createPlatformHost({
		config: parsePlatformHostConfig({
			stateRoot,
			workspaceRoot,
			host: "127.0.0.1",
			port: 0,
			executionBaseUrl: dependency.baseUrl,
			modelBaseUrl: dependency.baseUrl,
			roles: [
				{
					agentPackageRef: packages.product,
					registeredPackageVersion: "0.1.0",
					roleRef: roles.product,
					carrierUrl: `https://chatgpt.com/g/${roles.product}`,
				},
				{
					agentPackageRef: packages.dev,
					registeredPackageVersion: "0.1.0",
					roleRef: roles.dev,
					carrierUrl: `https://chatgpt.com/g/${roles.dev}`,
				},
				{
					agentPackageRef: packages.test,
					registeredPackageVersion: "0.1.0",
					roleRef: roles.test,
					carrierUrl: `https://chatgpt.com/g/${roles.test}`,
				},
			],
		}),
	});
	context.after(() => host.stop());
	await host.start();

	const base = {
		taskId: seeded.taskId,
		nodeId: seeded.currentNodeId,
		runNo: seeded.runNo,
		roleRef: roles.dev,
		workerRef: workers.dev,
		workspaceRoot,
	};
	const matrix = {
		current: await host.executionIdentity.authorize(nodeExecutionRequest(base)),
		staleRun: await host.executionIdentity.authorize(
			nodeExecutionRequest({ ...base, runNo: seeded.runNo + 1 }),
		),
		wrongWorker: await host.executionIdentity.authorize(
			nodeExecutionRequest({ ...base, workerRef: "c-dev-wrong" }),
		),
		wrongRole: await host.executionIdentity.authorize(
			nodeExecutionRequest({ ...base, roleRef: roles.test, workerRef: workers.test }),
		),
		wrongNode: await host.executionIdentity.authorize(
			nodeExecutionRequest({ ...base, nodeId: "node-dev-later" }),
		),
		resumeWake: await host.executionIdentity.authorize(
			wakeRequest({ ...base, trigger: "RECOVERY_RESUME" }),
		),
		nodeReadyWakeAfterStart: await host.executionIdentity.authorize(
			wakeRequest(base),
		),
	};
	assert.deepEqual(matrix, {
		current: true,
		staleRun: false,
		wrongWorker: false,
		wrongRole: false,
		wrongNode: false,
		resumeWake: true,
		nodeReadyWakeAfterStart: false,
	});
});

test("RF-HOST-EXEC-IDENTITY-03 PAUSED Task cannot keep executing the current IN_PROGRESS Node", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-execution-identity-paused-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const stateRoot = join(root, ".proflow");
	const workspaceRoot = join(root, "project");
	const seeded = await seedTask(stateRoot, workspaceRoot, "PAUSED");
	const dependency = await readinessStub();
	context.after(() => dependency.close());
	const host = identityHost(stateRoot, workspaceRoot, dependency.baseUrl);
	context.after(() => host.stop());
	await host.start();
	const base = {
		taskId: seeded.taskId,
		nodeId: seeded.currentNodeId,
		runNo: seeded.runNo,
		roleRef: roles.dev,
		workerRef: workers.dev,
		workspaceRoot,
	};
	assert.equal(
		await host.executionIdentity.authorize(nodeExecutionRequest(base)),
		false,
	);
	assert.equal(
		await host.executionIdentity.authorize(
			wakeRequest({ ...base, trigger: "RECOVERY_RESUME" }),
		),
		false,
	);
});