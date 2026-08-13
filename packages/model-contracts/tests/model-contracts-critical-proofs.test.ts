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
	for (const [surface, incompatible] of [
		[
			"request",
			{
				...api.MODEL_CONTRACT_DESCRIPTOR,
				request: api.MODEL_CONTRACT_DESCRIPTOR.request.filter(
					(field: string) => field !== "images?",
				),
			},
		],
		[
			"result",
			{
				...api.MODEL_CONTRACT_DESCRIPTOR,
				result: api.MODEL_CONTRACT_DESCRIPTOR.result.filter(
					(field: string) => field !== "metrics.inferenceLatencyMs?",
				),
			},
		],
		[
			"runtimeStatus",
			{
				...api.MODEL_CONTRACT_DESCRIPTOR,
				runtimeStatus: api.MODEL_CONTRACT_DESCRIPTOR.runtimeStatus.filter(
					(field: string) => field !== "lastErrorCode?",
				),
			},
		],
		[
			"error",
			{
				...api.MODEL_CONTRACT_DESCRIPTOR,
				error: api.MODEL_CONTRACT_DESCRIPTOR.error.filter(
					(field: string) => field !== "retryable",
				),
			},
		],
		[
			"publicTypes",
			{
				...api.MODEL_CONTRACT_DESCRIPTOR,
				publicTypes: api.MODEL_CONTRACT_DESCRIPTOR.publicTypes.filter(
					(type: string) => type !== "ReasoningSpec",
				),
			},
		],
	] as const) {
		const result = api.checkModelContractCompatibility(
			api.MODEL_CONTRACT_DESCRIPTOR,
			incompatible,
		);
		assert.equal(result.status, "FAIL", surface);
		assert.equal(
			result.missing.some((entry: string) => entry.startsWith(`${surface}:`)),
			true,
			surface,
		);
	}
	const enumBreak = {
		...api.MODEL_CONTRACT_DESCRIPTOR,
		enums: {
			...api.MODEL_CONTRACT_DESCRIPTOR.enums,
			inferenceMode: ["fast", "auto"],
		},
	};
	assert.deepEqual(
		api.checkModelContractCompatibility(
			api.MODEL_CONTRACT_DESCRIPTOR,
			enumBreak,
		),
		{
			status: "FAIL",
			missing: ["enums.inferenceMode:reason"],
		},
	);
});

test("MOD-DECISION-01 .v1 is the canonical major identity while full SemVer remains explicit", async () => {
	const api = await contracts();
	const input = {
		id: "identity.proof",
		purpose: "prove canonical ReasoningSpec identity",
		allowedModes: ["fast"] as const,
		requiredModalities: ["text"] as const,
		inputSchema: z.object({ value: z.string() }).strict(),
		outputSchema: z.object({ decision: z.literal("ALLOW") }).strict(),
		instruction: "Return ALLOW.",
		maxOutputTokens: 16,
	};
	const first = api.createReasoningSpec({ ...input, version: "1.0.0" });
	const compatibleRevision = api.createReasoningSpec({
		...input,
		version: "1.1.0",
	});
	assert.equal(first.specRef, "identity.proof.v1");
	assert.equal(compatibleRevision.specRef, "identity.proof.v1");
	assert.equal(first.version, "1.0.0");
	assert.equal(compatibleRevision.version, "1.1.0");
});
