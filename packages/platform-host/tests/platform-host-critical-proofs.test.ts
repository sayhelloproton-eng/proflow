import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPlatformHost, parsePlatformHostConfig } from "../src/index.ts";

async function ownerServer() {
	let ready = true;
	let releaseExecution: (() => void) | undefined;
	let executionStarted: (() => void) | undefined;
	const started = new Promise<void>((resolve) => {
		executionStarted = resolve;
	});
	const server = createServer(async (request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.url === "/ready") {
			response.statusCode = ready ? 200 : 503;
			return response.end(
				JSON.stringify({ status: ready ? "READY" : "NOT_READY" }),
			);
		}
		if (request.url === "/executions") {
			executionStarted?.();
			await new Promise<void>((resolve) => {
				releaseExecution = resolve;
			});
			return response.end(
				JSON.stringify({
					executionRef: "execution:real-owner",
					status: "SUCCEEDED",
				}),
			);
		}
		response.end(JSON.stringify({ runtime: "READY" }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		assert.fail("missing owner port");
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		started,
		setReady(value: boolean) {
			ready = value;
		},
		release() {
			releaseExecution?.();
		},
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

async function action(
	baseUrl: string,
	operationId: string,
	authenticatedRoleRef: string,
	input: unknown,
) {
	return fetch(`${baseUrl}/actions/${operationId}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ authenticatedRoleRef, input }),
	});
}

test("CP-HOST-01/02 composes public owner packages and clients without Host business persistence", async () => {
	assert.throws(
		() =>
			parsePlatformHostConfig({
				stateRoot: "/tmp/.proflow",
				workspaceRoot: "/tmp/project",
				executionBaseUrl: "https://execution.example",
				modelBaseUrl: "http://127.0.0.1:9001",
			}),
		/loopback HTTP/,
	);
	const packageEntries = await readdir(new URL("..", import.meta.url));
	assert.deepEqual(
		packageEntries
			.filter((entry) => !["dist", "node_modules"].includes(entry))
			.sort(),
		[
			"README.md",
			"conformance.json",
			"deployment",
			"package.json",
			"src",
			"tests",
			"tsconfig.json",
		],
	);
});

test("CP-HOST-03/04/05 real local transport drains, exposes owner readiness and reconstructs owner state", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-platform-host-"));
	const stateRoot = join(root, ".proflow");
	const workspaceRoot = join(root, "project");
	const owner = await ownerServer();
	const logs: Record<string, unknown>[] = [];
	const host = createPlatformHost({
		config: parsePlatformHostConfig({
			stateRoot,
			workspaceRoot,
			host: "127.0.0.1",
			port: 0,
			executionBaseUrl: owner.baseUrl,
			modelBaseUrl: owner.baseUrl,
			roles: [
				{
					agentPackageRef: "@tomflow/proflow-agent-product",
					registeredPackageVersion: "0.1.0",
					roleRef: "g-product",
					carrierUrl: "https://chatgpt.com/g/g-product",
				},
				{
					agentPackageRef: "@tomflow/proflow-agent-controller-dev",
					registeredPackageVersion: "0.1.0",
					roleRef: "g-controller",
					carrierUrl: "https://chatgpt.com/g/g-controller",
				},
			],
		}),
		log: (entry) => logs.push(entry),
	});
	try {
		const first = await host.start();
		let baseUrl = `http://${first.host}:${first.port}`;
		assert.equal((await fetch(`${baseUrl}/ready`)).status, 200);
		const createdResponse = await action(baseUrl, "createTask", "g-product", {
			taskId: "task:host-proof",
			title: "Host proof",
			objective: "Prove owner state survives Host reconstruction",
			plan: {
				nodes: [
					{
						nodeId: "node:host-proof",
						title: "Proof",
						objective: "Observe composition",
						requiredRoleRef: "g-controller",
						inputDocuments: [],
						outputDocuments: [],
					},
				],
			},
			initialDocuments: [],
			roleBindings: [{ roleRef: "g-controller", workerRef: null }],
			idempotencyKey: "host-create-task",
		});
		assert.equal(createdResponse.status, 200);
		const created = (await createdResponse.json()) as {
			ok: boolean;
			data: { taskId: string };
		};
		assert.equal(created.ok, true);
		assert.equal(created.data.taskId, "task:host-proof");
		await assert.rejects(
			() =>
				host.taskDriverPorts.authorizeTask({
					taskId: "task:host-proof",
					expectedTaskVersion: 1,
					authorizedByRef: "g-product",
					idempotencyKey: "host-invalid-human-authorization",
				}),
			/HUMAN_AUTHORIZATION_REQUIRED/,
		);
		assert.equal(
			(await host.taskDriverPorts.getTask("task:host-proof")).status,
			"PENDING",
		);
		const browserOwnerPorts = host.browserOwnerPorts;
		assert.equal(
			await browserOwnerPorts.task.getWorkerBinding(
				"task:host-proof",
				"g-controller",
			),
			null,
		);
		await browserOwnerPorts.task.bindWorker({
			taskId: "task:host-proof",
			roleRef: "g-controller",
			workerRef: "conversation:host-proof",
		});
		assert.equal(
			await browserOwnerPorts.task.getWorkerBinding(
				"task:host-proof",
				"g-controller",
			),
			"conversation:host-proof",
		);
		assert.equal(
			(await host.taskDriverPorts.getTask("task:host-proof")).status,
			"PENDING",
		);
		assert.equal(
			await host.executionIdentity.authorize({
				callerRef: "g-controller",
				roleRef: "g-controller",
				taskId: "task:host-proof",
				workerRef: "conversation:host-proof",
				projectRoot: workspaceRoot,
				capability: "project.inspect",
				input: {},
			}),
			true,
		);
		assert.equal(
			await host.executionIdentity.authorize({
				callerRef: "g-controller",
				roleRef: "g-product",
				taskId: "task:host-proof",
				workerRef: "conversation:host-proof",
				projectRoot: workspaceRoot,
				capability: "project.inspect",
				input: {},
			}),
			false,
		);

		owner.setReady(false);
		const unavailable = (await fetch(`${baseUrl}/ready`).then((response) =>
			response.json(),
		)) as {
			readiness: string;
			dependencies: Record<string, { status: string; liveness: string }>;
		};
		assert.equal(unavailable.readiness, "NOT_READY");
		assert.equal(unavailable.dependencies.task?.status, "READY");
		assert.equal(unavailable.dependencies.agent?.status, "READY");
		assert.equal(unavailable.dependencies.execution?.status, "NOT_READY");
		assert.equal(unavailable.dependencies.model?.status, "NOT_READY");
		assert.equal(unavailable.dependencies.execution?.liveness, "UP");
		assert.equal(unavailable.dependencies.model?.liveness, "UP");
		owner.setReady(true);

		const second = await host.restart();
		baseUrl = `http://${second.host}:${second.port}`;
		assert.equal(
			await browserOwnerPorts.task.getWorkerBinding(
				"task:host-proof",
				"g-controller",
			),
			"conversation:host-proof",
		);
		assert.equal(
			await host.executionIdentity.authorize({
				callerRef: "g-controller",
				roleRef: "g-controller",
				taskId: "task:host-proof",
				workerRef: "conversation:host-proof",
				capability: "project.inspect",
				input: {},
			}),
			true,
		);
		const restored = (await action(baseUrl, "getTask", "g-product", {
			taskId: "task:host-proof",
		}).then((response) => response.json())) as {
			ok: boolean;
			data: { taskId: string; status: string };
		};
		assert.equal(restored.ok, true);
		assert.deepEqual(
			{ taskId: restored.data.taskId, status: restored.data.status },
			{ taskId: "task:host-proof", status: "PENDING" },
		);

		const execution = action(baseUrl, "executeCapability", "g-controller", {
			capability: "project.inspect",
			input: {},
			idempotencyKey: "host-execution-proof",
		});
		await owner.started;
		let stopped = false;
		const stopping = host.stop().then(() => {
			stopped = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.equal(stopped, false);
		owner.release();
		assert.equal((await execution).status, 200);
		await stopping;
		assert.equal((await host.status()).process, "STOPPED");
		assert.deepEqual(
			logs.map((entry) => entry.event),
			[
				"DEPENDENCY_INITIALIZATION_STARTED",
				"SERVICE_STARTED",
				"SERVICE_STOPPED",
				"DEPENDENCY_INITIALIZATION_STARTED",
				"SERVICE_STARTED",
				"SERVICE_STOPPED",
			],
		);
		assert.equal((await readdir(stateRoot)).includes("host"), false);
	} finally {
		await host.stop();
		owner.release();
		await owner.close();
	}
});
