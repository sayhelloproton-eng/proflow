import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import type { ExecuteCapabilityRequest } from "@tomflow/proflow-execution-contracts";
import { createExecutionModelDecisionClient } from "../src/model-decision-client.ts";

type InferenceRequestBody = {
	specRef: string;
	mode: string;
	priority: string;
	trace: Record<string, string>;
	payload: Record<string, unknown>;
};

async function server(
	handler: (body: InferenceRequestBody, count: number) => unknown,
) {
	let count = 0;
	const seen: InferenceRequestBody[] = [];
	const authorizations: Array<string | undefined> = [];
	const instance = createServer(async (request, response) => {
		authorizations.push(request.headers.authorization);
		if (request.url === "/status") {
			response.setHeader("content-type", "application/json");
			response.end(
				JSON.stringify({
					runtime: "READY",
					lane: "IDLE",
					fast: "READY",
					reason: "READY",
					businessQueueDepth: 0,
					backgroundQueueDepth: 0,
				}),
			);
			return;
		}
		if (request.url === "/infer") {
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(Buffer.from(chunk));
			const body = JSON.parse(
				Buffer.concat(chunks).toString("utf8"),
			) as InferenceRequestBody;
			seen.push(body);
			count += 1;
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify(handler(body, count)));
			return;
		}
		response.statusCode = 404;
		response.end();
	});
	await new Promise<void>((resolve) =>
		instance.listen(0, "127.0.0.1", resolve),
	);
	const address = instance.address();
	if (!address || typeof address === "string")
		throw new Error("address missing");
	return {
		endpoint: `http://127.0.0.1:${address.port}`,
		seen,
		authorizations,
		close: () =>
			new Promise<void>((resolve, reject) =>
				instance.close((error) => (error ? reject(error) : resolve())),
			),
	};
}

const request = (operation: Record<string, unknown> = {}) =>
	({
		contract: "execution",
		contractVersion: "1.0.0",
		callerRef: "g-role",
		idempotencyKey: "risk-1",
		capability: "file.write",
		input: {
			path: "README.md",
			content: "SECRET-CONTENT",
			token: "SECRET-TOKEN",
			...operation,
		},
	}) as unknown as ExecuteCapabilityRequest;

function success(data: unknown, actualMode: "fast" | "reason" = "reason") {
	return {
		contractVersion: "1.0.0",
		inferenceRef: "inference:1",
		specRef: "execution.command-risk.v1",
		status: "SUCCEEDED",
		requestedMode: "auto",
		actualMode,
		data,
		metrics: { queueLatencyMs: 0, inferenceLatencyMs: 1, totalLatencyMs: 1 },
	};
}

test("PRESMOKE-B5-EXE-MODEL-01 production client uses auto/business, bounded facts, durable execution trace, and maps REASON ESCALATE to Human", async () => {
	const fake = await server(() =>
		success({
			decision: "ESCALATE",
			reasonCode: "HUMAN",
			confidence: 0.6,
			rationale: "human required",
		}),
	);
	try {
		const transportCredential = "model-runtime-transport-credential-value";
		const client = createExecutionModelDecisionClient({
			endpoint: fake.endpoint,
			credential: transportCredential,
		});
		const decision = await client.port.decide(request(), {
			executionRef: "execution:server-generated",
			inputFingerprint: "sha256:abc",
		});
		assert.equal(decision.approvalRequired, true);
		assert.equal(decision.decisionPath, "reason");
		const body = fake.seen[0];
		assert.ok(body);
		assert.equal(body.specRef, "execution.command-risk.v1");
		assert.equal(body.mode, "auto");
		assert.equal(body.priority, "business");
		assert.equal(body.trace.executionRef, "execution:server-generated");
		assert.equal(body.payload.inputFingerprint, "sha256:abc");
		assert.deepEqual(fake.authorizations, [
			`Bearer ${transportCredential}`,
			`Bearer ${transportCredential}`,
		]);
		assert.doesNotMatch(JSON.stringify(body), /SECRET-CONTENT|SECRET-TOKEN/);
	} finally {
		await fake.close();
	}
});

test("PRESMOKE-B5-EXE-MODEL-02 FAST READY without REASON READY is consumer-unavailable", async () => {
	const instance = createServer((request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.url === "/status")
			response.end(
				JSON.stringify({
					runtime: "DEGRADED",
					lane: "IDLE",
					fast: "READY",
					reason: "UNAVAILABLE",
					businessQueueDepth: 0,
					backgroundQueueDepth: 0,
				}),
			);
		else {
			response.statusCode = 500;
			response.end("{}");
		}
	});
	await new Promise<void>((resolve) =>
		instance.listen(0, "127.0.0.1", resolve),
	);
	const address = instance.address();
	if (!address || typeof address === "string")
		throw new Error("address missing");
	try {
		const client = createExecutionModelDecisionClient({
			endpoint: `http://127.0.0.1:${address.port}`,
		});
		assert.equal(await client.probe(), false);
		await assert.rejects(
			client.port.decide(request(), {
				executionRef: "execution:1",
				inputFingerprint: "sha256:x",
			}),
			/unavailable/i,
		);
	} finally {
		await new Promise<void>((resolve) => instance.close(() => resolve()));
	}
});

test("PRESMOKE-B5-EXE-MODEL-03 CONTEXT_TOO_LARGE gets one explicit compact caller retry without leaking long argv/url secrets", async () => {
	const fake = await server((_body, count) =>
		count === 1
			? {
					contractVersion: "1.0.0",
					inferenceRef: "inference:1",
					specRef: "execution.command-risk.v1",
					status: "FAILED",
					requestedMode: "auto",
					error: {
						code: "CONTEXT_TOO_LARGE",
						message: "too large",
						retryable: false,
					},
					metrics: { queueLatencyMs: 0, totalLatencyMs: 1 },
				}
			: success(
					{
						decision: "ALLOW",
						reasonCode: "OK",
						confidence: 0.8,
						rationale: "bounded",
					},
					"fast",
				),
	);
	try {
		const client = createExecutionModelDecisionClient({
			endpoint: fake.endpoint,
		});
		const argv = [
			"--token",
			"SECRET-ARGV",
			"--api-key=SECRET-INLINE",
			"AUTHORIZATION:SECRET-HEADER",
			"https://user:password@example.test/path?token=SECRET-ARGV-URL#frag",
			...Array.from(
				{ length: 200 },
				(_, index) => `arg-${index}-${"x".repeat(300)}`,
			),
		];
		await client.port.decide(
			request({
				argv,
				args: ["TOKEN=SECRET-ENVLIKE", "plain-argument"],
				url: "https://user:password@example.test/path?token=SECRET#frag",
			}),
			{ executionRef: "execution:1", inputFingerprint: "sha256:x" },
		);
		assert.equal(fake.seen.length, 2);
		const firstBody = fake.seen[0];
		const secondBody = fake.seen[1];
		assert.ok(firstBody);
		assert.ok(secondBody);
		const first = JSON.stringify(firstBody.payload);
		const second = JSON.stringify(secondBody.payload);
		assert.ok(Buffer.byteLength(first) < 10_000);
		assert.ok(Buffer.byteLength(second) < Buffer.byteLength(first));
		assert.doesNotMatch(first + second, /password|SECRET/);
		assert.match(first, /--token/);
		assert.match(first, /plain-argument/);
		assert.match(first, /\[REDACTED\]/);
	} finally {
		await fake.close();
	}
});

test("PRESMOKE-B5-EXE-MODEL-04 protocol mismatch fails closed and degrades client readiness", async () => {
	const fake = await server(() => ({
		...success({
			decision: "ALLOW",
			reasonCode: "OK",
			confidence: 0.9,
			rationale: "x",
		}),
		specRef: "wrong.v1",
	}));
	try {
		const client = createExecutionModelDecisionClient({
			endpoint: fake.endpoint,
		});
		await assert.rejects(
			client.port.decide(request(), {
				executionRef: "execution:1",
				inputFingerprint: "sha256:x",
			}),
			/DECISION_UNRESOLVED/,
		);
		assert.equal(client.readiness(), false);
	} finally {
		await fake.close();
	}
});
