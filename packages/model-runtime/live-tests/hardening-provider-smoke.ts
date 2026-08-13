import {
	createFileModelRuntimeLogger,
	createModelRuntime,
	renderPrompt,
	verifyRoleCapabilities,
} from "../src/index.ts";
import {
	createOpenAICompatibleProvider,
	type ModelRole,
	type ProviderCall,
} from "../src/provider.ts";
import { systemHealthAssessmentSpec } from "../src/specs/system-health-assessment.ts";

const baseUrl = process.env.PROFLOW_MODEL_BASE_URL;
const fastModel = process.env.PROFLOW_MODEL_FAST_MODEL;
const reasonModel = process.env.PROFLOW_MODEL_REASON_MODEL;
const proflowRoot = process.env.PROFLOW_INSTANCE_ROOT;
if (!baseUrl || !fastModel || !reasonModel || !proflowRoot)
	throw new Error(
		"PROFLOW_MODEL_BASE_URL, PROFLOW_MODEL_FAST_MODEL, PROFLOW_MODEL_REASON_MODEL, and PROFLOW_INSTANCE_ROOT are required",
	);

const provider = createOpenAICompatibleProvider({
	baseUrl,
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
			"You are the REASON bounded escalation role. Use concise internal reasoning, then return only the final JSON object.",
	},
});

const payload = {
	service: "model-runtime",
	checks: [
		{ name: "provider", state: "PASS" as const },
		{ name: "lane", state: "PASS" as const },
	],
};

const request = (role: ModelRole, callerRef: string) => ({
	contractVersion: "1.0.0" as const,
	specRef: systemHealthAssessmentSpec.specRef,
	mode: role,
	priority: "business" as const,
	trace: {
		callerRef,
		correlationId: "pre-execution-hardening-20260813",
	},
	payload,
	timeoutMs: 75_000,
});

type Probe = {
	role: ModelRole;
	status: "PASS";
	latencyMs: number;
	providerRequestRef?: string;
	finishReason?: string;
	thinkingStatus: "absent" | "closed";
	structuredValidation: "PASS";
};

async function probe(role: ModelRole): Promise<Probe> {
	const call: ProviderCall = {
		role,
		structuredOutput: "native",
		request: request(role, `hardening:verify:${role}`),
		spec: systemHealthAssessmentSpec,
		prompt: renderPrompt(systemHealthAssessmentSpec, payload),
		repair: false,
	};
	const startedAt = Date.now();
	const response = await provider.infer(call, AbortSignal.timeout(75_000));
	systemHealthAssessmentSpec.outputSchema.parse(JSON.parse(response.content));
	const expectedThinking = role === "fast" ? "absent" : "closed";
	if (response.thinkingStatus !== expectedThinking)
		throw new Error(
			`${role} reasoning verification mismatch: expected ${expectedThinking}, received ${response.thinkingStatus ?? "unobserved"}`,
		);
	if (response.finishReason !== "stop")
		throw new Error(
			`${role} provider did not finish cleanly: ${response.finishReason ?? "unobserved"}`,
		);
	return {
		role,
		status: "PASS",
		latencyMs: Date.now() - startedAt,
		...(response.providerRequestRef
			? { providerRequestRef: response.providerRequestRef }
			: {}),
		...(response.finishReason ? { finishReason: response.finishReason } : {}),
		thinkingStatus: response.thinkingStatus,
		structuredValidation: "PASS",
	};
}

const startedAt = new Date().toISOString();
const probes = [await probe("fast"), await probe("reason")];
const verifiedAt = new Date().toISOString();
const roles = verifyRoleCapabilities({
	declared: {
		fast: {
			profile: {
				modelRef: fastModel,
				reasoningModes: ["no-thinking"],
				inputModalities: ["text"],
				structuredOutput: "native",
				contextWindow: 32_768,
				maxOutputTokens: 2_048,
			},
		},
		reason: {
			profile: {
				modelRef: reasonModel,
				reasoningModes: ["thinking"],
				inputModalities: ["text"],
				structuredOutput: "native",
				contextWindow: 32_768,
				maxOutputTokens: 2_048,
			},
		},
	},
	observed: {
		fast: {
			modelRef: fastModel,
			text: true,
			image: false,
			structuredOutput: "native",
			contextWindow: 32_768,
			maxOutputTokens: 1_024,
			reasoning: "no-thinking",
			reasoningBasis: "provider-response-thinking-absent",
			verifiedAt,
		},
		reason: {
			modelRef: reasonModel,
			text: true,
			image: false,
			structuredOutput: "native",
			contextWindow: 32_768,
			maxOutputTokens: 2_048,
			reasoning: "thinking",
			reasoningBasis: "provider-response-thinking-closed",
			verifiedAt,
		},
	},
});
const runtime = createModelRuntime({
	specs: [systemHealthAssessmentSpec],
	roles,
	provider,
	inferenceTimeoutMs: 75_000,
	logger: createFileModelRuntimeLogger({ proflowRoot }),
});
const healthBefore = runtime.getRuntimeStatus();
const inferenceResults = [];
for (const role of ["fast", "reason"] as const) {
	const result = await runtime.infer(
		request(role, `hardening:closing-smoke:${role}`),
	);
	if (result.status !== "SUCCEEDED")
		throw new Error(
			`${role} closing inference failed: ${result.error?.code ?? "unknown"}`,
		);
	inferenceResults.push({
		role,
		status: result.status,
		actualMode: result.actualMode,
		metrics: result.metrics,
	});
}
const healthAfter = runtime.getRuntimeStatus();
process.stdout.write(
	`${JSON.stringify(
		{
			contract: "proflow.model-hardening-live-summary.v1",
			classification: "TEMPORARY_REVIEW_EVIDENCE",
			normative: false,
			status: "PASS",
			startedAt,
			completedAt: new Date().toISOString(),
			provider: {
				kind: "OpenAI-compatible MLXHub",
				credentialUsed: false,
				fastModel,
				reasonModel,
			},
			callBudget: { maximum: 4, actual: 4 },
			probes,
			healthBefore,
			inferenceResults,
			healthAfter,
			formalRuntimeLog: "<PROFLOW_INSTANCE_ROOT>/logs/model/inference.jsonl",
			sanitization: {
				promptPersisted: false,
				chainOfThoughtPersisted: false,
				payloadPersisted: false,
				imageOrBase64Persisted: false,
				secretPersisted: false,
			},
		},
		null,
		2,
	)}\n`,
);
