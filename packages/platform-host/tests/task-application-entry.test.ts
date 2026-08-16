import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
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
	assert.match(source, /ensureTaskWorkers\(created\.taskId\)/);
	assert.match(source, /capability: "worker\.create"/);
	assert.match(source, /new-task-worker:\$\{taskId\}:\$\{role\.roleRef\}/);
	assert.match(
		source,
		/if \(binding\.workerRef && binding\.conversationLocator\) return/,
	);
	assert.match(source, /WORKER_CREATE_BINDING_NOT_PERSISTED/);
	assert.doesNotMatch(source, /TaskApplicationRepository|ApplicationTaskStore/);
});

test("PRESMOKE-B3-APP-03 New Task behavior is PENDING-first, provisions exactly three fixed Workers through Execution, then reaches READY and starts through Task Owner", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-platform-host-new-task-"));
	const stateRoot = join(root, ".proflow");
	let applicationBaseUrl = "";
	let applicationToken = "";
	const workerCreateRequests: Array<Record<string, unknown>> = [];
	const statusesBeforeBind: string[] = [];
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
			const workerRef = `c-${roleRef.slice(2)}`;
			const beforeBind = await fetch(`${applicationBaseUrl}/application/task`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${applicationToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ operation: "task.get", input: { taskId } }),
			});
			assert.equal(beforeBind.status, 200);
			statusesBeforeBind.push(
				String(((await beforeBind.json()) as { status?: string }).status),
			);
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
					executionRef: `execution:${roleRef}`,
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
					input: {
						taskId: "task:j1-behavior",
						title: "J1 behavior",
						objective: "Prove Task Owner plus three fixed Workers",
						plan: {
							nodes: [
								{
									nodeId: "dev",
									title: "Implement",
									objective: "Implement",
									requiredAgentPackageRef:
										"@tomflow/proflow-agent-controller-dev",
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
						initialDocuments: [
							{ documentType: "REQUIREMENT", content: "requirement" },
						],
						idempotencyKey: "j1-create",
					},
				}),
			},
		);
		assert.equal(createResponse.status, 200);
		const created = (await createResponse.json()) as {
			taskId: string;
			status: string;
			version: number;
			roleBindings: Array<{
				workerRef: string | null;
				conversationLocator: string | null;
			}>;
		};
		assert.equal(created.status, "READY");
		assert.equal(created.roleBindings.length, 3);
		assert.equal(
			created.roleBindings.every(
				(binding) =>
					binding.workerRef !== null && binding.conversationLocator !== null,
			),
			true,
		);
		assert.equal(workerCreateRequests.length, 3);
		assert.deepEqual(statusesBeforeBind, ["PENDING", "PENDING", "PENDING"]);
		assert.equal(
			new Set(workerCreateRequests.map((request) => request.idempotencyKey))
				.size,
			3,
		);

		const startResponse = await fetch(
			`${applicationBaseUrl}/application/task`,
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${applicationToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					operation: "task.start",
					input: {
						taskId: created.taskId,
						expectedTaskVersion: created.version,
						idempotencyKey: "j1-start",
					},
				}),
			},
		);
		assert.equal(startResponse.status, 200);
		const startedTask = (await startResponse.json()) as {
			status: string;
			currentNodeId: string | null;
		};
		assert.equal(startedTask.status, "ACTIVE");
		assert.equal(startedTask.currentNodeId, "dev");
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
					input: {
						taskId: "task:j1-recovery",
						title: "J1 recovery",
						objective: "Recover only missing Workers",
						plan: {
							nodes: [
								{
									nodeId: "dev",
									title: "Implement",
									objective: "Implement",
									requiredAgentPackageRef:
										"@tomflow/proflow-agent-controller-dev",
									inputDocuments: ["REQUIREMENT"],
									outputDocuments: [],
								},
							],
						},
						initialDocuments: [
							{ documentType: "REQUIREMENT", content: "requirement" },
						],
						idempotencyKey: "j1-recovery-create",
					},
				}),
			},
		);
		assert.notEqual(createResponse.status, 200);

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
