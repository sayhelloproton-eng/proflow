import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAgentGatewayProcess } from "@tomflow/proflow-agent-gateway/process";
import { createExecutionRuntimeProcess } from "@tomflow/proflow-execution-runtime/service";
import { createModelRuntimeProcess } from "@tomflow/proflow-model-runtime/process";
import { systemHealthAssessmentSpec } from "@tomflow/proflow-model-runtime/specs/system-health-assessment";
import { createPlatformHost, parsePlatformHostConfig } from "../src/index.ts";

test("real local business runtime integrates Gateway, Task, Agent, Execution and Model with restart recovery", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-business-runtime-"));
	const projectRoot = join(root, "project");
	const stateRoot = join(root, ".proflow");
	await writeFile(join(root, "placeholder"), "root");
	await mkdir(projectRoot, { recursive: true });
	await writeFile(
		join(projectRoot, "package.json"),
		JSON.stringify({ name: "integration-project", version: "1.0.0" }),
	);

	let providerCalls = 0;
	const provider = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request)
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
			model: string;
		};
		providerCalls += 1;
		const output = JSON.stringify({
			decision: "HEALTHY",
			confidence: 1,
			reasonCode: "ALL_CHECKS_PASS",
			rationale: "all checks pass",
		});
		response.setHeader("content-type", "application/json");
		response.end(
			JSON.stringify({
				id: `provider:${providerCalls}`,
				choices: [
					{
						message: {
							content:
								body.model === "reason-model"
									? `<think>bounded</think>${output}`
									: output,
						},
					},
				],
			}),
		);
	});
	await new Promise<void>((resolve) =>
		provider.listen(0, "127.0.0.1", resolve),
	);
	const providerAddress = provider.address();
	if (!providerAddress || typeof providerAddress === "string")
		assert.fail("missing provider address");
	const profile = {
		inputModalities: ["text"] as ["text"],
		structuredOutput: "native" as const,
		contextWindow: 32_000,
		maxOutputTokens: 2_048,
	};
	const model = await createModelRuntimeProcess({
		config: {
			host: "127.0.0.1",
			port: 0,
			stateRoot,
			providerBaseUrl: `http://127.0.0.1:${providerAddress.port}/v1/`,
			models: { fast: "fast-model", reason: "reason-model" },
			profiles: {
				fast: {
					...profile,
					modelRef: "fast-model",
					reasoningModes: ["no-thinking"],
				},
				reason: {
					...profile,
					modelRef: "reason-model",
					reasoningModes: ["thinking"],
				},
			},
			capabilityFacts: {
				fast: {
					contextWindow: 32_000,
					maxOutputTokens: 2_048,
					basis: "bounded-probe",
				},
				reason: {
					contextWindow: 32_000,
					maxOutputTokens: 2_048,
					basis: "bounded-probe",
				},
			},
		},
	});
	const modelAddress = await model.start();
	const modelBaseUrl = `http://${modelAddress.host}:${modelAddress.port}`;

	const execution = await createExecutionRuntimeProcess({
		config: {
			databasePath: join(stateRoot, "execution", "execution.sqlite"),
			projectRoot,
			artifactRoot: join(stateRoot, "execution", "artifacts"),
			host: "127.0.0.1",
			port: 0,
			exactNetworkTargets: [],
		},
		policy: {
			decide: () => ({
				decision: "REVIEW",
				decisionPath: "deterministic",
				approvalRequired: false,
			}),
		},
		modelDecision: {
			async decide() {
				const response = await fetch(`${modelBaseUrl}/infer`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						contractVersion: "1.0.0",
						specRef: systemHealthAssessmentSpec.specRef,
						mode: "fast",
						priority: "business",
						trace: { callerRef: "execution-runtime:admission" },
						payload: {
							service: "execution-runtime",
							checks: [{ name: "policy", state: "PASS" }],
						},
					}),
				});
				assert.equal(response.status, 200);
				const inference = (await response.json()) as {
					status: string;
					data?: { decision?: string };
				};
				assert.equal(inference.status, "SUCCEEDED");
				assert.equal(inference.data?.decision, "HEALTHY");
				return { decision: "ALLOW", decisionPath: "fast" };
			},
		},
	});
	const executionAddress = await execution.start();
	const executionBaseUrl = `http://${executionAddress.host}:${executionAddress.port}`;

	const host = createPlatformHost({
		config: parsePlatformHostConfig({
			stateRoot,
			workspaceRoot: projectRoot,
			host: "127.0.0.1",
			port: 0,
			executionBaseUrl,
			modelBaseUrl,
			roles: [
				{
					agentPackageRef: "@tomflow/proflow-agent-product",
					registeredPackageVersion: "0.1.0",
					roleRef: "g-integration-product",
					carrierUrl: "https://chatgpt.com/g/g-integration-product",
				},
				{
					agentPackageRef: "@tomflow/proflow-agent-controller-dev",
					registeredPackageVersion: "0.1.0",
					roleRef: "g-integration-controller",
					carrierUrl: "https://chatgpt.com/g/g-integration-controller",
				},
			],
		}),
	});
	const hostAddress = await host.start();
	const hostBaseUrl = `http://${hostAddress.host}:${hostAddress.port}`;
	const credentialPath = join(
		stateRoot,
		"agent",
		"secrets",
		"role-credentials.json",
	);
	const credentials = JSON.parse(
		await readFile(credentialPath, "utf8"),
	) as Record<string, string>;
	const controllerCredential = credentials["g-integration-controller"];
	const productCredential = credentials["g-integration-product"];
	assert.ok(controllerCredential);
	assert.ok(productCredential);
	const gateway = await createAgentGatewayProcess({
		config: {
			host: "127.0.0.1",
			port: 0,
			publicBaseUrl: "https://gateway.example",
			downstreamBaseUrl: hostBaseUrl,
			credentialFile: credentialPath,
		},
	});
	try {
		const gatewayAddress = await gateway.start();
		const gatewayBaseUrl = `http://${gatewayAddress.host}:${gatewayAddress.port}`;
		assert.equal((await fetch(`${gatewayBaseUrl}/ready`)).status, 200);
		const taskResponse = await fetch(`${gatewayBaseUrl}/actions/createTask`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${productCredential}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				taskId: "task:business-runtime",
				title: "Business runtime integration",
				objective: "Prove owner contract wiring",
				plan: {
					nodes: [
						{
							nodeId: "node:business-runtime",
							title: "Inspect project",
							objective: "Run a real local capability",
							requiredRoleRef: "g-integration-controller",
							inputDocuments: [],
							outputDocuments: [],
						},
					],
				},
				initialDocuments: [],
				roleBindings: [
					{
						roleRef: "g-integration-product",
						workerRef: "worker:integration-product",
					},
					{
						roleRef: "g-integration-controller",
						workerRef: "worker:integration-controller",
					},
				],
				idempotencyKey: "business-runtime-create-task",
			}),
		});
		assert.equal(taskResponse.status, 200);
		assert.equal(((await taskResponse.json()) as { ok: boolean }).ok, true);
		await host.taskDriverPorts.authorizeTask({
			taskId: "task:business-runtime",
			expectedTaskVersion: 1,
			authorizedByRef: "human:integration-operator",
			idempotencyKey: "business-runtime-authorize",
		});
		await host.taskDriverPorts.startTask({
			taskId: "task:business-runtime",
			expectedTaskVersion: 2,
			idempotencyKey: "business-runtime-start-task",
		});
		await host.taskDriverPorts.startNode({
			taskId: "task:business-runtime",
			nodeId: "node:business-runtime",
			expectedTaskVersion: 3,
			expectedNodeVersion: 2,
			idempotencyKey: "business-runtime-start-node",
		});
		const callsBeforeExecution = providerCalls;
		const executionResponse = await fetch(
			`${gatewayBaseUrl}/actions/executeCapability`,
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${controllerCredential}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					contract: "execution",
					contractVersion: "1.0.0",
					idempotencyKey: "business-runtime-project-info",
					capability: "project.info",
					input: {},
					taskId: "task:business-runtime",
					workerRef: "worker:integration-controller",
				}),
			},
		);
		const record = (await executionResponse.json()) as {
			executionRef: string;
			status: string;
			callerRef: string;
			error?: string;
		};
		if (executionResponse.status !== 200) {
			const diagnostic = await fetch(
				`${hostBaseUrl}/actions/executeCapability`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						authenticatedRoleRef: "g-integration-controller",
						input: {
							contract: "execution",
							contractVersion: "1.0.0",
							idempotencyKey: "business-runtime-project-info-diagnostic",
							capability: "project.info",
							input: {},
						},
					}),
				},
			).then((response) => response.text());
			const executionDiagnostic = await fetch(
				`${executionBaseUrl}/executions`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						contract: "execution",
						contractVersion: "1.0.0",
						callerRef: "g-integration-controller",
						roleRef: "g-integration-controller",
						idempotencyKey:
							"business-runtime-project-info-execution-diagnostic",
						capability: "project.info",
						input: {},
					}),
				},
			).then((response) => response.text());
			assert.fail(
				`${JSON.stringify(record)} owner=${diagnostic} execution=${executionDiagnostic}`,
			);
		}
		assert.equal(record.status, "SUCCEEDED", JSON.stringify(record));
		assert.equal(record.callerRef, "g-integration-controller");
		assert.ok(providerCalls > callsBeforeExecution);
		const completed = (await fetch(`${gatewayBaseUrl}/actions/completeNode`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${controllerCredential}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				taskId: "task:business-runtime",
				nodeId: "node:business-runtime",
				expectedTaskVersion: 4,
				expectedNodeVersion: 3,
				resultSummary: "Real owner-routed Execution completed",
				idempotencyKey: "business-runtime-complete-node",
			}),
		}).then((response) => response.json())) as {
			ok: boolean;
			data: { taskStatus: string };
		};
		assert.equal(completed.ok, true, JSON.stringify(completed));
		assert.equal(completed.data.taskStatus, "SUCCEEDED");

		const restartedExecution = await execution.restart();
		const restored = (await fetch(
			`http://${restartedExecution.host}:${restartedExecution.port}/executions/${encodeURIComponent(record.executionRef)}`,
		).then((response) => response.json())) as {
			executionRef: string;
			status: string;
		};
		assert.equal(restored.executionRef, record.executionRef);
		assert.equal(restored.status, "SUCCEEDED");
	} finally {
		await gateway.stop();
		await host.stop();
		await execution.stop();
		await model.stop();
		await new Promise<void>((resolve) => provider.close(() => resolve()));
	}
});
