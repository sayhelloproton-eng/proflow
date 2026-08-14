import { z } from "zod";

export const EXECUTION_CONTRACT_VERSION = "1.0.0" as const;

export const localCapabilityIds = [
	"file.read",
	"file.write",
	"file.searchText",
	"git.status",
	"git.diff",
	"git.commit",
	"git.push",
	"project.info",
	"project.installDependency",
	"quality.test",
	"quality.build",
	"quality.lint",
	"quality.typecheck",
	"code.findSymbol",
	"code.findReferences",
	"process.start",
	"process.stop",
	"process.status",
	"network.request",
	"shell.run",
] as const;

export const browserCapabilityIds = [
	"browser.observe",
	"browser.screenshot",
	"browser.navigate",
	"browser.input",
	"browser.click",
	"browser.upload",
	"browser.submit",
	"browser.wait",
	"browser.verify",
	"worker.create",
	"worker.restore",
	"worker.wake",
	"collaboration.deliver",
] as const;

export const executionCapabilityIds = [
	...localCapabilityIds,
	...browserCapabilityIds,
] as const;
export type LocalCapabilityId = (typeof localCapabilityIds)[number];
export type BrowserCapabilityId = (typeof browserCapabilityIds)[number];
export type ExecutionCapabilityId = (typeof executionCapabilityIds)[number];

export const executionStatuses = [
	"PENDING",
	"RUNNING",
	"SUCCEEDED",
	"FAILED",
	"UNKNOWN",
] as const;
export const sideEffectStates = [
	"NOT_STARTED",
	"STARTED",
	"APPLIED",
	"NOT_APPLIED",
	"UNKNOWN",
] as const;
export type ExecutionStatus = (typeof executionStatuses)[number];
export type SideEffectState = (typeof sideEffectStates)[number];

export const executionErrorCodes = [
	"INVALID_REQUEST",
	"IDENTITY_INVALID",
	"SCOPE_DENIED",
	"POLICY_DENIED",
	"APPROVAL_REQUIRED",
	"APPROVAL_INVALID",
	"PRECONDITION_FAILED",
	"EXECUTOR_UNAVAILABLE",
	"EXECUTION_FAILED",
	"TIMEOUT",
	"CANCELLED",
	"IDEMPOTENCY_CONFLICT",
	"DECISION_UNRESOLVED",
	"UNKNOWN_SIDE_EFFECT",
] as const;
export type ExecutionErrorCode = (typeof executionErrorCodes)[number];

type Brand<Value, Name extends string> = Value & { readonly __brand: Name };
export type ExecutionRef = Brand<string, "ExecutionRef">;
export type ArtifactRef = Brand<string, "ArtifactRef">;
export type EvidenceRef = Brand<string, "EvidenceRef">;

const identifier = z.string().min(1);
const relativePath = z.string().min(1);
const positiveMilliseconds = z.number().int().positive();
const outputOptions = {
	timeoutMs: positiveMilliseconds.optional(),
	maxOutputBytes: z.number().int().positive().optional(),
};

const emptyInput = z.object({}).strict();
const qualityInput = z
	.object({
		script: z.string().min(1).optional(),
		args: z.array(z.string()).optional(),
		cwd: relativePath.optional(),
		...outputOptions,
	})
	.strict();
const codeQueryInput = z
	.object({
		symbol: z.string().min(1),
		paths: z.array(relativePath).optional(),
		maxMatches: z.number().int().positive().max(10_000).optional(),
	})
	.strict();
const browserTarget = {
	roleRef: identifier.optional(),
	workerRef: identifier.optional(),
	targetRef: identifier,
};

const capabilityInputSchemas = {
	"file.read": z
		.object({ path: relativePath, encoding: z.literal("utf8").optional() })
		.strict(),
	"file.write": z
		.object({
			path: relativePath,
			content: z.string(),
			encoding: z.literal("utf8").optional(),
			createParents: z.boolean().optional(),
		})
		.strict(),
	"file.searchText": z
		.object({
			query: z.string().min(1),
			paths: z.array(relativePath).optional(),
			maxMatches: z.number().int().positive().max(10_000).optional(),
		})
		.strict(),
	"git.status": emptyInput,
	"git.diff": z
		.object({ staged: z.boolean().optional(), path: relativePath.optional() })
		.strict(),
	"git.commit": z
		.object({
			message: z.string().min(1),
			paths: z.array(relativePath).min(1).optional(),
		})
		.strict(),
	"git.push": z
		.object({
			remote: z.string().min(1).optional(),
			branch: z.string().min(1).optional(),
			force: z.literal(false).optional(),
		})
		.strict(),
	"project.info": emptyInput,
	"project.installDependency": z
		.object({
			packageName: z.string().min(1),
			version: z.string().min(1).optional(),
			dev: z.boolean().optional(),
			packageManager: z.enum(["pnpm", "npm", "yarn"]).optional(),
			...outputOptions,
		})
		.strict(),
	"quality.test": qualityInput,
	"quality.build": qualityInput,
	"quality.lint": qualityInput,
	"quality.typecheck": qualityInput,
	"code.findSymbol": codeQueryInput,
	"code.findReferences": codeQueryInput,
	"process.start": z
		.object({
			mode: z.enum(["one-shot", "managed"]),
			command: z.string().min(1),
			args: z.array(z.string()),
			cwd: relativePath.optional(),
			env: z.record(z.string(), z.string()).optional(),
			readiness: z
				.discriminatedUnion("kind", [
					z
						.object({
							kind: z.literal("port"),
							port: z.number().int().min(1).max(65_535),
						})
						.strict(),
					z.object({ kind: z.literal("http"), url: z.url() }).strict(),
					z
						.object({ kind: z.literal("log"), pattern: z.string().min(1) })
						.strict(),
				])
				.optional(),
			...outputOptions,
		})
		.strict(),
	"process.stop": z.object({ processRef: identifier }).strict(),
	"process.status": z.object({ processRef: identifier }).strict(),
	"network.request": z
		.object({
			url: z.url(),
			method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]),
			headers: z.record(z.string(), z.string()).optional(),
			body: z.string().optional(),
			followRedirects: z.boolean().optional(),
			...outputOptions,
		})
		.strict(),
	"shell.run": z
		.object({
			command: z.string().min(1),
			args: z.array(z.string()),
			cwd: relativePath.optional(),
			env: z.record(z.string(), z.string()).optional(),
			...outputOptions,
		})
		.strict(),
	"browser.observe": z.object(browserTarget).strict(),
	"browser.screenshot": z.object(browserTarget).strict(),
	"browser.navigate": z.object({ ...browserTarget, url: z.url() }).strict(),
	"browser.input": z
		.object({ ...browserTarget, selector: identifier, value: z.string() })
		.strict(),
	"browser.click": z
		.object({ ...browserTarget, selector: identifier })
		.strict(),
	"browser.upload": z
		.object({ ...browserTarget, selector: identifier, artifactRef: identifier })
		.strict(),
	"browser.submit": z
		.object({
			...browserTarget,
			selector: identifier.optional(),
			fingerprint: identifier,
		})
		.strict(),
	"browser.wait": z
		.object({
			...browserTarget,
			condition: identifier,
			timeoutMs: positiveMilliseconds,
		})
		.strict(),
	"browser.verify": z
		.object({ ...browserTarget, expectedFingerprint: identifier })
		.strict(),
	"worker.create": z
		.object({
			roleRef: identifier,
			roleUrl: z.url(),
			bootstrapFingerprint: identifier,
		})
		.strict(),
	"worker.restore": z
		.object({
			roleRef: identifier,
			workerRef: identifier,
			conversationUrl: z.url(),
		})
		.strict(),
	"worker.wake": z
		.object({
			roleRef: identifier,
			workerRef: identifier,
			trigger: z.string().min(1),
			fingerprint: identifier,
		})
		.strict(),
	"collaboration.deliver": z
		.object({
			roleRef: identifier,
			workerRef: identifier,
			messageRef: identifier,
			contentFingerprint: identifier,
		})
		.strict(),
} satisfies Record<ExecutionCapabilityId, z.ZodType>;

const executionRequestBaseSchema = z
	.object({
		contract: z.literal("execution"),
		contractVersion: z.literal(EXECUTION_CONTRACT_VERSION),
		executionRef: identifier.optional(),
		idempotencyKey: identifier,
		callerRef: identifier,
		correlationId: identifier.optional(),
		taskId: identifier.optional(),
		nodeId: identifier.optional(),
		runNo: z.number().int().positive().optional(),
		roleRef: identifier.optional(),
		workerRef: identifier.optional(),
		projectRoot: z.string().min(1).optional(),
		approvalRef: identifier.optional(),
		timeoutMs: positiveMilliseconds.optional(),
		capability: z.enum(executionCapabilityIds),
		input: z.unknown(),
	})
	.strict();

type ExecuteBase = Omit<
	z.infer<typeof executionRequestBaseSchema>,
	"capability" | "input"
>;
type CapabilityInput<Capability extends ExecutionCapabilityId> = z.infer<
	(typeof capabilityInputSchemas)[Capability]
>;
export type ExecuteCapabilityRequest = {
	[Capability in ExecutionCapabilityId]: ExecuteBase & {
		capability: Capability;
		input: CapabilityInput<Capability>;
	};
}[ExecutionCapabilityId];

export const executeCapabilityRequestSchema = executionRequestBaseSchema
	.superRefine((request, context) => {
		const parsed = capabilityInputSchemas[request.capability].safeParse(
			request.input,
		);
		if (!parsed.success) {
			for (const issue of parsed.error.issues) {
				context.addIssue({
					code: "custom",
					message: issue.message,
					path: ["input", ...issue.path],
				});
			}
		}
	})
	.transform((request) => request as ExecuteCapabilityRequest);

const outputSummarySchema = z
	.object({
		exitCode: z.number().int(),
		durationMs: z.number().nonnegative(),
		stdoutSummary: z.string(),
		stderrSummary: z.string(),
		stdoutRef: identifier,
		stderrRef: identifier,
	})
	.strict();
const browserResultSchema = z
	.object({
		targetRef: identifier,
		verified: z.boolean(),
		observationRef: identifier.optional(),
	})
	.strict();

const capabilityResultSchemas = {
	"file.read": z
		.object({
			path: z.string(),
			content: z.string(),
			bytes: z.number().int().nonnegative(),
			hash: identifier,
		})
		.strict(),
	"file.write": z
		.object({
			path: z.string(),
			beforeHash: identifier.optional(),
			afterHash: identifier,
			bytes: z.number().int().nonnegative(),
			diffRef: identifier.optional(),
		})
		.strict(),
	"file.searchText": z
		.object({
			matches: z.array(
				z
					.object({
						path: z.string(),
						line: z.number().int().positive(),
						text: z.string(),
					})
					.strict(),
			),
			truncated: z.boolean(),
		})
		.strict(),
	"git.status": z
		.object({ branch: z.string(), clean: z.boolean(), summary: z.string() })
		.strict(),
	"git.diff": z.object({ summary: z.string(), diffRef: identifier }).strict(),
	"git.commit": z.object({ commitSha: identifier, head: identifier }).strict(),
	"git.push": z
		.object({ remote: identifier, branch: identifier, head: identifier })
		.strict(),
	"project.info": z
		.object({
			packageManager: z.string().optional(),
			scripts: z.array(z.string()),
			dependencies: z.array(z.string()),
		})
		.strict(),
	"project.installDependency": z
		.object({
			packageManager: identifier,
			requested: identifier,
			resolvedVersion: z.string().optional(),
			manifestChanged: z.boolean(),
			lockfileChanged: z.boolean(),
			output: outputSummarySchema,
		})
		.strict(),
	"quality.test": outputSummarySchema,
	"quality.build": outputSummarySchema,
	"quality.lint": outputSummarySchema,
	"quality.typecheck": outputSummarySchema,
	"code.findSymbol": z
		.object({
			matches: z.array(
				z
					.object({
						path: z.string(),
						line: z.number().int().positive(),
						text: z.string(),
					})
					.strict(),
			),
			truncated: z.boolean(),
		})
		.strict(),
	"code.findReferences": z
		.object({
			matches: z.array(
				z
					.object({
						path: z.string(),
						line: z.number().int().positive(),
						text: z.string(),
					})
					.strict(),
			),
			truncated: z.boolean(),
		})
		.strict(),
	"process.start": z.discriminatedUnion("mode", [
		z
			.object({ mode: z.literal("one-shot"), output: outputSummarySchema })
			.strict(),
		z
			.object({
				mode: z.literal("managed"),
				processRef: identifier,
				pid: z.number().int().positive(),
				ready: z.boolean(),
				stdoutRef: identifier,
				stderrRef: identifier,
			})
			.strict(),
	]),
	"process.stop": z
		.object({ processRef: identifier, stopped: z.boolean() })
		.strict(),
	"process.status": z
		.object({
			processRef: identifier,
			state: z.enum(["RUNNING", "STOPPED", "UNKNOWN"]),
			pid: z.number().int().positive().optional(),
		})
		.strict(),
	"network.request": z
		.object({
			url: z.url(),
			status: z.number().int().min(100).max(599),
			headers: z.record(z.string(), z.string()),
			bodySummary: z.string(),
			bodyRef: identifier,
		})
		.strict(),
	"shell.run": outputSummarySchema,
	"browser.observe": browserResultSchema,
	"browser.screenshot": browserResultSchema,
	"browser.navigate": browserResultSchema,
	"browser.input": browserResultSchema,
	"browser.click": browserResultSchema,
	"browser.upload": browserResultSchema,
	"browser.submit": browserResultSchema,
	"browser.wait": browserResultSchema,
	"browser.verify": browserResultSchema,
	"worker.create": z
		.object({
			roleRef: identifier,
			workerRef: identifier,
			conversationUrl: z.url(),
			verified: z.literal(true),
		})
		.strict(),
	"worker.restore": z
		.object({
			roleRef: identifier,
			workerRef: identifier,
			restored: z.boolean(),
		})
		.strict(),
	"worker.wake": z
		.object({
			roleRef: identifier,
			workerRef: identifier,
			triggerFingerprint: identifier,
			delivered: z.boolean(),
		})
		.strict(),
	"collaboration.deliver": z
		.object({
			messageRef: identifier,
			delivered: z.boolean(),
			evidenceRef: identifier,
		})
		.strict(),
} satisfies Record<ExecutionCapabilityId, z.ZodType>;

type CapabilityResultData<Capability extends ExecutionCapabilityId> = z.infer<
	(typeof capabilityResultSchemas)[Capability]
>;
export type ExecutionCapabilityResult = {
	[Capability in ExecutionCapabilityId]: {
		capability: Capability;
		data: CapabilityResultData<Capability>;
	};
}[ExecutionCapabilityId];

export const executionCapabilityResultSchema = z
	.object({ capability: z.enum(executionCapabilityIds), data: z.unknown() })
	.strict()
	.superRefine((result, context) => {
		const parsed = capabilityResultSchemas[result.capability].safeParse(
			result.data,
		);
		if (!parsed.success) {
			for (const issue of parsed.error.issues) {
				context.addIssue({
					code: "custom",
					message: issue.message,
					path: ["data", ...issue.path],
				});
			}
		}
	})
	.transform((result) => result as ExecutionCapabilityResult);

export const executionErrorSchema = z
	.object({
		code: z.enum(executionErrorCodes),
		message: z.string().min(1),
		retryable: z.boolean(),
		correlationId: identifier.optional(),
		details: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();
export type ExecutionError = z.infer<typeof executionErrorSchema>;

export const externalFileMaterializationInputSchema = z
	.object({
		name: z.string().min(1),
		provenanceRef: identifier,
		declaredMimeType: z.string().min(1),
		sourceUrl: z.url(),
	})
	.strict();
export type ExternalFileMaterializationInput = z.infer<
	typeof externalFileMaterializationInputSchema
>;

export const materializeExternalFilesRequestSchema = z
	.object({
		contract: z.literal("execution.external-file-materialization"),
		contractVersion: z.literal(EXECUTION_CONTRACT_VERSION),
		callerRef: identifier,
		files: z.array(externalFileMaterializationInputSchema).min(1).max(10),
	})
	.strict();
export type MaterializeExternalFilesRequest = z.infer<
	typeof materializeExternalFilesRequestSchema
>;

export const externalFileMaterializationResultSchema = z
	.object({
		name: z.string().min(1),
		provenanceRef: identifier,
		declaredMimeType: z.string().min(1),
		detectedMimeType: z.string().min(1),
		bytes: z.number().int().nonnegative(),
		hash: identifier,
		artifactRef: identifier,
		content: z.string().optional(),
	})
	.strict();
export type ExternalFileMaterializationResult = z.infer<
	typeof externalFileMaterializationResultSchema
>;

export const materializeExternalFilesResponseSchema = z
	.object({
		contract: z.literal("execution.external-file-materialization"),
		contractVersion: z.literal(EXECUTION_CONTRACT_VERSION),
		files: z.array(externalFileMaterializationResultSchema),
	})
	.strict();
export type MaterializeExternalFilesResponse = z.infer<
	typeof materializeExternalFilesResponseSchema
>;

export const executionEvidenceSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("file"),
			evidenceRef: identifier,
			path: z.string(),
			beforeHash: identifier.optional(),
			afterHash: identifier.optional(),
			bytes: z.number().int().nonnegative().optional(),
			diffRef: identifier.optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("git"),
			evidenceRef: identifier,
			commitSha: identifier.optional(),
			head: identifier,
			summary: z.string().optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("process"),
			evidenceRef: identifier,
			processRef: identifier.optional(),
			pid: z.number().int().positive().optional(),
			exitCode: z.number().int().optional(),
			stdoutRef: identifier.optional(),
			stderrRef: identifier.optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("network"),
			evidenceRef: identifier,
			url: z.url(),
			status: z.number().int().min(100).max(599),
			bodyRef: identifier.optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("output"),
			evidenceRef: identifier,
			stream: z.enum(["stdout", "stderr", "combined", "report"]),
			artifactRef: identifier,
			bytes: z.number().int().nonnegative(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("browser"),
			evidenceRef: identifier,
			targetRef: identifier,
			observationRef: identifier,
			verified: z.boolean(),
		})
		.strict(),
]);
export type ExecutionEvidence = z.infer<typeof executionEvidenceSchema>;

const legalStatePairs = new Set([
	"PENDING:NOT_STARTED",
	"RUNNING:NOT_STARTED",
	"RUNNING:STARTED",
	"SUCCEEDED:APPLIED",
	"SUCCEEDED:NOT_APPLIED",
	"FAILED:NOT_APPLIED",
	"UNKNOWN:UNKNOWN",
]);

export const executionRecordSchema = z
	.object({
		contract: z.literal("execution"),
		contractVersion: z.literal(EXECUTION_CONTRACT_VERSION),
		executionRef: identifier,
		capability: z.enum(executionCapabilityIds),
		callerRef: identifier,
		correlationId: identifier.optional(),
		taskId: identifier.optional(),
		nodeId: identifier.optional(),
		runNo: z.number().int().positive().optional(),
		roleRef: identifier.optional(),
		workerRef: identifier.optional(),
		idempotencyKey: identifier,
		inputFingerprint: identifier,
		status: z.enum(executionStatuses),
		sideEffectState: z.enum(sideEffectStates),
		retryable: z.boolean(),
		decisionPath: z
			.enum(["deterministic", "fast", "reason", "human"])
			.optional(),
		approvalRef: identifier.optional(),
		result: executionCapabilityResultSchema.optional(),
		evidence: z.array(executionEvidenceSchema),
		evidenceRefs: z.array(identifier).optional(),
		artifactRefs: z.array(identifier).optional(),
		error: executionErrorSchema.optional(),
		attemptCount: z.number().int().nonnegative(),
		createdAt: z.iso.datetime(),
		startedAt: z.iso.datetime().optional(),
		effectStartedAt: z.iso.datetime().optional(),
		finishedAt: z.iso.datetime().optional(),
		updatedAt: z.iso.datetime(),
	})
	.strict()
	.superRefine((record, context) => {
		if (!legalStatePairs.has(`${record.status}:${record.sideEffectState}`)) {
			context.addIssue({
				code: "custom",
				message: "illegal ExecutionStatus and SideEffectState combination",
				path: ["sideEffectState"],
			});
		}
		if (record.status === "SUCCEEDED") {
			if (record.result === undefined || record.error !== undefined)
				context.addIssue({
					code: "custom",
					message: "SUCCEEDED requires result and forbids error",
				});
			if (record.result?.capability !== record.capability)
				context.addIssue({
					code: "custom",
					message: "result capability must match execution capability",
					path: ["result", "capability"],
				});
		} else if (record.result !== undefined) {
			context.addIssue({
				code: "custom",
				message: "only SUCCEEDED may contain result",
				path: ["result"],
			});
		}
		if (record.status === "FAILED" || record.status === "UNKNOWN") {
			if (record.error === undefined)
				context.addIssue({
					code: "custom",
					message: `${record.status} requires error`,
					path: ["error"],
				});
		} else if (record.error !== undefined) {
			context.addIssue({
				code: "custom",
				message: `${record.status} forbids error`,
				path: ["error"],
			});
		}
		if (
			record.status === "UNKNOWN" &&
			(record.error?.code !== "UNKNOWN_SIDE_EFFECT" || record.retryable)
		) {
			context.addIssue({
				code: "custom",
				message: "UNKNOWN requires non-retryable UNKNOWN_SIDE_EFFECT",
				path: ["error"],
			});
		}
	});
export type ExecutionRecord = z.infer<typeof executionRecordSchema>;
export type ExecuteCapabilityResponse = ExecutionRecord;
export type GetExecutionResponse = ExecutionRecord;

export const readExecutionOutputRequestSchema = z
	.object({
		contract: z.literal("execution"),
		contractVersion: z.literal(EXECUTION_CONTRACT_VERSION),
		executionRef: identifier,
		stream: z.enum(["stdout", "stderr", "combined", "report"]),
		offset: z.number().int().nonnegative().optional(),
		limit: z.number().int().positive().max(65_536).optional(),
	})
	.strict();
export type ReadExecutionOutputRequest = z.infer<
	typeof readExecutionOutputRequestSchema
>;

export const readExecutionOutputResponseSchema = z
	.object({
		contract: z.literal("execution"),
		contractVersion: z.literal(EXECUTION_CONTRACT_VERSION),
		executionRef: identifier,
		stream: z.enum(["stdout", "stderr", "combined", "report"]),
		chunk: z.string(),
		offset: z.number().int().nonnegative(),
		nextOffset: z.number().int().nonnegative(),
		eof: z.boolean(),
		evidenceRef: identifier,
	})
	.strict();
export type ReadExecutionOutputResponse = z.infer<
	typeof readExecutionOutputResponseSchema
>;

export const cancelExecutionRequestSchema = z
	.object({
		contract: z.literal("execution"),
		contractVersion: z.literal(EXECUTION_CONTRACT_VERSION),
		executionRef: identifier,
		callerRef: identifier,
		correlationId: identifier.optional(),
		reason: z.string().min(1),
	})
	.strict();
export type CancelExecutionRequest = z.infer<
	typeof cancelExecutionRequestSchema
>;
export type CancelExecutionResponse = ExecutionRecord;

export interface ExecutionService {
	executeCapability(
		request: ExecuteCapabilityRequest,
	): Promise<ExecuteCapabilityResponse>;
	getExecution(executionRef: ExecutionRef): Promise<GetExecutionResponse>;
	readExecutionOutput(
		request: ReadExecutionOutputRequest,
	): Promise<ReadExecutionOutputResponse>;
	cancelExecution(
		request: CancelExecutionRequest,
	): Promise<CancelExecutionResponse>;
}

export function parseExecuteCapabilityRequest(
	input: unknown,
): ExecuteCapabilityRequest {
	return executeCapabilityRequestSchema.parse(input);
}
export function parseExecutionRecord(input: unknown): ExecutionRecord {
	return executionRecordSchema.parse(input);
}
export function parseExecutionRef(input: unknown): ExecutionRef {
	return identifier.parse(input) as ExecutionRef;
}
export function parseReadExecutionOutputRequest(
	input: unknown,
): ReadExecutionOutputRequest {
	return readExecutionOutputRequestSchema.parse(input);
}
export function parseReadExecutionOutputResponse(
	input: unknown,
): ReadExecutionOutputResponse {
	return readExecutionOutputResponseSchema.parse(input);
}
export function parseCancelExecutionRequest(
	input: unknown,
): CancelExecutionRequest {
	return cancelExecutionRequestSchema.parse(input);
}
export function parseCapabilityResult(
	input: unknown,
): ExecutionCapabilityResult {
	return executionCapabilityResultSchema.parse(input);
}

export const EXECUTION_CONTRACT_DESCRIPTOR = Object.freeze({
	contractVersion: EXECUTION_CONTRACT_VERSION,
	publicApi: [
		"executeCapability",
		"getExecution",
		"readExecutionOutput",
		"cancelExecution",
	],
	publicTypes: [
		"ExecuteCapabilityRequest",
		"ExecutionRecord",
		"ExecutionStatus",
		"SideEffectState",
		"ExecutionCapabilityResult",
		"ExecutionEvidence",
		"ExecutionError",
		"ReadExecutionOutputRequest",
		"ReadExecutionOutputResponse",
		"CancelExecutionRequest",
	],
	request: [
		"contract",
		"contractVersion",
		"executionRef?",
		"idempotencyKey",
		"callerRef",
		"correlationId?",
		"taskId?",
		"nodeId?",
		"runNo?",
		"roleRef?",
		"workerRef?",
		"projectRoot?",
		"approvalRef?",
		"timeoutMs?",
		"capability",
		"input",
	],
	record: [
		"contract",
		"contractVersion",
		"executionRef",
		"capability",
		"callerRef",
		"idempotencyKey",
		"inputFingerprint",
		"status",
		"sideEffectState",
		"retryable",
		"result?",
		"evidence",
		"error?",
		"attemptCount",
		"createdAt",
		"updatedAt",
	],
	error: ["code", "message", "retryable", "correlationId?", "details?"],
	capabilities: [...executionCapabilityIds],
	statuses: [...executionStatuses],
	sideEffectStates: [...sideEffectStates],
	errorCodes: [...executionErrorCodes],
});

type ExecutionContractDescriptor = typeof EXECUTION_CONTRACT_DESCRIPTOR;

export function checkExecutionContractCompatibility(
	consumer: ExecutionContractDescriptor,
	provider: ExecutionContractDescriptor,
): { status: "PASS" | "FAIL"; missing: string[] } {
	const groups = [
		"publicApi",
		"publicTypes",
		"request",
		"record",
		"error",
		"capabilities",
		"statuses",
		"sideEffectStates",
		"errorCodes",
	] as const;
	const missing = groups.flatMap((group) => {
		const providerValues: readonly string[] = provider[group];
		return consumer[group]
			.filter((item) => !providerValues.includes(item))
			.map((item) => `${group}:${item}`);
	});
	if (
		consumer.contractVersion.split(".")[0] !==
		provider.contractVersion.split(".")[0]
	)
		missing.push(`contractVersion:${consumer.contractVersion}`);
	return { status: missing.length === 0 ? "PASS" : "FAIL", missing };
}
