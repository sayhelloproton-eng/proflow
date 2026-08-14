import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createModelRuntimeProcess } from "../src/process.ts";
import { systemHealthAssessmentSpec } from "../src/specs/system-health-assessment.ts";

test("formal model-runtime process verifies provider, serves readiness, restarts and stops", async () => {
	let calls = 0;
	const provider = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request)
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
			model: string;
		};
		calls += 1;
		response.setHeader("content-type", "application/json");
		const value = JSON.stringify({
			decision: "HEALTHY",
			confidence: 1,
			reasonCode: "ALL_CHECKS_PASS",
			rationale: "all checks pass",
		});
		response.end(
			JSON.stringify({
				id: `provider:${calls}`,
				choices: [
					{
						message: {
							content:
								body.model === "reason-model"
									? `<think>bounded</think>${value}`
									: value,
						},
					},
				],
			}),
		);
	});
	await new Promise<void>((resolveListen) =>
		provider.listen(0, "127.0.0.1", resolveListen),
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
	const logs: Record<string, unknown>[] = [];
	const stateRoot = await mkdtemp(join(tmpdir(), "proflow-model-process-"));
	const service = await createModelRuntimeProcess({
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
		log: (entry) => logs.push(entry),
	});
	try {
		const first = await service.start();
		assert.equal(service.inspect().readiness, "READY");
		assert.equal(
			(await fetch(`http://${first.host}:${first.port}/ready`)).status,
			200,
		);
		const second = await service.restart();
		assert.equal(
			(await fetch(`http://${second.host}:${second.port}/health`)).status,
			200,
		);
		await service.stop();
		assert.equal(service.inspect().process, "STOPPED");
		assert.ok(calls >= 2);
		assert.deepEqual(
			logs.map((entry) => entry.event),
			[
				"SERVICE_STARTED",
				"SERVICE_STOPPED",
				"SERVICE_STARTED",
				"SERVICE_STOPPED",
			],
		);
	} finally {
		await service.stop();
		provider.close();
		await rm(stateRoot, { recursive: true, force: true });
	}
});

test("B2-MOD-02 formal process writes sanitized disk inference JSONL for result and pre-queue rejection", async () => {
	const stateRoot = await mkdtemp(join(tmpdir(), "proflow-model-logger-"));
	const provider = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request)
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
			model: string;
		};
		response.setHeader("content-type", "application/json");
		const value = JSON.stringify({
			decision: "HEALTHY",
			confidence: 1,
			reasonCode: "ALL_CHECKS_PASS",
			rationale: "all checks pass",
		});
		response.end(
			JSON.stringify({
				id: "provider:process-log",
				choices: [
					{
						message: {
							content:
								body.model === "reason-model"
									? `<think>bounded</think>${value}`
									: value,
						},
					},
				],
			}),
		);
	});
	await new Promise<void>((resolveListen) =>
		provider.listen(0, "127.0.0.1", resolveListen),
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
	const service = await createModelRuntimeProcess({
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
	try {
		const { host, port } = await service.start();
		const base = `http://${host}:${port}`;
		const valid = await fetch(`${base}/infer`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				contractVersion: "1.0.0",
				specRef: systemHealthAssessmentSpec.specRef,
				mode: "fast",
				priority: "business",
				trace: {
					callerRef: "caller:process-log-test",
					correlationId: "correlation:process-log-test",
				},
				payload: {
					service: "model-runtime",
					checks: [{ name: "probe", state: "PASS" }],
				},
			}),
		});
		assert.equal(valid.status, 200);
		const result = (await valid.json()) as { inferenceRef: string };
		assert.ok(result.inferenceRef);

		const secret = "PROCESS_SECRET_MUST_NOT_LEAK";
		const rejected = await fetch(`${base}/infer`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				contractVersion: "1.0.0",
				specRef: systemHealthAssessmentSpec.specRef,
				mode: "fast",
				priority: "business",
				trace: { callerRef: "caller:process-log-reject" },
				payload: { wrong: secret },
			}),
		});
		assert.equal(rejected.status, 200);
		assert.equal(
			((await rejected.json()) as { error?: { code?: string } }).error?.code,
			"INVALID_REQUEST",
		);

		await service.stop();
		const log = await readFile(
			join(stateRoot, "logs/model/inference.jsonl"),
			"utf8",
		);
		assert.match(log, /INFERENCE_RESULT/);
		assert.match(log, /PRE_QUEUE_REJECTION/);
		assert.match(log, /caller:process-log-test/);
		assert.match(log, /correlation:process-log-test/);
		assert.match(log, /caller:process-log-reject/);
		assert.doesNotMatch(log, new RegExp(secret));
		assert.doesNotMatch(log, /Return exactly one JSON object/);
		const entries = log
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		const resultEntry = entries.find(
			(entry) => entry.event === "INFERENCE_RESULT",
		);
		const rejectionEntry = entries.find(
			(entry) => entry.event === "PRE_QUEUE_REJECTION",
		);
		assert.equal(resultEntry?.inferenceRef, result.inferenceRef);
		assert.equal(resultEntry?.status, "SUCCEEDED");
		assert.equal(rejectionEntry?.status, "FAILED");
		assert.equal(rejectionEntry?.errorCode, "INVALID_REQUEST");
	} finally {
		await service.stop();
		provider.close();
		await rm(stateRoot, { recursive: true, force: true });
	}
});
