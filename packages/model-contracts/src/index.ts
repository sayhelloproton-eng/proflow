import { z } from "zod";

export const inferenceModes = ["fast", "reason", "auto"] as const;
export const inferencePriorities = ["business", "background"] as const;
export const inferenceErrorCodes = [
	"INVALID_REQUEST",
	"MODEL_UNAVAILABLE",
	"CAPABILITY_UNSUPPORTED",
	"CONTEXT_TOO_LARGE",
	"QUEUE_TIMEOUT",
	"INFERENCE_TIMEOUT",
	"CANCELLED",
	"PROVIDER_ERROR",
	"INVALID_OUTPUT",
	"INFERENCE_FAILED",
] as const;

export const imageInputSchema = z
	.object({
		mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
		data: z.string().min(1),
	})
	.strict();

export const inferenceRequestSchema = z
	.object({
		contractVersion: z.literal("1.0.0"),
		specRef: z.string().min(1),
		mode: z.enum(inferenceModes),
		priority: z.enum(inferencePriorities),
		trace: z
			.object({
				callerRef: z.string().min(1),
				correlationId: z.string().min(1).optional(),
				taskId: z.string().min(1).optional(),
				nodeId: z.string().min(1).optional(),
				executionRef: z.string().min(1).optional(),
			})
			.strict(),
		payload: z.unknown(),
		images: z.array(imageInputSchema).min(1).optional(),
		timeoutMs: z.number().int().positive().optional(),
	})
	.strict();

export type InferenceRequest = z.infer<typeof inferenceRequestSchema>;
export type InferenceMode = InferenceRequest["mode"];
export type InferencePriority = InferenceRequest["priority"];

export const inferenceErrorSchema = z
	.object({
		code: z.enum(inferenceErrorCodes),
		message: z.string().min(1),
		retryable: z.boolean(),
	})
	.strict();

export const inferenceResultSchema = z
	.object({
		contractVersion: z.literal("1.0.0"),
		inferenceRef: z.string().min(1),
		specRef: z.string().min(1),
		status: z.enum(["SUCCEEDED", "FAILED", "CANCELLED"]),
		requestedMode: z.enum(inferenceModes),
		actualMode: z.enum(["fast", "reason"]).optional(),
		data: z.unknown().optional(),
		error: inferenceErrorSchema.optional(),
		metrics: z
			.object({
				queueLatencyMs: z.number().nonnegative(),
				inferenceLatencyMs: z.number().nonnegative().optional(),
				totalLatencyMs: z.number().nonnegative(),
			})
			.strict(),
	})
	.strict()
	.superRefine((value, context) => {
		if (
			value.status === "SUCCEEDED" &&
			(value.data === undefined || value.error)
		) {
			context.addIssue({
				code: "custom",
				message: "SUCCEEDED requires data and forbids error",
			});
		}
		if (
			value.status !== "SUCCEEDED" &&
			(!value.error || value.data !== undefined)
		) {
			context.addIssue({
				code: "custom",
				message: "non-success requires error and forbids data",
			});
		}
		if (value.status === "CANCELLED" && value.error?.code !== "CANCELLED") {
			context.addIssue({
				code: "custom",
				message: "CANCELLED status requires CANCELLED error",
			});
		}
	});

export type InferenceResult = z.infer<typeof inferenceResultSchema>;
export type InferenceErrorCode = (typeof inferenceErrorCodes)[number];

export const modelRuntimeStatusSchema = z
	.object({
		runtime: z.enum(["READY", "DEGRADED", "UNAVAILABLE"]),
		lane: z.enum(["IDLE", "BUSY"]),
		fast: z.enum(["READY", "UNAVAILABLE"]),
		reason: z.enum(["READY", "UNAVAILABLE"]),
		activeInferenceRef: z.string().min(1).optional(),
		activeRole: z.enum(["fast", "reason"]).optional(),
		businessQueueDepth: z.number().int().nonnegative(),
		backgroundQueueDepth: z.number().int().nonnegative(),
		lastSuccessAt: z.iso.datetime().optional(),
		lastFailureAt: z.iso.datetime().optional(),
		lastErrorCode: z.enum(inferenceErrorCodes).optional(),
	})
	.strict()
	.superRefine((value, context) => {
		if (
			value.lane === "IDLE" &&
			(value.activeInferenceRef || value.activeRole)
		) {
			context.addIssue({
				code: "custom",
				message: "IDLE lane cannot have an active inference",
			});
		}
		if (
			value.lane === "BUSY" &&
			(!value.activeInferenceRef || !value.activeRole)
		) {
			context.addIssue({
				code: "custom",
				message: "BUSY lane requires active diagnostics",
			});
		}
	});

export type ModelRuntimeStatus = z.infer<typeof modelRuntimeStatusSchema>;

export const modelCapabilityProfileSchema = z
	.object({
		modelRef: z.string().min(1),
		reasoningModes: z.array(z.enum(["thinking", "no-thinking"])).min(1),
		inputModalities: z.array(z.enum(["text", "image"])).min(1),
		structuredOutput: z.enum(["native", "prompted", "unsupported"]),
		contextWindow: z.number().int().positive(),
		maxOutputTokens: z.number().int().positive(),
	})
	.strict();

export type ModelCapabilityProfile = z.infer<
	typeof modelCapabilityProfileSchema
>;

const reasoningSpecMetadataSchema = z
	.object({
		id: z.string().regex(/^[a-z][a-z0-9.-]+$/),
		version: z.string().regex(/^\d+\.\d+\.\d+$/),
		purpose: z.string().min(1),
		allowedModes: z.array(z.enum(inferenceModes)).min(1),
		requiredModalities: z.array(z.enum(["text", "image"])).min(1),
		instruction: z.string().min(1),
		maxContextBytes: z.number().int().positive().optional(),
		maxOutputTokens: z.number().int().positive(),
		repair: z.enum(["none", "once"]).default("none"),
		routing: z
			.object({
				startRole: z.enum(["fast", "reason"]),
				allowReasonEscalation: z.boolean(),
				escalateDecisions: z.array(z.string().min(1)).default([]),
			})
			.strict()
			.optional(),
	})
	.strict();

export type ReasoningSpec<I, O> = z.infer<
	typeof reasoningSpecMetadataSchema
> & {
	readonly specRef: string;
	readonly inputSchema: z.ZodType<I>;
	readonly outputSchema: z.ZodType<O>;
};

export function createReasoningSpec<I, O>(input: {
	id: string;
	version: string;
	purpose: string;
	allowedModes: readonly InferenceMode[];
	requiredModalities: readonly ("text" | "image")[];
	inputSchema: z.ZodType<I>;
	outputSchema: z.ZodType<O>;
	instruction: string;
	maxContextBytes?: number;
	maxOutputTokens: number;
	repair?: "none" | "once";
	routing?: {
		startRole: "fast" | "reason";
		allowReasonEscalation: boolean;
		escalateDecisions?: readonly string[];
	};
}): ReasoningSpec<I, O> {
	const { inputSchema, outputSchema, ...metadata } = input;
	if (
		!(inputSchema instanceof z.ZodType) ||
		!(outputSchema instanceof z.ZodType)
	) {
		throw new TypeError(
			"ReasoningSpec requires runtime input and output schemas",
		);
	}
	const parsed = reasoningSpecMetadataSchema.parse(metadata);
	if (
		parsed.routing?.allowReasonEscalation &&
		!parsed.allowedModes.includes("auto")
	) {
		throw new TypeError("AUTO escalation requires auto in allowedModes");
	}
	const major = parsed.version.split(".")[0];
	return Object.freeze({
		...parsed,
		specRef: `${parsed.id}.v${major}`,
		inputSchema,
		outputSchema,
	});
}

export function capabilityProposalOutputSchema<
	const T extends Record<string, z.ZodType>,
>(candidates: T) {
	const names = Object.keys(candidates);
	if (names.length === 0)
		throw new TypeError("at least one capability candidate is required");
	const proposalSchema = z
		.object({
			action: z.literal("PROPOSE_CAPABILITY"),
			capability: z.string().min(1),
			arguments: z.unknown(),
			confidence: z.number().min(0).max(1),
			reasonCode: z.string().min(1),
			rationale: z.string().min(1).optional(),
		})
		.strict()
		.superRefine((proposal, context) => {
			const argumentsSchema = candidates[proposal.capability];
			if (!argumentsSchema) {
				context.addIssue({
					code: "custom",
					message: "capability is not a caller candidate",
				});
				return;
			}
			const parsed = argumentsSchema.safeParse(proposal.arguments);
			if (!parsed.success)
				context.addIssue({
					code: "custom",
					message: "capability arguments are invalid",
				});
		});
	return z.object({ proposal: proposalSchema.optional() }).strict();
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
			.join(",")}}`;
	return JSON.stringify(value);
}

const runtimeSchemas = Object.freeze({
	inferenceRequest: stableJson(z.toJSONSchema(inferenceRequestSchema)),
	inferenceResult: stableJson(z.toJSONSchema(inferenceResultSchema)),
	inferenceError: stableJson(z.toJSONSchema(inferenceErrorSchema)),
	modelRuntimeStatus: stableJson(z.toJSONSchema(modelRuntimeStatusSchema)),
	modelCapabilityProfile: stableJson(
		z.toJSONSchema(modelCapabilityProfileSchema),
	),
});

const runtimeRefinementProofs = Object.freeze({
	successRequiresDataAndForbidsError: !inferenceResultSchema.safeParse({
		contractVersion: "1.0.0",
		inferenceRef: "proof",
		specRef: "proof.v1",
		status: "SUCCEEDED",
		requestedMode: "fast",
		error: { code: "PROVIDER_ERROR", message: "x", retryable: true },
		metrics: { queueLatencyMs: 0, totalLatencyMs: 0 },
	}).success,
	cancelledRequiresCancelledError: !inferenceResultSchema.safeParse({
		contractVersion: "1.0.0",
		inferenceRef: "proof",
		specRef: "proof.v1",
		status: "CANCELLED",
		requestedMode: "fast",
		error: { code: "PROVIDER_ERROR", message: "x", retryable: true },
		metrics: { queueLatencyMs: 0, totalLatencyMs: 0 },
	}).success,
	busyRequiresActiveIdentity: !modelRuntimeStatusSchema.safeParse({
		runtime: "READY",
		lane: "BUSY",
		fast: "READY",
		reason: "READY",
		businessQueueDepth: 0,
		backgroundQueueDepth: 0,
	}).success,
});

export const MODEL_CONTRACT_DESCRIPTOR = Object.freeze({
	contractVersion: "1.0.0",
	publicApi: ["infer", "getRuntimeStatus"],
	publicTypes: [
		"InferenceRequest",
		"InferenceResult",
		"InferenceError",
		"ModelRuntimeStatus",
		"ModelCapabilityProfile",
		"ReasoningSpec",
		"CapabilityProposal",
	],
	request: [
		"contractVersion",
		"specRef",
		"mode",
		"priority",
		"trace.callerRef",
		"trace.correlationId?",
		"trace.taskId?",
		"trace.nodeId?",
		"trace.executionRef?",
		"payload",
		"images?",
		"images.mimeType",
		"images.data",
		"timeoutMs?",
	],
	result: [
		"contractVersion",
		"inferenceRef",
		"specRef",
		"status",
		"requestedMode",
		"actualMode?",
		"data?",
		"error?",
		"metrics.queueLatencyMs",
		"metrics.inferenceLatencyMs?",
		"metrics.totalLatencyMs",
	],
	runtimeStatus: [
		"runtime",
		"lane",
		"fast",
		"reason",
		"activeInferenceRef?",
		"activeRole?",
		"businessQueueDepth",
		"backgroundQueueDepth",
		"lastSuccessAt?",
		"lastFailureAt?",
		"lastErrorCode?",
	],
	error: ["code", "message", "retryable"],
	enums: {
		inferenceMode: [...inferenceModes],
		inferencePriority: [...inferencePriorities],
		inferenceStatus: ["SUCCEEDED", "FAILED", "CANCELLED"],
		runtimeHealth: ["READY", "DEGRADED", "UNAVAILABLE"],
		laneState: ["IDLE", "BUSY"],
		roleState: ["READY", "UNAVAILABLE"],
		reasoningMode: ["thinking", "no-thinking"],
		modality: ["text", "image"],
		structuredOutput: ["native", "prompted", "unsupported"],
		errorCode: [...inferenceErrorCodes],
	},
	requestFields: [
		"contractVersion",
		"specRef",
		"mode",
		"priority",
		"trace",
		"payload",
	],
	errorCodes: [...inferenceErrorCodes],
	statuses: ["SUCCEEDED", "FAILED", "CANCELLED"],
	runtimeSchemas,
	runtimeRefinementProofs,
});

type ContractDescriptor = {
	contractVersion: string;
	publicApi: readonly string[];
	publicTypes: readonly string[];
	request: readonly string[];
	result: readonly string[];
	runtimeStatus: readonly string[];
	error: readonly string[];
	enums: Readonly<Record<string, readonly string[]>>;
	requestFields: readonly string[];
	errorCodes: readonly string[];
	statuses: readonly string[];
	runtimeSchemas: Readonly<Record<string, string>>;
	runtimeRefinementProofs: Readonly<Record<string, boolean>>;
};

export function checkModelContractCompatibility(
	consumer: ContractDescriptor,
	provider: ContractDescriptor,
): { status: "PASS" | "FAIL"; missing: string[] } {
	const groups = [
		"publicApi",
		"publicTypes",
		"request",
		"result",
		"runtimeStatus",
		"error",
		"requestFields",
		"errorCodes",
		"statuses",
	] as const;
	const missing = groups.flatMap((group) =>
		consumer[group]
			.filter((item) => !provider[group].includes(item))
			.map((item) => `${group}:${item}`),
	);
	for (const [name, values] of Object.entries(consumer.enums)) {
		const providerValues = provider.enums[name] ?? [];
		for (const value of values) {
			if (!providerValues.includes(value))
				missing.push(`enums.${name}:${value}`);
		}
	}
	for (const [name, schema] of Object.entries(consumer.runtimeSchemas)) {
		if (provider.runtimeSchemas[name] !== schema)
			missing.push(`runtimeSchemas.${name}:breaking`);
	}
	for (const [name, expected] of Object.entries(
		consumer.runtimeRefinementProofs,
	)) {
		if (provider.runtimeRefinementProofs[name] !== expected)
			missing.push(`runtimeRefinementProofs.${name}:breaking`);
	}
	if (
		consumer.contractVersion.split(".")[0] !==
		provider.contractVersion.split(".")[0]
	) {
		missing.push(`contractVersion:${consumer.contractVersion}`);
	}
	return { status: missing.length === 0 ? "PASS" : "FAIL", missing };
}
