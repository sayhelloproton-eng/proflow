import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { createModelRuntimeProcess } from "../src/process.ts";

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
	const service = await createModelRuntimeProcess({
		config: {
			host: "127.0.0.1",
			port: 0,
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
	}
});
