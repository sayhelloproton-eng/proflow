import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod";

async function contracts() {
	return import("../src/index.ts");
}

test("CP-MODEL-CON-01 infer/getRuntimeStatus boundaries validate unknown into typed contracts", async () => {
	const api = await contracts();
	const request = api.inferenceRequestSchema.parse({
		contractVersion: "1.0.0",
		specRef: "system.health-assessment.v1",
		mode: "fast",
		priority: "business",
		trace: { callerRef: "execution:test" },
		payload: { state: "healthy" },
	});
	assert.equal(request.mode, "fast");
	assert.equal(
		api.modelRuntimeStatusSchema.parse({
			runtime: "READY",
			lane: "IDLE",
			fast: "READY",
			reason: "READY",
			businessQueueDepth: 0,
			backgroundQueueDepth: 0,
		}).runtime,
		"READY",
	);
	assert.throws(() => api.inferenceRequestSchema.parse({ mode: "fast" }));
});

test("CP-MODEL-CON-02 illegal ReasoningSpec/mode/profile/proposal/error/status combinations reject", async () => {
	const api = await contracts();
	assert.throws(() =>
		api.createReasoningSpec({
			id: "bad",
			version: "1.0.0",
			purpose: "bad",
			allowedModes: ["fast"],
			requiredModalities: ["image"],
			inputSchema: z.object({ value: z.string() }).strict(),
			outputSchema: z.object({ decision: z.literal("ALLOW") }).strict(),
			instruction: "",
			maxOutputTokens: 0,
			repair: "twice" as never,
		}),
	);
	assert.throws(() =>
		api.modelCapabilityProfileSchema.parse({
			modelRef: "model",
			reasoningModes: [],
			inputModalities: ["text"],
			structuredOutput: "native",
			contextWindow: 0,
			maxOutputTokens: 1,
		}),
	);
	assert.throws(() =>
		api.inferenceResultSchema.parse({
			contractVersion: "1.0.0",
			inferenceRef: "ref",
			specRef: "spec",
			status: "SUCCEEDED",
			requestedMode: "fast",
			error: { code: "PROVIDER_ERROR", message: "bad", retryable: true },
			metrics: { queueLatencyMs: 0, totalLatencyMs: 1 },
		}),
	);
});

test("CP-MODEL-CON-03 Capability Proposal is max-one and constrained to caller candidates", async () => {
	const api = await contracts();
	const schema = api.capabilityProposalOutputSchema({
		"git.status": z.object({ cwdRef: z.string() }).strict(),
	});
	assert.equal(
		schema.parse({
			proposal: {
				action: "PROPOSE_CAPABILITY",
				capability: "git.status",
				arguments: { cwdRef: "project:current" },
				confidence: 0.9,
				reasonCode: "INSPECT_REQUIRED",
			},
		}).proposal?.capability,
		"git.status",
	);
	assert.throws(() =>
		schema.parse({
			proposal: {
				action: "PROPOSE_CAPABILITY",
				capability: "shell.exec",
				arguments: {},
				confidence: 1,
				reasonCode: "UNKNOWN",
			},
		}),
	);
	assert.throws(() => schema.parse({ proposals: [{}, {}] }));
});

test("CP-MODEL-CON-04 provider/consumer compatibility detects breaking contract changes", async () => {
	const api = await contracts();
	assert.equal(
		api.checkModelContractCompatibility(
			api.MODEL_CONTRACT_DESCRIPTOR,
			api.MODEL_CONTRACT_DESCRIPTOR,
		).status,
		"PASS",
	);
	const incompatible = {
		...api.MODEL_CONTRACT_DESCRIPTOR,
		errorCodes: api.MODEL_CONTRACT_DESCRIPTOR.errorCodes.filter(
			(code: string) => code !== "QUEUE_TIMEOUT",
		),
	};
	assert.equal(
		api.checkModelContractCompatibility(
			api.MODEL_CONTRACT_DESCRIPTOR,
			incompatible,
		).status,
		"FAIL",
	);
});
