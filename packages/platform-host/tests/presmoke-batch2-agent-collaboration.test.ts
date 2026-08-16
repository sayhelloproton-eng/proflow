import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
import { roleOperations } from "../src/role-operations.ts";

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

async function seedBoundTask(stateRoot: string, workspaceRoot: string) {
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
				taskId: "task-collaboration",
				title: "Collaboration",
				objective: "Prove durable cross-worker delivery",
				plan: {
					nodes: [
						{
							nodeId: "node-dev",
							title: "Dev",
							objective: "Collaborate",
							requiredAgentPackageRef: packages.dev,
							inputDocuments: ["REQUIREMENT"],
							outputDocuments: ["TECHNICAL_DESIGN"],
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
				idempotencyKey: "create:collaboration",
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
					idempotencyKey: `bind:${agentPackageRef}`,
				}),
			);
			version = bound.version;
		}
	} finally {
		store.close();
	}
}

async function seedTestOpsReadyNode(stateRoot: string, workspaceRoot: string) {
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
				taskId: "task-test-ops-start",
				title: "Test/Ops start",
				objective: "Prove canonical Test/Ops startNode route",
				plan: {
					nodes: [
						{
							nodeId: "node-test",
							title: "Test",
							objective: "Start as bound Test/Ops worker",
							requiredAgentPackageRef: packages.test,
							inputDocuments: ["REQUIREMENT"],
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
				idempotencyKey: "create:test-ops-start",
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
					idempotencyKey: `bind:test-ops:${agentPackageRef}`,
				}),
			);
			version = bound.version;
		}
		const started = ok(
			services.commands.startTask({
				taskId: created.taskId,
				expectedTaskVersion: version,
				actorRef: "human:operator",
				idempotencyKey: "start:test-ops-task",
			}),
		);
		const context = ok(
			services.queries.getNodeContext({
				taskId: created.taskId,
				nodeId: "node-test",
			}),
		);
		return {
			taskId: created.taskId,
			nodeId: "node-test",
			taskVersion: started.version,
			nodeVersion: context.node.version,
		};
	} finally {
		store.close();
	}
}

async function ownerReadinessStub() {
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

async function postAction(
	baseUrl: string,
	operation: string,
	authenticatedRoleRef: string,
	input: Record<string, unknown>,
) {
	const response = await fetch(`${baseUrl}/actions/${operation}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ authenticatedRoleRef, input }),
	});
	const body = (await response.json()) as Record<string, unknown>;
	if (!response.ok) throw new Error(JSON.stringify(body));
	return body;
}

test("CP-HOST-08 role management is authenticated and delegates register/show/list/validate/key/delete to Agent owner", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-role-management-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const stateRoot = join(root, ".proflow");
	const workspaceRoot = join(root, "project");
	await mkdir(workspaceRoot, { recursive: true });
	const dependency = await ownerReadinessStub();
	context.after(() => dependency.close());
	const host = createPlatformHost({
		config: parsePlatformHostConfig({
			stateRoot,
			workspaceRoot,
			host: "127.0.0.1",
			port: 0,
			executionBaseUrl: dependency.baseUrl,
			modelBaseUrl: dependency.baseUrl,
			roles: [],
		}),
	});
	context.after(() => host.stop());
	const address = await host.start();
	const baseUrl = `http://${address.host}:${address.port}`;
	const token = (
		await readFile(
			join(stateRoot, "agent/secrets/role-management.token"),
			"utf8",
		)
	).trim();
	assert.equal(
		(await stat(join(stateRoot, "agent/secrets/role-management.token"))).mode &
			0o777,
		0o600,
	);
	const invoke = async (operation: string, input: unknown = {}) => {
		const response = await fetch(`${baseUrl}/management/agent`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ operation, input }),
		});
		const body = await response.json();
		return { response, body };
	};
	assert.equal(
		(
			await fetch(`${baseUrl}/management/agent`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ operation: "role.list", input: {} }),
			})
		).status,
		401,
	);
	const registered = await invoke("role.register", {
		agentPackageRef: packages.product,
		registeredPackageVersion: "0.1.0",
		roleRef: roles.product,
		carrierUrl: `https://chatgpt.com/g/${roles.product}`,
	});
	assert.equal(registered.response.status, 200);
	assert.equal(
		(registered.body as { role: { roleRef: string } }).role.roleRef,
		roles.product,
	);
	assert.equal((await invoke("role.list")).response.status, 200);
	assert.equal(
		(
			(await invoke("role.show", { agentPackageRef: packages.product }))
				.body as { roleRef: string }
		).roleRef,
		roles.product,
	);
	assert.equal(
		(
			(
				await invoke("role.validate", {
					agentPackageRef: packages.product,
					expectedPackageVersion: "0.1.0",
				})
			).body as { status: string }
		).status,
		"PASS",
	);
	const drifted = (
		await invoke("role.validate", {
			agentPackageRef: packages.product,
			expectedPackageVersion: "0.2.0",
		})
	).body as { status: string; issues: string[] };
	assert.equal(drifted.status, "FAIL");
	assert.ok(
		drifted.issues.some((issue) =>
			issue.startsWith("ROLE_PACKAGE_VERSION_DRIFT:"),
		),
	);
	const oldKey = (
		await invoke("role.key.show", { agentPackageRef: packages.product })
	).body as { credential: string };
	const newKey = (
		await invoke("role.key.rotate", { agentPackageRef: packages.product })
	).body as { credential: string };
	assert.notEqual(newKey.credential, oldKey.credential);
	assert.equal(
		(await invoke("role.delete", { agentPackageRef: packages.product }))
			.response.status,
		200,
	);
});

test("RF-HOST-08 production Role delete consults Task Public ownership and leaves an in-use Role unchanged", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-role-delete-in-use-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const stateRoot = join(root, ".proflow");
	const workspaceRoot = join(root, "project");
	await seedBoundTask(stateRoot, workspaceRoot);
	const dependency = await ownerReadinessStub();
	context.after(() => dependency.close());
	const host = createPlatformHost({
		config: parsePlatformHostConfig({
			stateRoot,
			workspaceRoot,
			host: "127.0.0.1",
			port: 0,
			executionBaseUrl: dependency.baseUrl,
			modelBaseUrl: dependency.baseUrl,
			roles: [],
		}),
	});
	context.after(() => host.stop());
	const address = await host.start();
	const token = (
		await readFile(
			join(stateRoot, "agent/secrets/role-management.token"),
			"utf8",
		)
	).trim();
	const invoke = async (operation: string, input: unknown = {}) => {
		const response = await fetch(
			`http://${address.host}:${address.port}/management/agent`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({ operation, input }),
			},
		);
		return {
			response,
			body: (await response.json()) as Record<string, unknown>,
		};
	};
	assert.equal(
		(
			await invoke("role.register", {
				agentPackageRef: packages.product,
				registeredPackageVersion: "0.1.0",
				roleRef: roles.product,
				carrierUrl: `https://chatgpt.com/g/${roles.product}`,
			})
		).response.status,
		200,
	);
	const refused = await invoke("role.delete", {
		agentPackageRef: packages.product,
	});
	assert.equal(refused.response.status, 400);
	assert.equal(refused.body.error, "ROLE_IN_USE");
	const stillRegistered = await invoke("role.show", {
		agentPackageRef: packages.product,
	});
	assert.equal(stillRegistered.response.status, 200);
	assert.equal(stillRegistered.body.roleRef, roles.product);
});

test("CP-HOST-09 platform-host remains pure composition and does not own Collaboration scheduling", async () => {
	const source = await readFile(
		new URL("../src/index.ts", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(
		source,
		/drivePendingCollaboration|collaboration-observer/,
	);
	assert.doesNotMatch(
		source,
		/setInterval\([^)]*collaboration|collaboration[^\n]*setInterval/i,
	);
	assert.match(source, /getPendingMessage/);
	assert.match(source, /reportCollaborationDelivery/);
});

test("CP-HOST-10 Test/Ops bound Worker can invoke startNode through the formal platform-host owner route", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-test-ops-start-node-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const stateRoot = join(root, ".proflow");
	const workspaceRoot = join(root, "project");
	const seeded = await seedTestOpsReadyNode(stateRoot, workspaceRoot);
	const dependency = await ownerReadinessStub();
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
	const address = await host.start();
	const result = await postAction(
		`http://${address.host}:${address.port}`,
		"startNode",
		roles.test,
		{
			taskId: seeded.taskId,
			nodeId: seeded.nodeId,
			expectedTaskVersion: seeded.taskVersion,
			expectedNodeVersion: seeded.nodeVersion,
			idempotencyKey: "test-ops:start-node",
		},
	);
	assert.equal(result.ok, true);
	assert.equal((result.data as { workerRef: string }).workerRef, workers.test);
});

function openApiOperationIds(text: string) {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("operationId:"))
		.map((line) => line.slice("operationId:".length).trim())
		.sort();
}

test("CP-HOST-10 all shipped Role OpenAPI operation inventories exactly match platform-host ACL", async () => {
	for (const [agentPackageRef, relativeOpenApi] of [
		[
			packages.product,
			"../../agent-product/actions/custom-gpt.openapi.yaml",
		],
		[
			packages.dev,
			"../../agent-controller-dev/actions/custom-gpt.openapi.yaml",
		],
		[
			packages.test,
			"../../agent-test-ops/actions/custom-gpt.openapi.yaml",
		],
	] as const) {
		const openApi = await readFile(
			new URL(relativeOpenApi, import.meta.url),
			"utf8",
		);
		const shipped = openApiOperationIds(openApi);
		const authorized = [...roleOperations[agentPackageRef]].sort();
		assert.deepEqual(
			authorized,
			shipped,
			`${agentPackageRef} Host ACL must equal the shipped Role OpenAPI surface`,
		);
	}
	assert.equal(roleOperations[packages.test].has("startNode"), true);
});
