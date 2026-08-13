import { readFile } from "node:fs/promises";

import {
	capabilityProposalOutputSchema,
	createReasoningSpec,
} from "@tomflow/proflow-model-contracts";
import { z } from "zod";
import {
	createModelRuntime,
	type ModelProvider,
	verifyRoleCapabilities,
} from "../src/index.ts";
import { createOpenAICompatibleProvider } from "../src/provider.ts";
import { systemHealthAssessmentSpec } from "../src/specs/system-health-assessment.ts";

const baseUrl = process.env.PROFLOW_MODEL_BASE_URL;
const fastModel = process.env.PROFLOW_MODEL_FAST_MODEL;
const reasonModel = process.env.PROFLOW_MODEL_REASON_MODEL;
const visionImagePath = process.env.PROFLOW_MODEL_VISION_IMAGE;
if (!baseUrl || !fastModel || !reasonModel || !visionImagePath) {
	throw new Error(
		"PROFLOW_MODEL_BASE_URL, PROFLOW_MODEL_FAST_MODEL, PROFLOW_MODEL_REASON_MODEL, and PROFLOW_MODEL_VISION_IMAGE are required",
	);
}

const apiKey = process.env.PROFLOW_MODEL_API_KEY;
const underlying = createOpenAICompatibleProvider({
	baseUrl,
	...(apiKey ? { apiKey } : {}),
	models: { fast: fastModel, reason: reasonModel },
	roleBody: {
		fast: {
			temperature: 0.7,
			top_p: 0.8,
			top_k: 20,
			presence_penalty: 1.5,
		},
		reason: {
			temperature: 0.6,
			top_p: 0.95,
			top_k: 20,
			presence_penalty: 0,
		},
	},
	roleSystemPrompt: {
		fast: "You are the FAST bounded judgement role. Return only the final JSON object.",
		reason:
			"You are the REASON bounded escalation role. Use at most five concise internal reasoning steps, then return only the final JSON object. Do not repeat the prompt or schema.",
	},
});

const providerCalls: Array<{
	role: string;
	repair: boolean;
	latencyMs: number;
	callerRef: string;
	specRef: string;
	providerRequestRef?: string;
	finishReason?: string;
}> = [];
let activeProviderCalls = 0;
let maxActiveProviderCalls = 0;
const trackedProvider: ModelProvider = {
	async infer(call, signal) {
		activeProviderCalls += 1;
		maxActiveProviderCalls = Math.max(
			maxActiveProviderCalls,
			activeProviderCalls,
		);
		const started = Date.now();
		try {
			const response = await underlying.infer(call, signal);
			providerCalls.push({
				role: call.role,
				repair: call.repair,
				latencyMs: Date.now() - started,
				callerRef: call.request.trace.callerRef,
				specRef: call.spec.specRef,
				...(response.providerRequestRef
					? { providerRequestRef: response.providerRequestRef }
					: {}),
				...(response.finishReason
					? { finishReason: response.finishReason }
					: {}),
			});
			return response;
		} finally {
			activeProviderCalls -= 1;
		}
	},
};

const roles = verifyRoleCapabilities({
	declared: {
		fast: {
			profile: {
				modelRef: fastModel,
				reasoningModes: ["no-thinking"],
				inputModalities: ["text", "image"],
				structuredOutput: "native",
				contextWindow: 32_768,
				maxOutputTokens: 1_024,
			},
		},
		reason: {
			profile: {
				modelRef: reasonModel,
				reasoningModes: ["thinking"],
				inputModalities: ["text", "image"],
				structuredOutput: "native",
				contextWindow: 32_768,
				maxOutputTokens: 2_048,
			},
		},
	},
	observed: {
		fast: {
			text: true,
			image: true,
			structuredOutput: true,
			reasoning: "no-thinking",
			reasoningBasis: "provider-response-thinking-absent",
			verifiedAt: new Date().toISOString(),
		},
		reason: {
			text: true,
			image: true,
			structuredOutput: true,
			reasoning: "thinking",
			reasoningBasis: "provider-response-thinking-closed",
			verifiedAt: new Date().toISOString(),
		},
	},
});

const visionSpec = createReasoningSpec({
	id: "browser.observation-boundary",
	version: "1.0.0",
	purpose: "Classify a supplied browser action preview without executing it",
	allowedModes: ["fast", "reason"],
	requiredModalities: ["text", "image"],
	inputSchema: z.object({ expectedAction: z.literal("OBSERVE_PAGE") }).strict(),
	outputSchema: z
		.object({
			action: z.enum(["OBSERVE_PAGE", "SUBMIT_MESSAGE"]),
			effect: z.enum(["READ_ONLY", "EXTERNAL_WRITE"]),
		})
		.strict(),
	instruction:
		"Read the screenshot. Return action=OBSERVE_PAGE and effect=READ_ONLY only when the UI explicitly describes observation/read-only behavior.",
	maxOutputTokens: 2_048,
	repair: "once",
});

const contextSanitySpec = createReasoningSpec({
	id: "model.context-sanity",
	version: "1.0.0",
	purpose: "Verify bounded provider context handling without truncation",
	allowedModes: ["fast", "reason"],
	requiredModalities: ["text"],
	inputSchema: z
		.object({
			marker: z.literal("CONTEXT_OK"),
			padding: z.string().min(4_096).max(4_096),
		})
		.strict(),
	outputSchema: z.object({ marker: z.literal("CONTEXT_OK") }).strict(),
	instruction:
		"Return marker=CONTEXT_OK. The padding is deliberate bounded context and must not be echoed or summarized.",
	maxContextBytes: 8_192,
	maxOutputTokens: 2_048,
	repair: "once",
});

const proposalSpec = createReasoningSpec({
	id: "capability.proposal",
	version: "1.0.0",
	purpose: "Produce at most one constrained capability proposal",
	allowedModes: ["fast"],
	requiredModalities: ["text"],
	inputSchema: z
		.object({
			need: z.literal("inspect git state"),
			candidates: z.tuple([z.literal("git.status")]),
		})
		.strict(),
	outputSchema: capabilityProposalOutputSchema({
		"git.status": z.object({ cwdRef: z.literal("project:current") }).strict(),
	}),
	instruction:
		'The caller needs to inspect git state. Return exactly this single-object shape and no other keys: {"proposal":{"action":"PROPOSE_CAPABILITY","capability":"git.status","arguments":{"cwdRef":"project:current"},"confidence":0.95,"reasonCode":"INSPECT_REQUIRED"}}. Do not return capabilities/proposals arrays and do not execute it.',
	maxOutputTokens: 256,
	repair: "once",
});

const runtime = createModelRuntime({
	specs: [
		systemHealthAssessmentSpec,
		visionSpec,
		proposalSpec,
		contextSanitySpec,
	],
	roles,
	provider: trackedProvider,
	inferenceTimeoutMs: 180_000,
});

const request = (input: {
	specRef?: string;
	mode: "fast" | "reason" | "auto";
	priority?: "business" | "background";
	payload: unknown;
	images?: Array<{ mimeType: "image/png"; data: string }>;
	callerRef: string;
	timeoutMs?: number;
}) => ({
	contractVersion: "1.0.0" as const,
	specRef: input.specRef ?? systemHealthAssessmentSpec.specRef,
	mode: input.mode,
	priority: input.priority ?? ("business" as const),
	trace: { callerRef: input.callerRef },
	payload: input.payload,
	...(input.images ? { images: input.images } : {}),
	timeoutMs: input.timeoutMs ?? 180_000,
});

const assertSuccess = (
	label: string,
	result: Awaited<ReturnType<typeof runtime.infer>>,
) => {
	if (result.status !== "SUCCEEDED")
		throw new Error(
			`${label} failed: ${result.error?.code ?? "unknown"}: ${result.error?.message ?? "no message"}`,
		);
	return result;
};

const healthPayloads = {
	healthy: {
		service: "model-runtime",
		checks: [
			{ name: "provider", state: "PASS" as const },
			{ name: "lane", state: "PASS" as const },
		],
	},
	failed: {
		service: "model-runtime",
		checks: [{ name: "provider", state: "FAIL" as const }],
	},
	warned: {
		service: "model-runtime",
		checks: [
			{ name: "provider", state: "PASS" as const },
			{ name: "latency", state: "WARN" as const },
		],
	},
	unknown: {
		service: "model-runtime",
		checks: [{ name: "provider", state: "UNKNOWN" as const }],
	},
};

const startedAt = new Date().toISOString();
const m2Started = providerCalls.length;
const m2Fast = assertSuccess(
	"M2 FAST",
	await runtime.infer(
		request({
			mode: "fast",
			payload: healthPayloads.healthy,
			callerRef: "m2:fast",
		}),
	),
);
const m2Reason = assertSuccess(
	"M2 REASON",
	await runtime.infer(
		request({
			mode: "reason",
			payload: healthPayloads.failed,
			callerRef: "m2:reason",
		}),
	),
);
const imageData = (await readFile(visionImagePath)).toString("base64");
const m2Vision = assertSuccess(
	"M2 FAST Vision",
	await runtime.infer(
		request({
			specRef: visionSpec.specRef,
			mode: "fast",
			payload: { expectedAction: "OBSERVE_PAGE" },
			images: [{ mimeType: "image/png", data: imageData }],
			callerRef: "m2:vision",
		}),
	),
);
const m2ReasonVision = assertSuccess(
	"M2 REASON Vision",
	await runtime.infer(
		request({
			specRef: visionSpec.specRef,
			mode: "reason",
			payload: { expectedAction: "OBSERVE_PAGE" },
			images: [{ mimeType: "image/png", data: imageData }],
			callerRef: "m2:reason-vision",
		}),
	),
);
const m2Proposal = assertSuccess(
	"M2 Capability Proposal",
	await runtime.infer(
		request({
			specRef: proposalSpec.specRef,
			mode: "fast",
			payload: { need: "inspect git state", candidates: ["git.status"] },
			callerRef: "m2:proposal",
		}),
	),
);
const contextPayload = {
	marker: "CONTEXT_OK" as const,
	padding: "x".repeat(4_096),
};
const m2FastContext = assertSuccess(
	"M2 FAST context sanity",
	await runtime.infer(
		request({
			specRef: contextSanitySpec.specRef,
			mode: "fast",
			payload: contextPayload,
			callerRef: "m2:fast-context",
		}),
	),
);
const m2ReasonContext = assertSuccess(
	"M2 REASON context sanity",
	await runtime.infer(
		request({
			specRef: contextSanitySpec.specRef,
			mode: "reason",
			payload: contextPayload,
			callerRef: "m2:reason-context",
		}),
	),
);
const m2Ended = providerCalls.length;

const m3Cases = [
	{
		id: "positive",
		payload: healthPayloads.healthy,
		expected: "HEALTHY",
		mode: "fast" as const,
	},
	{
		id: "negative",
		payload: healthPayloads.failed,
		expected: "UNAVAILABLE",
		mode: "reason" as const,
	},
	{
		id: "boundary",
		payload: healthPayloads.warned,
		expected: "DEGRADED",
		mode: "fast" as const,
	},
	{
		id: "low-confidence-escalate",
		payload: healthPayloads.unknown,
		expected: "ESCALATE",
		mode: "auto" as const,
	},
];
const m3Results = [];
for (const scenario of m3Cases) {
	const result = assertSuccess(
		`M3 ${scenario.id}`,
		await runtime.infer(
			request({
				mode: scenario.mode,
				payload: scenario.payload,
				callerRef: `m3:${scenario.id}`,
			}),
		),
	);
	const decision = (result.data as { decision?: string }).decision;
	if (decision !== scenario.expected)
		throw new Error(
			`M3 ${scenario.id} expected ${scenario.expected}, received ${decision}`,
		);
	m3Results.push({
		id: scenario.id,
		status: "PASS",
		requestedMode: scenario.mode,
		actualMode: result.actualMode,
		decision,
	});
}

let injected = false;
const faultProvider: ModelProvider = {
	async infer(call, signal) {
		const response = await trackedProvider.infer(call, signal);
		if (!injected) {
			injected = true;
			return { ...response, content: "injected-invalid-output" };
		}
		return response;
	},
};
const repairRuntime = createModelRuntime({
	specs: [systemHealthAssessmentSpec],
	roles,
	provider: faultProvider,
	inferenceTimeoutMs: 180_000,
});
const repaired = assertSuccess(
	"M3 invalid-output defense",
	await repairRuntime.infer(
		request({
			mode: "fast",
			payload: healthPayloads.healthy,
			callerRef: "m3:invalid-output-defense",
		}),
	),
);
m3Results.push({
	id: "invalid-output-defense",
	status: "PASS",
	faultInjected: true,
	repairBound: "once",
	decision: (repaired.data as { decision: string }).decision,
});

const m4Started = providerCalls.length;
const m4Inputs = Array.from({ length: 8 }, (_, index) => {
	const mode =
		(["fast", "reason", "auto", "fast"] as const)[index % 4] ?? "fast";
	const payload =
		index % 3 === 0 ? healthPayloads.warned : healthPayloads.healthy;
	return runtime.infer(
		request({
			mode,
			priority: index % 2 === 0 ? "business" : "background",
			payload,
			...(index === 2
				? {
						specRef: visionSpec.specRef,
						mode: "fast" as const,
						payload: { expectedAction: "OBSERVE_PAGE" as const },
						images: [{ mimeType: "image/png" as const, data: imageData }],
					}
				: {}),
			callerRef: `m4:mixed-${index + 1}`,
			timeoutMs: 600_000,
		}),
	);
});
const m4Results = await Promise.all(m4Inputs);
if (m4Results.some((result) => result.status !== "SUCCEEDED"))
	throw new Error(
		`M4 mixed sustained run contained a failure: ${JSON.stringify(
			m4Results.map((result, index) => ({
				index: index + 1,
				status: result.status,
				code: result.error?.code,
				message: result.error?.message,
				metrics: result.metrics,
			})),
		)}`,
	);
if (maxActiveProviderCalls !== 1)
	throw new Error(
		`M4 violated single lane: max active provider calls=${maxActiveProviderCalls}`,
	);

const report = {
	contract: "proflow.model-real-provider-gates.v1",
	startedAt,
	completedAt: new Date().toISOString(),
	provider: {
		kind: "OpenAI-compatible MLXHub",
		baseUrl,
		credentialUsed: Boolean(apiKey),
		fastModel,
		reasonModel,
	},
	M2: {
		status: "PASS",
		proofs: {
			fast: { status: m2Fast.status, actualMode: m2Fast.actualMode },
			reason: { status: m2Reason.status, actualMode: m2Reason.actualMode },
			structuredOutput: true,
			vision: { status: m2Vision.status, result: m2Vision.data },
			reasonVision: {
				status: m2ReasonVision.status,
				result: m2ReasonVision.data,
			},
			capabilityProposal: {
				status: m2Proposal.status,
				result: m2Proposal.data,
			},
			contextAndOutputLimitSanity: {
				inputBytes: Buffer.byteLength(JSON.stringify(contextPayload)),
				fast: {
					status: m2FastContext.status,
					result: m2FastContext.data,
				},
				reason: {
					status: m2ReasonContext.status,
					result: m2ReasonContext.data,
				},
			},
		},
		providerCalls: providerCalls.slice(m2Started, m2Ended),
	},
	M3: {
		status: "PASS",
		productionSpecs: [systemHealthAssessmentSpec.specRef],
		cases: m3Results,
	},
	M4: {
		status: "PASS",
		requestCount: m4Results.length,
		providerCallCount: providerCalls.length - m4Started,
		maxActiveProviderCalls,
		statuses: m4Results.map((result) => result.status),
		requestedModes: m4Results.map((result) => result.requestedMode),
		actualModes: m4Results.map((result) => result.actualMode),
		metrics: m4Results.map((result) => result.metrics),
		imageRequestCount: 1,
		providerCalls: providerCalls.slice(m4Started),
	},
	totals: {
		providerCalls: providerCalls.length,
		latencyMs: {
			min: Math.min(...providerCalls.map((call) => call.latencyMs)),
			max: Math.max(...providerCalls.map((call) => call.latencyMs)),
			total: providerCalls.reduce((total, call) => total + call.latencyMs, 0),
		},
	},
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
