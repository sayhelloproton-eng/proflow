import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAgentGatewayProcess } from "@tomflow/proflow-agent-gateway/process";
import {
	executionCapabilityIds,
	parseExecuteCapabilityRequest,
} from "@tomflow/proflow-execution-contracts";
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

function identityHost(
	stateRoot: string,
	workspaceRoot: string,
	dependencyBaseUrl: string,
) {
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
	nodeState:
		| "READY"
		| "IN_PROGRESS"
		| "WAITING"
		| "PAUSED"
		| "REOPEN_READY" = "READY",
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
			if (nodeState === "WAITING")
				ok(
					services.commands.waitNode({
						taskId: created.taskId,
						nodeId: "node-dev",
						expectedTaskVersion: running.taskVersion,
						expectedNodeVersion: running.nodeVersion,
						waitType: "BUSINESS_CONFIRMATION",
						reasonCode: "BUSINESS_DECISION_REQUIRED",
						message: "Choose the business option",
						actorRef: `worker:${workers.dev}`,
						idempotencyKey: "wait-node:execution-identity",
					}),
				);
			if (nodeState === "REOPEN_READY") {
				const failed = ok(
					services.commands.failNode({
						taskId: created.taskId,
						nodeId: "node-dev",
						expectedTaskVersion: running.taskVersion,
						expectedNodeVersion: running.nodeVersion,
						errorCode: "TEST_REOPEN",
						errorMessage: "prepare reopened generation",
						retryable: true,
						actorRef: `worker:${workers.dev}`,
						idempotencyKey: "fail-node:execution-identity",
					}),
				);
				ok(
					services.commands.reopenNode({
						taskId: created.taskId,
						nodeId: "node-dev",
						reason: "verify REOPEN admission",
						expectedTaskVersion: failed.version,
						actorRef: "human:operator",
						idempotencyKey: "reopen-node:execution-identity",
					}),
				);
			}
			projection = ok(
				services.queries.getTaskDriveProjection({ taskId: created.taskId }),
			);
		}
		assert.equal(
			projection.taskStatus,
			nodeState === "PAUSED"
				? "PAUSED"
				: nodeState === "WAITING"
					? "WAITING"
					: "ACTIVE",
		);
		assert.equal(projection.currentNode?.nodeId, "node-dev");
		assert.equal(
			projection.currentNode?.status,
			nodeState === "READY" || nodeState === "REOPEN_READY"
				? "READY"
				: nodeState === "WAITING"
					? "WAITING"
					: "IN_PROGRESS",
		);
		assert.equal(
			projection.currentNode?.runNo,
			nodeState === "REOPEN_READY" ? 2 : 1,
		);
		assert.equal(projection.roleBinding?.roleRef, roles.dev);
		assert.equal(projection.roleBinding?.workerRef, workers.dev);
		return {
			taskId: created.taskId,
			currentNodeId: "node-dev",
			runNo: nodeState === "REOPEN_READY" ? 2 : 1,
		};
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
	trigger?:
		| "NODE_READY"
		| "REOPEN"
		| "EXECUTION_RESULT_READY"
		| "RECOVERY_RESUME";
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

test("B1-HOST-APP-01 Human application acknowledges the blocker before same-run task.resume", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-b1-human-resume-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const stateRoot = join(root, ".proflow");
	const workspaceRoot = join(root, "project");
	await seedTask(stateRoot, workspaceRoot, "WAITING");
	const dependency = await readinessStub();
	context.after(() => dependency.close());
	const host = identityHost(stateRoot, workspaceRoot, dependency.baseUrl);
	context.after(() => host.stop());
	const started = await host.start();
	const token = (
		await readFile(
			join(stateRoot, "browser", "secrets", "task-application.token"),
			"utf8",
		)
	).trim();
	const invoke = async (operation: string, input: Record<string, unknown>) => {
		const response = await fetch(
			`http://${started.host}:${started.port}/application/task`,
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ operation, input }),
			},
		);
		return {
			response,
			body: (await response.json()) as Record<string, unknown>,
		};
	};
	const current = await invoke("task.get", {
		taskId: "task-execution-identity",
	});
	assert.equal(current.response.status, 200);
	const taskVersion = Number(current.body.version);
	const pending = current.body.pendingMessages as Array<{ messageId: string }>;
	assert.equal(pending.length, 1);
	const blocked = await invoke("task.resume", {
		taskId: "task-execution-identity",
		expectedTaskVersion: taskVersion,
		idempotencyKey: "b1:resume:blocked",
	});
	assert.equal(blocked.response.status, 400);
	assert.match(String(blocked.body.error), /TASK_BLOCKER_UNRESOLVED/);
	const pendingMessage = pending[0];
	assert.ok(pendingMessage);
	const acknowledged = await invoke("message.acknowledge", {
		messageId: pendingMessage.messageId,
		resolution: "Approved business choice",
		idempotencyKey: "b1:message:ack",
	});
	assert.equal(acknowledged.response.status, 200);
	const resumed = await invoke("task.resume", {
		taskId: "task-execution-identity",
		expectedTaskVersion: taskVersion,
		idempotencyKey: "b1:resume:after-ack",
	});
	assert.equal(resumed.response.status, 200);
	assert.equal(resumed.body.status, "ACTIVE");
	const after = await invoke("task.get", { taskId: "task-execution-identity" });
	const node = (after.body.nodes as Array<Record<string, unknown>>)[0];
	assert.ok(node);
	assert.equal(node.status, "IN_PROGRESS");
	assert.equal(node.runNo, 1);
	assert.equal(node.workerRef, workers.dev);
});

test("B1-HOST-EXEC-01 GPT-shaped file.read is exact-node scoped before one durable Execution parse", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-b1-action-chain-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const stateRoot = join(root, ".proflow");
	const workspaceRoot = join(root, "project");
	const seeded = await seedTask(stateRoot, workspaceRoot, "IN_PROGRESS");
	let durableParses = 0;
	const execution = createServer(async (request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.url === "/ready") return response.end('{"status":"READY"}');
		if (request.url !== "/executions" || request.method !== "POST") {
			response.statusCode = 404;
			return response.end('{"error":"NOT_FOUND"}');
		}
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.from(chunk));
		try {
			const parsed = parseExecuteCapabilityRequest(
				JSON.parse(Buffer.concat(chunks).toString("utf8")),
			);
			durableParses += 1;
			assert.equal(parsed.workerRef, workers.dev);
			assert.equal(parsed.projectRoot, undefined);
			response.end(
				JSON.stringify({
					executionRef: `execution:b1:${durableParses}`,
					status: "SUCCEEDED",
					sideEffectState: "APPLIED",
				}),
			);
		} catch {
			response.statusCode = 400;
			response.end('{"error":"INVALID_REQUEST"}');
		}
	});
	await new Promise<void>((resolve) =>
		execution.listen(0, "127.0.0.1", resolve),
	);
	context.after(
		() => new Promise<void>((resolve) => execution.close(() => resolve())),
	);
	const executionAddress = execution.address();
	if (!executionAddress || typeof executionAddress === "string")
		assert.fail("missing execution");
	const dependencyBaseUrl = `http://127.0.0.1:${executionAddress.port}`;
	const host = identityHost(stateRoot, workspaceRoot, dependencyBaseUrl);
	context.after(() => host.stop());
	const hostAddress = await host.start();
	const credentialFile = join(root, "gateway-roles.json");
	await writeFile(
		credentialFile,
		JSON.stringify({
			[roles.dev]: "dev-gateway-credential-long-enough",
			[roles.test]: "test-gateway-credential-long-enough",
		}),
		{ mode: 0o600 },
	);
	const gateway = await createAgentGatewayProcess({
		config: {
			host: "127.0.0.1",
			port: 0,
			publicBaseUrl: "https://gateway.example.test",
			downstreamBaseUrl: `http://${hostAddress.host}:${hostAddress.port}`,
			credentialFile,
		},
	});
	context.after(() => gateway.stop());
	const gatewayAddress = await gateway.start();
	const call = async (
		credential: string,
		body: Record<string, unknown>,
		operationId = "executeCapability",
	) => {
		const url = new URL(
			`http://${gatewayAddress.host}:${gatewayAddress.port}/actions/${operationId}`,
		);
		const isQuery = operationId === "getNodeContext";
		if (isQuery)
			for (const [key, value] of Object.entries(body))
				url.searchParams.set(key, String(value));
		const response = await fetch(url, {
			method: isQuery ? "GET" : "POST",
			headers: {
				authorization: `Bearer ${credential}`,
				...(isQuery ? {} : { "content-type": "application/json" }),
			},
			...(isQuery ? {} : { body: JSON.stringify(body) }),
		});
		return {
			response,
			body: (await response.json()) as Record<string, unknown>,
		};
	};
	const projected = await call(
		"dev-gateway-credential-long-enough",
		{ taskId: seeded.taskId, nodeId: seeded.currentNodeId },
		"getNodeContext",
	);
	assert.equal(projected.response.status, 200);
	assert.deepEqual(projected.body.executionCapabilityIds, [
		...executionCapabilityIds,
	]);
	assert.deepEqual(projected.body.executionRequestContext, {
		contract: "execution",
		contractVersion: "1.0.0",
		taskId: seeded.taskId,
		nodeId: seeded.currentNodeId,
		runNo: seeded.runNo,
	});
	const base = {
		contract: "execution",
		contractVersion: "1.0.0",
		idempotencyKey: "b1:file-read",
		taskId: seeded.taskId,
		nodeId: seeded.currentNodeId,
		runNo: seeded.runNo,
		capability: "file.read",
		input: { path: "repos/proflow/package.json" },
	};
	for (const missing of ["taskId", "nodeId", "runNo"] as const) {
		const body = { ...base };
		delete body[missing];
		const result = await call("dev-gateway-credential-long-enough", body);
		assert.equal(result.response.status, 400);
		assert.deepEqual(result.body, { error: "INVALID_REQUEST" });
	}
	assert.equal(durableParses, 0);
	const stale = await call("dev-gateway-credential-long-enough", {
		...base,
		runNo: 99,
	});
	assert.equal(stale.response.status, 403);
	assert.equal(stale.body.error, "EXECUTION_GENERATION_MISMATCH");
	const wrongRole = await call("test-gateway-credential-long-enough", base);
	assert.equal(wrongRole.response.status, 403);
	assert.equal(wrongRole.body.error, "EXECUTION_ROLE_SCOPE_MISMATCH");
	assert.equal(durableParses, 0);
	const invalidInput = await call("dev-gateway-credential-long-enough", {
		...base,
		idempotencyKey: "b1:file-read:invalid",
		input: { path: "package.json", encoding: "utf16" },
	});
	assert.equal(invalidInput.response.status, 400);
	assert.deepEqual(invalidInput.body, { error: "INVALID_REQUEST" });
	assert.equal(durableParses, 0);
	const valid = await call("dev-gateway-credential-long-enough", base);
	assert.equal(valid.response.status, 200);
	assert.equal(valid.body.status, "SUCCEEDED");
	assert.equal(durableParses, 1);
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
	const root = await mkdtemp(
		join(tmpdir(), "proflow-execution-identity-running-"),
	);
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
			nodeExecutionRequest({
				...base,
				roleRef: roles.test,
				workerRef: workers.test,
			}),
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
	const root = await mkdtemp(
		join(tmpdir(), "proflow-execution-identity-paused-"),
	);
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

test("CP-HOST-EXEC-IDENTITY-04 reopened READY generation admits REOPEN and rejects NODE_READY", async (context) => {
	const root = await mkdtemp(
		join(tmpdir(), "proflow-execution-identity-reopen-"),
	);
	context.after(() => rm(root, { recursive: true, force: true }));
	const stateRoot = join(root, ".proflow");
	const workspaceRoot = join(root, "project");
	const seeded = await seedTask(stateRoot, workspaceRoot, "REOPEN_READY");
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
		await host.executionIdentity.authorize(
			wakeRequest({ ...base, trigger: "REOPEN" }),
		),
		true,
	);
	assert.equal(
		await host.executionIdentity.authorize(wakeRequest(base)),
		false,
	);
});
