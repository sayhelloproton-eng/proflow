import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	createPlatformHost,
	parsePlatformHostConfig,
} from "@tomflow/proflow-platform-host";
import { applyMigrations } from "@tomflow/proflow-task-migration-runner";
import { createTaskServices } from "@tomflow/proflow-task-orchestration";
import {
	SqliteTaskStore,
	taskMigrations,
} from "@tomflow/proflow-task-store-sqlite";

import { createAgentGateway } from "../src/index.ts";

const packages = {
	product: "@tomflow/proflow-agent-product",
	dev: "@tomflow/proflow-agent-controller-dev",
	test: "@tomflow/proflow-agent-test-ops",
} as const;
const roles = {
	product: "g-product",
	dev: "g-controller",
	test: "g-test",
} as const;

const SMALL_MARKER = "SMALL-MARKER-abc123";
const smallContent = `# Requirement\n${SMALL_MARKER}\n`;

function ok<T>(result: { ok: boolean; data?: T; error?: unknown }): T {
	if (!result.ok || result.data === undefined)
		throw new Error(JSON.stringify(result.error));
	return result.data;
}

function roleBindings() {
	return [
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
	];
}

async function seedTasks(stateRoot: string, workspaceRoot: string) {
	await mkdir(workspaceRoot, { recursive: true });
	const databasePath = join(stateRoot, "state", "task.sqlite");
	assert.equal(
		applyMigrations({ databasePath, migrations: taskMigrations }).ok,
		true,
	);
	const store = new SqliteTaskStore({ databasePath });
	try {
		const services = createTaskServices({ store, workspaceRoot });
		const createdA = ok(
			services.commands.createTask({
				taskId: "task-a",
				title: "File Bridge task A",
				objective: "Prove owner-produced outbound File Bridge",
				plan: {
					nodes: [
						{
							nodeId: "node-a-dev",
							title: "Implement",
							objective: "Implement",
							requiredAgentPackageRef: packages.dev,
							inputDocuments: ["REQUIREMENT"],
							outputDocuments: ["TECHNICAL_DESIGN"],
						},
					],
				},
				initialDocuments: [
					{ documentType: "REQUIREMENT", content: smallContent },
					{ documentType: "TECHNICAL_DESIGN", content: "L".repeat(120_000) },
				],
				roleBindings: roleBindings(),
				actorRef: "extension:new-task",
				idempotencyKey: "create:task-a",
			}),
		);
		ok(
			services.commands.bindTaskWorker({
				taskId: createdA.taskId,
				agentPackageRef: packages.product,
				roleRef: roles.product,
				workerRef: "c-product-a",
				conversationLocator: `https://chatgpt.com/g/${roles.product}/c/c-product-a`,
				expectedTaskVersion: createdA.version,
				actorRef: "platform-host:worker-provisioning",
				idempotencyKey: "bind:task-a:product",
			}),
		);
		const createdB = ok(
			services.commands.createTask({
				taskId: "task-b",
				title: "File Bridge task B",
				objective: "Prove cross-task read rejection",
				plan: {
					nodes: [
						{
							nodeId: "node-b-dev",
							title: "Implement",
							objective: "Implement",
							requiredAgentPackageRef: packages.dev,
							inputDocuments: ["REQUIREMENT"],
							outputDocuments: ["TECHNICAL_DESIGN"],
						},
					],
				},
				initialDocuments: [
					{ documentType: "REQUIREMENT", content: smallContent },
				],
				roleBindings: roleBindings(),
				actorRef: "extension:new-task",
				idempotencyKey: "create:task-b",
			}),
		);
		ok(
			services.commands.bindTaskWorker({
				taskId: createdB.taskId,
				agentPackageRef: packages.product,
				roleRef: roles.product,
				workerRef: "c-product-b",
				conversationLocator: `https://chatgpt.com/g/${roles.product}/c/c-product-b`,
				expectedTaskVersion: createdB.version,
				actorRef: "platform-host:worker-provisioning",
				idempotencyKey: "bind:task-b:product",
			}),
		);
	} finally {
		store.close();
	}
}

function hostConfig(stateRoot: string, workspaceRoot: string, baseUrl: string) {
	return parsePlatformHostConfig({
		stateRoot,
		workspaceRoot,
		host: "127.0.0.1",
		port: 0,
		executionBaseUrl: baseUrl,
		modelBaseUrl: baseUrl,
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
	});
}

async function dependencyStub() {
	const server = createServer((_request, response) => {
		response.setHeader("content-type", "application/json");
		response.end(JSON.stringify({ status: "READY" }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		assert.fail("missing dependency stub port");
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

const credentials = new Map<string, string>([
	["cred-product", roles.product],
	["cred-controller", roles.dev],
	["cred-test", roles.test],
]);

test("R2-P1-22 real getTaskDocument File Bridge chain: admission → descriptor → openaiFileResponse", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-file-bridge-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const stateRoot = join(root, ".proflow");
	const workspaceRoot = join(root, "project");
	await seedTasks(stateRoot, workspaceRoot);
	const dependency = await dependencyStub();
	context.after(() => dependency.close());
	const hostLogs: Array<Record<string, unknown>> = [];
	const host = createPlatformHost({
		config: hostConfig(stateRoot, workspaceRoot, dependency.baseUrl),
		log: (entry) => hostLogs.push(entry),
	});
	let hostBaseUrl = "";
	const gateway = await createAgentGateway({
		relayBaseUrl: "https://gateway.example/relay/",
		owners: {
			async authenticateBearer(credential) {
				const roleRef = credentials.get(credential);
				if (!roleRef) throw new Error("AUTHENTICATION_FAILED");
				return roleRef;
			},
			async route(operationId, authenticatedRoleRef, input) {
				const response = await fetch(
					`${hostBaseUrl}/actions/${encodeURIComponent(operationId)}`,
					{
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ authenticatedRoleRef, input }),
					},
				);
				const body = (await response.json()) as unknown;
				if (!response.ok)
					throw Object.assign(new Error("DOWNSTREAM_UNAVAILABLE"), {
						httpStatus: response.status,
						downstream: body,
					});
				return body;
			},
			async readiness() {
				return {
					credentialStore: true,
					agent: true,
					task: true,
					execution: true,
					relay: true,
				};
			},
		},
	});
	try {
		const started = await host.start();
		hostBaseUrl = `http://${started.host}:${started.port}`;
		const address = await gateway.start();
		const baseUrl = `http://${address.host}:${address.port}`;
		const getDocument = (body: unknown, credential = "cred-product") =>
			fetch(`${baseUrl}/actions/getTaskDocument`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${credential}`,
				},
				body: JSON.stringify(body),
			});

		// (a) + (c) authorized small TaskDocument → inline openaiFileResponse.
		const small = await getDocument({
			taskId: "task-a",
			documentType: "REQUIREMENT",
		});
		assert.equal(small.status, 200);
		const smallBody = (await small.json()) as {
			openaiFileResponse: Array<Record<string, string>>;
		};
		assert.equal(smallBody.openaiFileResponse.length, 1);
		const inline = smallBody.openaiFileResponse[0];
		assert.ok(inline);
		assert.equal(inline.kind, "inline");
		assert.equal(inline.name, "requirement.md");
		assert.equal(inline.mime_type, "text/markdown");
		assert.equal(
			Buffer.from(inline.content ?? "", "base64").toString("utf8"),
			smallContent,
		);

		// (d) large allowed document → relay URL.
		const large = await getDocument({
			taskId: "task-a",
			documentType: "TECHNICAL_DESIGN",
		});
		assert.equal(large.status, 200);
		const largeBody = (await large.json()) as {
			openaiFileResponse: Array<Record<string, string>>;
		};
		assert.equal(largeBody.openaiFileResponse.length, 1);
		const relay = largeBody.openaiFileResponse[0];
		assert.ok(relay);
		assert.equal(relay.kind, "url");
		assert.equal(relay.name, "technical-design.md");
		assert.match(
			relay.download_link ?? "",
			/^https:\/\/gateway\.example\/relay\//,
		);

		// (b) cross-task / wrong participant rejected before any file bytes.
		const crossTask = await getDocument({
			taskId: "task-a",
			documentType: "REQUIREMENT",
			workerRef: "c-product-b",
		});
		assert.equal(crossTask.status, 403);
		assert.equal(
			JSON.stringify(await crossTask.json()).includes(SMALL_MARKER),
			false,
		);

		const wrongParticipant = await getDocument(
			{
				taskId: "task-a",
				documentType: "REQUIREMENT",
			},
			"cred-controller",
		);
		assert.equal(wrongParticipant.status, 403);

		// The Host itself rejects the wrong-participant read with a typed admission
		// error before the Task Owner is asked for the document bytes.
		const hostDeny = await fetch(`${hostBaseUrl}/actions/getTaskDocument`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				authenticatedRoleRef: roles.product,
				input: {
					taskId: "task-a",
					documentType: "REQUIREMENT",
					workerRef: "c-product-b",
				},
			}),
		});
		assert.equal(hostDeny.status, 403);
		assert.equal(
			((await hostDeny.json()) as { error: string }).error,
			"TASK_WORKER_BINDING_MISMATCH",
		);

		// (f) no raw file bytes leak into structured logs.
		const logText = JSON.stringify(hostLogs);
		assert.equal(logText.includes(SMALL_MARKER), false);
		assert.equal(logText.includes("L".repeat(120_000)), false);
	} finally {
		await gateway.stop();
		await host.stop();
	}
});

test("R2-P1-22 gateway serializes only the explicit getTaskDocument descriptor and rejects image/video egress", async () => {
	const gateway = await createAgentGateway({
		relayBaseUrl: "https://gateway.example/relay/",
		owners: {
			async authenticateBearer() {
				return "g-product";
			},
			async route() {
				return {
					fileArtifacts: [
						{
							artifactRef: "artifact:spoof",
							name: "spoof.md",
							mimeType: "text/markdown",
							content: "spoofed bytes",
						},
					],
				};
			},
			async readiness() {
				return {
					credentialStore: true,
					agent: true,
					task: true,
					execution: true,
					relay: true,
				};
			},
		},
	});
	const address = await gateway.start();
	const baseUrl = `http://${address.host}:${address.port}`;
	try {
		const action = (operationId: string) =>
			fetch(`${baseUrl}/actions/${operationId}`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: "Bearer any",
				},
				body: JSON.stringify({
					taskId: "task-a",
					documentType: "REQUIREMENT",
				}),
			});

		const serialized = (await (await action("getTaskDocument")).json()) as {
			openaiFileResponse: unknown;
		};
		assert.equal(Array.isArray(serialized.openaiFileResponse), true);

		const plain = await action("getTask");
		assert.equal(plain.status, 200);
		assert.deepEqual(await plain.json(), {
			fileArtifacts: [
				{
					artifactRef: "artifact:spoof",
					name: "spoof.md",
					mimeType: "text/markdown",
					content: "spoofed bytes",
				},
			],
		});

		for (const mimeType of ["image/png", "video/mp4"])
			assert.throws(
				() =>
					gateway.serializeFileResponse([
						{
							artifactRef: "artifact:media",
							name: "media.bin",
							mimeType,
							bytes: Buffer.from("x"),
						},
					]),
				/OPENAI_FILE_RESPONSE_UNSUPPORTED_MEDIA/,
			);
	} finally {
		await gateway.stop();
	}
});
