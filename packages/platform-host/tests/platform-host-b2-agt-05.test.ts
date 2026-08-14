import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPlatformHost, parsePlatformHostConfig } from "../src/index.ts";

async function ownerServer() {
	const server = createServer((request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.url === "/ready")
			return response.end(JSON.stringify({ status: "READY" }));
		response.end(JSON.stringify({ runtime: "READY" }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		assert.fail("missing owner port");
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
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

test("B2-AGT-05 terminal Task is blocked from physical collaboration delivery at both guards", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-platform-host-agt-05-"));
	const stateRoot = join(root, ".proflow");
	const workspaceRoot = join(root, "project");
	const owner = await ownerServer();
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
	});
	try {
		const { host: hostAddress, port } = await host.start();
		const baseUrl = `http://${hostAddress}:${port}`;
		const taskId = "task:agt-05";
		const createdResponse = await action(baseUrl, "createTask", "g-product", {
			taskId,
			title: "Terminal delivery guard",
			objective: "Prove terminal Tasks cannot physically deliver",
			plan: {
				nodes: [
					{
						nodeId: "node:agt-05",
						title: "Deliver",
						objective: "Observe the delivery guard",
						requiredRoleRef: "g-controller",
						inputDocuments: [],
						outputDocuments: [],
					},
				],
			},
			initialDocuments: [],
			roleBindings: [
				{ roleRef: "g-product", workerRef: "conversation:product" },
				{ roleRef: "g-controller", workerRef: "conversation:controller" },
			],
			idempotencyKey: "agt-05-create-task",
		});
		assert.equal(createdResponse.status, 200);

		// Create a real pending collaboration message while the Task is non-terminal.
		const askedResponse = await action(baseUrl, "askPeer", "g-controller", {
			taskId,
			fromWorkerRef: "conversation:controller",
			targetAgentPackageRef: "@tomflow/proflow-agent-product",
			content: "requesting a physical delivery",
			idempotencyKey: "agt-05-ask-peer",
		});
		assert.equal(askedResponse.status, 200);
		const asked = (await askedResponse.json()) as {
			message: { messageId: string };
		};
		const messageRef = asked.message.messageId;
		assert.ok(messageRef);

		// Non-terminal: the physical delivery path is admitted for both a normal
		// role and the internal task-driver.
		assert.equal(
			await host.browserOwnerPorts.agent
				.getPendingMessage(messageRef)
				.then((message) => message.messageId),
			messageRef,
		);
		assert.equal(
			await host.executionIdentity.authorize({
				callerRef: "g-controller",
				taskId,
				capability: "collaboration.deliver",
				input: {
					roleRef: "g-controller",
					workerRef: "conversation:controller",
				},
			}),
			true,
		);
		assert.equal(
			await host.executionIdentity.authorize({
				callerRef: "execution-runtime:task-driver",
				taskId,
				capability: "collaboration.deliver",
				input: {
					roleRef: "g-controller",
					workerRef: "conversation:controller",
				},
			}),
			true,
		);

		// Drive the Task to terminal state via the real task-driver orchestration.
		await host.taskDriverPorts.authorizeTask({
			taskId,
			expectedTaskVersion: 1,
			authorizedByRef: "human:agt-05-operator",
			idempotencyKey: "agt-05-authorize",
		});
		await host.taskDriverPorts.startTask({
			taskId,
			expectedTaskVersion: 2,
			idempotencyKey: "agt-05-start-task",
		});
		await host.taskDriverPorts.startNode({
			taskId,
			nodeId: "node:agt-05",
			expectedTaskVersion: 3,
			expectedNodeVersion: 2,
			idempotencyKey: "agt-05-start-node",
		});
		const completedResponse = await action(
			baseUrl,
			"completeNode",
			"g-controller",
			{
				taskId,
				nodeId: "node:agt-05",
				expectedTaskVersion: 4,
				expectedNodeVersion: 3,
				resultSummary: "delivery guard observed",
				idempotencyKey: "agt-05-complete-node",
			},
		);
		assert.equal(completedResponse.status, 200);
		assert.equal(
			(await host.taskDriverPorts.getTask(taskId)).status,
			"SUCCEEDED",
		);

		// Terminal: getPendingMessage re-reads Task owner facts and fails closed.
		await assert.rejects(
			() => host.browserOwnerPorts.agent.getPendingMessage(messageRef),
			/TASK_TERMINAL/,
		);
		// Terminal: the Execution effect admission rejects collaboration.deliver for
		// both a normal role and the internal task-driver (which cannot bypass it).
		assert.equal(
			await host.executionIdentity.authorize({
				callerRef: "g-controller",
				taskId,
				capability: "collaboration.deliver",
				input: {
					roleRef: "g-controller",
					workerRef: "conversation:controller",
				},
			}),
			false,
		);
		assert.equal(
			await host.executionIdentity.authorize({
				callerRef: "execution-runtime:task-driver",
				taskId,
				capability: "collaboration.deliver",
				input: {
					roleRef: "g-controller",
					workerRef: "conversation:controller",
				},
			}),
			false,
		);
	} finally {
		await host.stop();
		await owner.close();
	}
});
