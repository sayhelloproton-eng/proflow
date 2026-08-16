import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPlatformHost, parsePlatformHostConfig } from "../src/index.ts";

function config(stateRoot: string, workspaceRoot: string, baseUrl: string) {
	return parsePlatformHostConfig({
		stateRoot,
		workspaceRoot,
		host: "127.0.0.1",
		port: 0,
		executionBaseUrl: baseUrl,
		modelBaseUrl: baseUrl,
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
	});
}

interface TaskShape {
	taskId: string;
	status: string;
	version: number;
	roleBindings: Array<{
		roleRef: string;
		agentPackageRef: string;
		workerRef: string | null;
		conversationLocator: string | null;
	}>;
}

interface HeldWorker {
	taskId: string;
	roleRef: string;
	response: ServerResponse;
}

async function bindWorker(
	baseUrl: string,
	token: string,
	taskId: string,
	roleRef: string,
	workerRef: string,
): Promise<number> {
	const bind = await fetch(`${baseUrl}/application/observer`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			operation: "browser.bindWorker",
			input: {
				taskId,
				roleRef,
				workerRef,
				conversationLocator: `https://chatgpt.com/g/${roleRef}/c/${workerRef}`,
			},
		}),
	});
	return bind.status;
}

async function taskOperation(
	baseUrl: string,
	token: string,
	operation: string,
	input: Record<string, unknown>,
): Promise<unknown> {
	const response = await fetch(`${baseUrl}/application/task`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ operation, input }),
	});
	const body = await response.json();
	if (response.status !== 200) {
		throw new Error(`${operation} failed: ${JSON.stringify(body)}`);
	}
	return { status: response.status, body };
}

function createTaskInput(taskId: string, idempotencyKey: string) {
	return {
		taskId,
		title: "J1 behavior",
		objective: "Prove Product binds durably while Dev/Test continue",
		plan: {
			nodes: [
				{
					nodeId: "dev",
					title: "Implement",
					objective: "Implement",
					requiredAgentPackageRef: "@tomflow/proflow-agent-controller-dev",
					inputDocuments: ["REQUIREMENT"],
					outputDocuments: [],
				},
				{
					nodeId: "test",
					title: "Verify",
					objective: "Verify",
					requiredAgentPackageRef: "@tomflow/proflow-agent-test-ops",
					inputDocuments: ["REQUIREMENT"],
					outputDocuments: [],
				},
			],
		},
		initialDocuments: [{ documentType: "REQUIREMENT", content: "requirement" }],
		idempotencyKey,
	};
}

test("PRESMOKE-B3-APP-02 New Task application owns no Task truth and provisions only missing fixed workers through Execution", async () => {
	const source = await readFile(
		new URL("../src/index.ts", import.meta.url),
		"utf8",
	);
	assert.match(source, /operation === "task\.create"/);
	assert.match(source, /task\.commands\.createTask/);
	assert.match(source, /rolePackageRefs\.map/);
	assert.match(source, /workerRef: null/);
	assert.match(source, /conversationLocator: null/);
	assert.match(source, /ensureTaskWorkers\(created\.taskId/);
	assert.match(
		source,
		/waitFor: \[roleForPackage\("@tomflow\/proflow-agent-product"\)\.roleRef\]/,
	);
	assert.match(source, /capability: "worker\.create"/);
	assert.match(source, /new-task-worker:\$\{taskId\}:\$\{role\.roleRef\}/);
	assert.match(
		source,
		/if \(binding\.workerRef && binding\.conversationLocator\) return/,
	);
	assert.match(source, /WORKER_CREATE_BINDING_NOT_PERSISTED/);
	assert.doesNotMatch(source, /TaskApplicationRepository|ApplicationTaskStore/);
});

test("R2-P1-18-APP-03 Product binds durably while Dev/Test are held; recovery fills only missing Workers", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-platform-host-new-task-"));
	const stateRoot = join(root, ".proflow");
	let applicationBaseUrl = "";
	let applicationToken = "";
	const workerCreateRequests: Array<Record<string, unknown>> = [];
	const held = new Map<string, HeldWorker>();
	const heldAttempts = new Map<string, number>();
	const dependency = createServer(async (request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.url === "/ready") {
			response.end(JSON.stringify({ status: "READY" }));
			return;
		}
		if (request.url === "/executions" && request.method === "POST") {
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(Buffer.from(chunk));
			const executionRequest = JSON.parse(
				Buffer.concat(chunks).toString("utf8"),
			) as Record<string, unknown>;
			workerCreateRequests.push(executionRequest);
			assert.equal(executionRequest.capability, "worker.create");
			const taskId = String(executionRequest.taskId);
			const roleRef = String(executionRequest.roleRef);
			if (roleRef === "g-product") {
				assert.equal(
					await bindWorker(
						applicationBaseUrl,
						applicationToken,
						taskId,
						roleRef,
						"c-product",
					),
					200,
				);
				response.end(
					JSON.stringify({
						executionRef: "execution:product",
						status: "SUCCEEDED",
						sideEffectState: "APPLIED",
					}),
				);
				return;
			}
			// Hold the FIRST Dev/Test Worker creation so the Product path is
			// provably usable before those roles settle; a recovery retry resolves.
			const attempt = (heldAttempts.get(roleRef) ?? 0) + 1;
			heldAttempts.set(roleRef, attempt);
			if (attempt === 1) {
				held.set(roleRef, { taskId, roleRef, response });
				return;
			}
			const workerRef = `c-${roleRef.slice(2)}`;
			assert.equal(
				await bindWorker(
					applicationBaseUrl,
					applicationToken,
					taskId,
					roleRef,
					workerRef,
				),
				200,
			);
			response.end(
				JSON.stringify({
					executionRef: `execution:${roleRef}:${attempt}`,
					status: "SUCCEEDED",
					sideEffectState: "APPLIED",
				}),
			);
			return;
		}
		response.end(JSON.stringify({ status: "READY" }));
	});
	await new Promise<void>((resolve) =>
		dependency.listen(0, "127.0.0.1", resolve),
	);
	const address = dependency.address();
	if (!address || typeof address === "string")
		assert.fail("missing dependency port");
	const dependencyBase = `http://127.0.0.1:${address.port}`;
	const host = createPlatformHost({
		config: config(stateRoot, join(root, "project"), dependencyBase),
	});
	try {
		const started = await host.start();
		applicationBaseUrl = `http://${started.host}:${started.port}`;
		applicationToken = (
			await readFile(
				join(stateRoot, "browser", "secrets", "task-application.token"),
				"utf8",
			)
		).trim();

		const created = (await taskOperation(
			applicationBaseUrl,
			applicationToken,
			"task.create",
			createTaskInput("task:j1-product-first", "j1-create"),
		)) as { status: number; body: TaskShape };
		assert.equal(created.status, 200);
		assert.equal(created.body.status, "PENDING");
		const product = created.body.roleBindings.find(
			(binding) => binding.roleRef === "g-product",
		);
		assert.equal(product?.workerRef, "c-product");
		assert.equal(product?.conversationLocator !== null, true);
		assert.equal(
			created.body.roleBindings
				.filter((binding) => binding.roleRef !== "g-product")
				.every((binding) => binding.workerRef === null),
			true,
		);

		// Product's durable Worker binding is the admission precondition for the
		// requirement read/write Actions, so the requirement path is usable now.
		assert.equal(product?.workerRef, "c-product");
		assert.equal(product?.conversationLocator !== null, true);

		// Release Dev (success) and fail Test, then recover only the missing role.
		const dev = held.get("g-controller");
		const testHeld = held.get("g-test");
		assert.ok(dev && testHeld);
		assert.equal(
			await bindWorker(
				applicationBaseUrl,
				applicationToken,
				dev.taskId,
				dev.roleRef,
				"c-controller",
			),
			200,
		);
		dev.response.end(
			JSON.stringify({
				executionRef: "execution:controller",
				status: "SUCCEEDED",
				sideEffectState: "APPLIED",
			}),
		);
		testHeld.response.end(
			JSON.stringify({
				executionRef: "execution:test:first-failure",
				status: "FAILED",
				sideEffectState: "NOT_APPLIED",
			}),
		);
		await new Promise((resolveWait) => setTimeout(resolveWait, 50));

		const recovered = (await taskOperation(
			applicationBaseUrl,
			applicationToken,
			"task.ensureWorkers",
			{ taskId: "task:j1-product-first" },
		)) as { status: number; body: TaskShape };
		assert.equal(recovered.status, 200);
		assert.equal(recovered.body.status, "READY");
		assert.equal(
			recovered.body.roleBindings.every(
				(binding) => binding.workerRef !== null,
			),
			true,
		);
		// Product binding is preserved, never rebuilt.
		assert.equal(
			recovered.body.roleBindings.find(
				(binding) => binding.roleRef === "g-product",
			)?.workerRef,
			"c-product",
		);
		// Product was created exactly once.
		assert.equal(
			workerCreateRequests.filter((request) => request.roleRef === "g-product")
				.length,
			1,
		);
	} finally {
		await host.stop();
		await new Promise<void>((resolve) => dependency.close(() => resolve()));
	}
});

test("PRESMOKE-B3-APP-04 partial Worker provisioning failure persists successful binding and ensureWorkers only fills missing Workers", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "proflow-platform-host-worker-recovery-"),
	);
	const stateRoot = join(root, ".proflow");
	let applicationBaseUrl = "";
	let applicationToken = "";
	const attempts = new Map<string, number>();
	const dependency = createServer(async (request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.url === "/ready") {
			response.end(JSON.stringify({ status: "READY" }));
			return;
		}
		if (request.url === "/executions" && request.method === "POST") {
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(Buffer.from(chunk));
			const executionRequest = JSON.parse(
				Buffer.concat(chunks).toString("utf8"),
			) as Record<string, unknown>;
			assert.equal(executionRequest.capability, "worker.create");
			const taskId = String(executionRequest.taskId);
			const roleRef = String(executionRequest.roleRef);
			const attempt = (attempts.get(roleRef) ?? 0) + 1;
			attempts.set(roleRef, attempt);
			if (roleRef === "g-controller" && attempt === 1) {
				response.end(
					JSON.stringify({
						executionRef: "execution:g-controller:first-failure",
						status: "FAILED",
						sideEffectState: "NOT_APPLIED",
					}),
				);
				return;
			}
			const workerRef = `c-${roleRef.slice(2)}`;
			const bind = await fetch(`${applicationBaseUrl}/application/observer`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${applicationToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					operation: "browser.bindWorker",
					input: {
						taskId,
						roleRef,
						workerRef,
						conversationLocator: `https://chatgpt.com/g/${roleRef}/c/${workerRef}`,
					},
				}),
			});
			assert.equal(bind.status, 200);
			response.end(
				JSON.stringify({
					executionRef: `execution:${roleRef}:${attempt}`,
					status: "SUCCEEDED",
					sideEffectState: "APPLIED",
				}),
			);
			return;
		}
		response.end(JSON.stringify({ status: "READY" }));
	});
	await new Promise<void>((resolve) =>
		dependency.listen(0, "127.0.0.1", resolve),
	);
	const address = dependency.address();
	if (!address || typeof address === "string")
		assert.fail("missing dependency port");
	const dependencyBase = `http://127.0.0.1:${address.port}`;
	const host = createPlatformHost({
		config: config(stateRoot, join(root, "project"), dependencyBase),
	});
	try {
		const started = await host.start();
		applicationBaseUrl = `http://${started.host}:${started.port}`;
		applicationToken = (
			await readFile(
				join(stateRoot, "browser", "secrets", "task-application.token"),
				"utf8",
			)
		).trim();
		const createResponse = await fetch(
			`${applicationBaseUrl}/application/task`,
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${applicationToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					operation: "task.create",
					input: createTaskInput("task:j1-recovery", "j1-recovery-create"),
				}),
			},
		);
		assert.equal(createResponse.status, 200);
		await new Promise((resolveWait) => setTimeout(resolveWait, 50));

		const pendingResponse = await fetch(
			`${applicationBaseUrl}/application/task`,
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${applicationToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					operation: "task.get",
					input: { taskId: "task:j1-recovery" },
				}),
			},
		);
		assert.equal(pendingResponse.status, 200);
		const pending = (await pendingResponse.json()) as {
			status: string;
			roleBindings: Array<{ roleRef: string; workerRef: string | null }>;
		};
		assert.equal(pending.status, "PENDING");
		assert.equal(
			pending.roleBindings.find((binding) => binding.roleRef === "g-product")
				?.workerRef,
			"c-product",
		);
		assert.equal(
			pending.roleBindings.find((binding) => binding.roleRef === "g-controller")
				?.workerRef,
			null,
		);

		const recoveryResponse = await fetch(
			`${applicationBaseUrl}/application/task`,
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${applicationToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					operation: "task.ensureWorkers",
					input: { taskId: "task:j1-recovery" },
				}),
			},
		);
		assert.equal(recoveryResponse.status, 200);
		const recovered = (await recoveryResponse.json()) as {
			status: string;
			roleBindings: Array<{ workerRef: string | null }>;
		};
		assert.equal(recovered.status, "READY");
		assert.equal(
			recovered.roleBindings.every((binding) => binding.workerRef !== null),
			true,
		);
		assert.equal(attempts.get("g-product"), 1);
		assert.equal(attempts.get("g-controller"), 2);
		assert.equal(attempts.get("g-test"), 1);
	} finally {
		await host.stop();
		await new Promise<void>((resolve) => dependency.close(() => resolve()));
	}
});
