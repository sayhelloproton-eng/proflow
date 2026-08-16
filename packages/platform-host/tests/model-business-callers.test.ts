import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPlatformHost, parsePlatformHostConfig } from "../src/index.ts";

async function modelDependency() {
	const requests: Array<Record<string, unknown>> = [];
	const inferAuthorizations: Array<string | undefined> = [];
	const server = createServer(async (request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.url === "/ready") {
			response.end(JSON.stringify({ status: "READY" }));
			return;
		}
		if (request.url === "/infer") {
			inferAuthorizations.push(request.headers.authorization);
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(Buffer.from(chunk));
			const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
				string,
				unknown
			>;
			requests.push(body);
			const specRef = body.specRef;
			const data =
				specRef === "task.diagnostic.v1"
					? {
							finding: "bounded finding",
							probableCause: "bounded cause",
							confidence: 0.7,
							recommendedNextObservation: "observe",
							recommendedRecoveryAction: "reconcile",
							needsHumanAttention: false,
						}
					: {
							scope: "global",
							health: "HEALTHY",
							findings: [],
							risks: [],
							anomalies: [],
							hypotheses: [],
							unresolved: [],
							needsDrilldown: [],
							evidenceRefs: [],
							carryForward: [],
							confidence: 0.9,
							rationale: "bounded assessment",
						};
			response.end(
				JSON.stringify({
					contractVersion: "1.0.0",
					inferenceRef: `inference:${requests.length}`,
					specRef,
					status: "SUCCEEDED",
					requestedMode: "reason",
					actualMode: "reason",
					data,
					metrics: {
						queueLatencyMs: 0,
						inferenceLatencyMs: 1,
						totalLatencyMs: 1,
					},
				}),
			);
			return;
		}
		response.end(JSON.stringify({ status: "READY" }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("missing port");
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		requests,
		inferAuthorizations,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

test("PRESMOKE-B5-HOST-MODEL-01 Task Diagnostic and System Assessment use the single Model infer contract with caller-owned mode/priority/trace", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-host-model-callers-"));
	const dependency = await modelDependency();
	const stateRoot = join(root, ".proflow");
	const modelTransportCredentialFile = join(root, "model-runtime.token");
	const modelTransportCredential = "model-runtime-transport-credential-value";
	await writeFile(
		modelTransportCredentialFile,
		`${modelTransportCredential}\n`,
		{ mode: 0o600 },
	);
	const host = createPlatformHost({
		config: parsePlatformHostConfig({
			stateRoot,
			workspaceRoot: join(root, "workspace"),
			host: "127.0.0.1",
			port: 0,
			executionBaseUrl: dependency.baseUrl,
			modelBaseUrl: dependency.baseUrl,
			modelTransportCredentialFile,
			roles: [],
		}),
	});
	try {
		const started = await host.start();
		const token = (
			await readFile(
				join(stateRoot, "browser", "secrets", "task-application.token"),
				"utf8",
			)
		).trim();
		const call = (operation: string, input: Record<string, unknown>) =>
			fetch(`http://${started.host}:${started.port}/application/observer`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ operation, input }),
			});
		const diagnostic = await call("task.diagnostic", {
			taskId: "task:1",
			nodeId: "node:1",
			correlationId: "execution:1",
			payload: {
				taskId: "task:1",
				nodeId: "node:1",
				runNo: 1,
				anomaly: {
					kind: "UNKNOWN_REALITY",
					ref: "execution:1",
					facts: { status: "UNKNOWN" },
				},
			},
		});
		assert.equal(diagnostic.status, 200);
		const assessment = await call("system.reason", {
			assessmentRef: "assessment:1",
			payload: {
				assessmentRef: "assessment:1",
				kind: "CONCERN_BATCH",
				scope: "task-worker",
				observedAt: "2026-08-16T00:00:00.000Z",
				views: { task: { summary: "bounded task", health: "HEALTHY" } },
				previousUnresolved: [],
				previousCarryForward: [],
			},
		});
		assert.equal(assessment.status, 200);
		assert.equal(dependency.requests.length, 2);
		assert.deepEqual(dependency.inferAuthorizations, [
			`Bearer ${modelTransportCredential}`,
			`Bearer ${modelTransportCredential}`,
		]);
		const task = dependency.requests[0] as {
			specRef: string;
			mode: string;
			priority: string;
			trace: { callerRef: string };
		};
		assert.equal(task.specRef, "task.diagnostic.v1");
		assert.equal(task.mode, "reason");
		assert.equal(task.priority, "business");
		assert.equal(task.trace.callerRef, "extension:task-observer");
		const system = dependency.requests[1] as {
			specRef: string;
			mode: string;
			priority: string;
			trace: { callerRef: string; assessmentRef: string };
			payload: Record<string, unknown>;
		};
		assert.equal(system.specRef, "system.health-assessment.v1");
		assert.equal(system.mode, "reason");
		assert.equal(system.priority, "background");
		assert.equal(system.trace.callerRef, "extension:system-observer");
		assert.equal(system.trace.assessmentRef, "assessment:1");
		assert.equal(system.payload.assessmentKind, "CONCERN_BATCH");
		assert.equal("kind" in system.payload, false);
		assert.equal("assessmentRef" in system.payload, false);
	} finally {
		await host.stop();
		await dependency.close();
	}
});


test("RF-MODEL-RT-14 platform-host rejects group/world-readable Model transport credential", async (t) => {
	if (process.platform === "win32") return t.skip("POSIX mode proof");
	const root = await mkdtemp(join(tmpdir(), "proflow-host-model-permissions-"));
	const dependency = await modelDependency();
	const credentialFile = join(root, "model-runtime.token");
	await writeFile(credentialFile, "model-runtime-transport-credential-value\n", { mode: 0o600 });
	await chmod(credentialFile, 0o644);
	const host = createPlatformHost({
		config: parsePlatformHostConfig({
			stateRoot: join(root, ".proflow"),
			workspaceRoot: join(root, "workspace"),
			host: "127.0.0.1",
			port: 0,
			executionBaseUrl: dependency.baseUrl,
			modelBaseUrl: dependency.baseUrl,
			modelTransportCredentialFile: credentialFile,
			roles: [],
		}),
	});
	try {
		await assert.rejects(() => host.start(), /MODEL_TRANSPORT_CREDENTIAL_PERMISSIONS_INVALID/);
	} finally {
		await host.stop();
		await dependency.close();
	}
});
