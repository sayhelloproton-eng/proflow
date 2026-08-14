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

async function capturingOwnerServer() {
	const ready = true;
	const executionBodies: Record<string, unknown>[] = [];
	const server = createServer(async (request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.url === "/ready") {
			response.statusCode = ready ? 200 : 503;
			return response.end(
				JSON.stringify({ status: ready ? "READY" : "NOT_READY" }),
			);
		}
		if (request.url === "/executions") {
			const chunks: Buffer[] = [];
			for await (const chunk of request)
				chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
			executionBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			return response.end(
				JSON.stringify({
					executionRef: "execution:admission",
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
		executionBodies,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
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
		const restored = (await action(baseUrl, "getTask", "g-controller", {
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

test("B2-HOST-01 Task-scoped Action admission blocks cross-task reads and derives canonical Worker identity", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "proflow-platform-host-admission-"),
	);
	const stateRoot = join(root, ".proflow");
	const workspaceRoot = join(root, "project");
	const owner = await capturingOwnerServer();
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
				{
					agentPackageRef: "@tomflow/proflow-agent-test-ops",
					registeredPackageVersion: "0.1.0",
					roleRef: "g-test",
					carrierUrl: "https://chatgpt.com/g/g-test",
				},
			],
		}),
	});
	try {
		const { host: hostAddress, port } = await host.start();
		const baseUrl = `http://${hostAddress}:${port}`;
		const createdResponse = await action(baseUrl, "createTask", "g-product", {
			taskId: "task:admission-proof",
			title: "Admission proof",
			objective: "Prove task-scoped admission",
			plan: {
				nodes: [
					{
						nodeId: "node:admission-proof",
						title: "Inspect",
						objective: "Observe",
						requiredRoleRef: "g-controller",
						inputDocuments: [],
						outputDocuments: [],
					},
				],
			},
			initialDocuments: [],
			roleBindings: [{ roleRef: "g-controller", workerRef: null }],
			idempotencyKey: "admission-create-task",
		});
		assert.equal(createdResponse.status, 200);
		await host.browserOwnerPorts.task.bindWorker({
			taskId: "task:admission-proof",
			roleRef: "g-controller",
			workerRef: "conversation:admission-proof",
		});

		// Registered role A (g-test) reading Task B (bound to g-controller) is
		// rejected across getTask / getNodeContext / getTaskDocument.
		assert.equal(
			(
				await action(baseUrl, "getTask", "g-test", {
					taskId: "task:admission-proof",
				})
			).status,
			403,
		);
		assert.equal(
			(
				await action(baseUrl, "getNodeContext", "g-test", {
					taskId: "task:admission-proof",
					nodeId: "node:admission-proof",
				})
			).status,
			403,
		);
		assert.equal(
			(
				await action(baseUrl, "getTaskDocument", "g-test", {
					taskId: "task:admission-proof",
					documentType: "plan",
				})
			).status,
			403,
		);
		// Product also cannot read a Task it is not bound to.
		assert.equal(
			(
				await action(baseUrl, "getTask", "g-product", {
					taskId: "task:admission-proof",
				})
			).status,
			403,
		);

		// Same-Task valid binding read passes.
		assert.equal(
			(
				await action(baseUrl, "getTask", "g-controller", {
					taskId: "task:admission-proof",
				})
			).status,
			200,
		);

		// executeCapability with taskId but omitted workerRef no longer bypasses:
		// the non-participant is rejected, the participant derives canonical Worker.
		assert.equal(
			(
				await action(baseUrl, "executeCapability", "g-test", {
					taskId: "task:admission-proof",
					capability: "project.inspect",
					input: {},
					idempotencyKey: "admission-exec-nonparticipant",
				})
			).status,
			403,
		);
		assert.equal(
			(
				await action(baseUrl, "executeCapability", "g-controller", {
					taskId: "task:admission-proof",
					capability: "project.inspect",
					input: {},
					idempotencyKey: "admission-exec-derived-worker",
				})
			).status,
			200,
		);
		// Spoofed workerRef that disagrees with the owner binding is rejected.
		assert.equal(
			(
				await action(baseUrl, "executeCapability", "g-controller", {
					taskId: "task:admission-proof",
					workerRef: "conversation:spoofed",
					capability: "project.inspect",
					input: {},
					idempotencyKey: "admission-exec-spoof-worker",
				})
			).status,
			403,
		);
		// The canonical owner-derived workerRef is what Execution observes.
		assert.equal(
			owner.executionBodies.at(-1)?.workerRef,
			"conversation:admission-proof",
		);

		// An external Bearer cannot spoof the internal task-driver identity: route
		// always stamps callerRef from the authenticated role, overriding any body.
		await action(baseUrl, "executeCapability", "g-controller", {
			taskId: "task:admission-proof",
			callerRef: "execution-runtime:task-driver",
			capability: "project.inspect",
			input: {},
			idempotencyKey: "admission-exec-spoof-driver",
		});
		const last = owner.executionBodies.at(-1);
		assert.equal(last?.callerRef, "g-controller");
		assert.notEqual(last?.callerRef, "execution-runtime:task-driver");

		// Taskless execution is not affected by the Task-scoped admission.
		assert.equal(
			(
				await action(baseUrl, "executeCapability", "g-controller", {
					capability: "project.inspect",
					input: {},
					idempotencyKey: "admission-exec-taskless",
				})
			).status,
			200,
		);

		// Internal task-driver path continues to pass, and stale node owner facts
		// are rejected.
		assert.equal(
			await host.executionIdentity.authorize({
				callerRef: "execution-runtime:task-driver",
				taskId: "task:admission-proof",
				capability: "worker.create",
				input: { roleRef: "g-controller" },
			}),
			true,
		);
		assert.equal(
			await host.executionIdentity.authorize({
				callerRef: "g-controller",
				roleRef: "g-controller",
				taskId: "task:admission-proof",
				nodeId: "node:does-not-exist",
				capability: "project.inspect",
				input: {},
			}),
			false,
		);
	} finally {
		await host.stop();
		await owner.close();
	}
});
