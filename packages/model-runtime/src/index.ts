import { randomUUID } from "node:crypto";

import {
	createReasoningSpec,
	type InferenceErrorCode,
	type InferenceMode,
	type InferenceRequest,
	type InferenceResult,
	inferenceRequestSchema,
	type ModelRuntimeStatus,
	type ReasoningSpec,
} from "@tomflow/proflow-model-contracts";
import {
	type ModelProvider,
	type ModelRole,
	type ModelRoles,
	type ObservedRoleCapabilities,
	type ProviderCall,
	type ProviderResponse,
	verifyRoleCapabilities,
} from "./provider.ts";

export type {
	ModelProvider,
	ModelRole,
	ModelRoles,
	ObservedRoleCapabilities,
	ProviderCall,
	ProviderResponse,
};
export { createReasoningSpec, verifyRoleCapabilities };

export const MODEL_RUNTIME_PUBLIC_API = ["infer", "getRuntimeStatus"] as const;

type RuntimeOptions = {
	specs: readonly ReasoningSpec<unknown, unknown>[];
	roles: ModelRoles;
	provider: ModelProvider;
	queueTimeoutMs?: number;
	inferenceTimeoutMs?: number;
	now?: () => number;
	restartSignal?: AbortSignal;
};

type Job = {
	request: InferenceRequest;
	spec: ReasoningSpec<unknown, unknown>;
	inferenceRef: string;
	enqueuedAt: number;
	signal?: AbortSignal;
	resolve: (result: InferenceResult) => void;
	queueTimer?: NodeJS.Timeout;
	abortListener?: () => void;
	transportRetryUsed: boolean;
};

const errorResult = (
	job: Pick<Job, "request" | "spec" | "inferenceRef" | "enqueuedAt">,
	code: InferenceErrorCode,
	message: string,
	now: number,
	actualMode?: "fast" | "reason",
): InferenceResult => ({
	contractVersion: "1.0.0",
	inferenceRef: job.inferenceRef,
	specRef: job.spec.specRef,
	status: code === "CANCELLED" ? "CANCELLED" : "FAILED",
	requestedMode: job.request.mode,
	...(actualMode ? { actualMode } : {}),
	error: {
		code,
		message,
		retryable: code === "QUEUE_TIMEOUT" || code === "PROVIDER_ERROR",
	},
	metrics: {
		queueLatencyMs: Math.max(0, now - job.enqueuedAt),
		totalLatencyMs: Math.max(0, now - job.enqueuedAt),
	},
});

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export function renderPrompt(
	spec: ReasoningSpec<unknown, unknown>,
	payload: unknown,
): string {
	return stableJson({
		specRef: spec.specRef,
		instruction: spec.instruction,
		input: payload,
	});
}

export function healthFromRoles(roles: ModelRoles): ModelRuntimeStatus {
	const readyCount =
		Number(roles.fast.state === "READY") +
		Number(roles.reason.state === "READY");
	return {
		runtime:
			readyCount === 2
				? "READY"
				: readyCount === 1
					? "DEGRADED"
					: "UNAVAILABLE",
		lane: "IDLE",
		fast: roles.fast.state,
		reason: roles.reason.state,
		businessQueueDepth: 0,
		backgroundQueueDepth: 0,
	};
}

function roleForMode(
	mode: InferenceMode,
	spec: ReasoningSpec<unknown, unknown>,
): ModelRole {
	if (mode === "fast" || mode === "reason") return mode;
	return spec.routing?.startRole ?? "fast";
}

function parseProviderOutput(
	spec: ReasoningSpec<unknown, unknown>,
	content: string,
): unknown {
	return spec.outputSchema.parse(JSON.parse(content));
}

class RuntimeFailure extends Error {
	readonly code: InferenceErrorCode;
	constructor(code: InferenceErrorCode, message: string) {
		super(message);
		this.code = code;
	}
}

function providerFailure(error: unknown): {
	code: InferenceErrorCode;
	message: string;
} {
	if (error instanceof RuntimeFailure)
		return { code: error.code, message: error.message };
	if (
		error instanceof SyntaxError ||
		(error && typeof error === "object" && "issues" in error)
	) {
		return {
			code: "INVALID_OUTPUT",
			message: "provider output failed runtime validation",
		};
	}
	return {
		code: "PROVIDER_ERROR",
		message:
			error instanceof Error ? error.message : "provider inference failed",
	};
}

function definitelyUnstartedTransportFailure(error: unknown): boolean {
	return Boolean(
		error &&
			typeof error === "object" &&
			"notStarted" in error &&
			error.notStarted === true,
	);
}

export function createModelRuntime(options: RuntimeOptions) {
	const specs = new Map(options.specs.map((spec) => [spec.specRef, spec]));
	const queues: Record<"business" | "background", Job[]> = {
		business: [],
		background: [],
	};
	const now = options.now ?? Date.now;
	let active: Job | undefined;
	let activeRole: ModelRole | undefined;
	let activeController: AbortController | undefined;
	let lastSuccessAt: string | undefined;
	let lastFailureAt: string | undefined;
	let lastErrorCode: NonNullable<InferenceResult["error"]>["code"] | undefined;

	const removeQueued = (job: Job): boolean => {
		const queue = queues[job.request.priority];
		const index = queue.indexOf(job);
		if (index < 0) return false;
		queue.splice(index, 1);
		return true;
	};

	const finishFailure = (result: InferenceResult) => {
		lastFailureAt = new Date().toISOString();
		lastErrorCode = result.error?.code;
		return result;
	};

	const callProvider = async (
		job: Job,
		role: ModelRole,
		repair: boolean,
		signal: AbortSignal,
	) => {
		const profile = options.roles[role];
		if (profile.state !== "READY")
			throw new RuntimeFailure(
				"MODEL_UNAVAILABLE",
				`role ${role} is unavailable`,
			);
		if (
			job.spec.requiredModalities.includes("image") &&
			!profile.profile.inputModalities.includes("image")
		) {
			throw new RuntimeFailure(
				"CAPABILITY_UNSUPPORTED",
				`role ${role} does not support required image input`,
			);
		}
		if (
			job.request.images &&
			!profile.profile.inputModalities.includes("image")
		) {
			throw new RuntimeFailure(
				"CAPABILITY_UNSUPPORTED",
				`role ${role} cannot accept images`,
			);
		}
		const call = {
			role,
			request: job.request,
			spec: job.spec,
			prompt: renderPrompt(job.spec, job.request.payload),
			repair,
		};
		try {
			return await options.provider.infer(call, signal);
		} catch (error) {
			if (
				!job.transportRetryUsed &&
				definitelyUnstartedTransportFailure(error)
			) {
				job.transportRetryUsed = true;
				return options.provider.infer(call, signal);
			}
			throw error;
		}
	};

	const performRole = async (
		job: Job,
		role: ModelRole,
		signal: AbortSignal,
	) => {
		let response = await callProvider(job, role, false, signal);
		try {
			return parseProviderOutput(job.spec, response.content);
		} catch (firstError) {
			if (job.spec.repair !== "once") throw firstError;
			response = await callProvider(job, role, true, signal);
			return parseProviderOutput(job.spec, response.content);
		}
	};

	const run = async (job: Job) => {
		if (job.queueTimer) clearTimeout(job.queueTimer);
		if (job.abortListener && job.signal)
			job.signal.removeEventListener("abort", job.abortListener);
		active = job;
		const startedAt = now();
		const initialRole = roleForMode(job.request.mode, job.spec);
		activeRole = initialRole;
		const controller = new AbortController();
		activeController = controller;
		const cancel = () => controller.abort(job.signal?.reason);
		job.signal?.addEventListener("abort", cancel, { once: true });
		const timeoutMs = Math.min(
			job.request.timeoutMs ?? Number.POSITIVE_INFINITY,
			options.inferenceTimeoutMs ?? Number.POSITIVE_INFINITY,
		);
		let timer: NodeJS.Timeout | undefined;
		if (Number.isFinite(timeoutMs))
			timer = setTimeout(
				() => controller.abort("INFERENCE_TIMEOUT"),
				timeoutMs,
			);
		try {
			let data = await performRole(job, initialRole, controller.signal);
			let finalRole = initialRole;
			if (
				job.request.mode === "auto" &&
				initialRole === "fast" &&
				job.spec.routing?.allowReasonEscalation &&
				data &&
				typeof data === "object" &&
				"decision" in data &&
				job.spec.routing.escalateDecisions.includes(String(data.decision))
			) {
				finalRole = "reason";
				activeRole = finalRole;
				data = await performRole(job, finalRole, controller.signal);
			}
			if (controller.signal.aborted)
				throw new Error(String(controller.signal.reason ?? "CANCELLED"));
			lastSuccessAt = new Date().toISOString();
			const endedAt = now();
			job.resolve({
				contractVersion: "1.0.0",
				inferenceRef: job.inferenceRef,
				specRef: job.spec.specRef,
				status: "SUCCEEDED",
				requestedMode: job.request.mode,
				actualMode: finalRole,
				data,
				metrics: {
					queueLatencyMs: Math.max(0, startedAt - job.enqueuedAt),
					inferenceLatencyMs: Math.max(0, endedAt - startedAt),
					totalLatencyMs: Math.max(0, endedAt - job.enqueuedAt),
				},
			});
		} catch (error) {
			const aborted = controller.signal.aborted;
			const timeout = controller.signal.reason === "INFERENCE_TIMEOUT";
			const restarted = controller.signal.reason === "RESTART";
			const failure = aborted
				? {
						code: timeout
							? ("INFERENCE_TIMEOUT" as const)
							: restarted
								? ("INFERENCE_FAILED" as const)
								: ("CANCELLED" as const),
						message: timeout
							? "inference timeout"
							: restarted
								? "runtime restarted during inference"
								: "inference cancelled",
					}
				: providerFailure(error);
			const endedAt = now();
			const result = errorResult(
				job,
				failure.code,
				failure.message,
				endedAt,
				activeRole,
			);
			result.metrics = {
				queueLatencyMs: Math.max(0, startedAt - job.enqueuedAt),
				inferenceLatencyMs: Math.max(0, endedAt - startedAt),
				totalLatencyMs: Math.max(0, endedAt - job.enqueuedAt),
			};
			job.resolve(finishFailure(result));
		} finally {
			if (timer) clearTimeout(timer);
			job.signal?.removeEventListener("abort", cancel);
			active = undefined;
			activeRole = undefined;
			activeController = undefined;
			queueMicrotask(drain);
		}
	};

	const drain = () => {
		if (active) return;
		const job = queues.business.shift() ?? queues.background.shift();
		if (job) void run(job);
	};

	const infer = async (
		raw: unknown,
		optionsInput: { signal?: AbortSignal } = {},
	): Promise<InferenceResult> => {
		let request: InferenceRequest;
		try {
			request = inferenceRequestSchema.parse(raw);
		} catch {
			const timestamp = now();
			const placeholder = {
				request: { mode: "fast" } as InferenceRequest,
				spec: { specRef: "invalid" } as ReasoningSpec<unknown, unknown>,
				inferenceRef: randomUUID(),
				enqueuedAt: timestamp,
			};
			return finishFailure(
				errorResult(
					placeholder,
					"INVALID_REQUEST",
					"invalid inference request",
					timestamp,
				),
			);
		}
		const spec = specs.get(request.specRef);
		const inferenceRef = randomUUID();
		const enqueuedAt = now();
		if (!spec?.allowedModes.includes(request.mode)) {
			const placeholder = {
				request,
				spec:
					spec ??
					({ specRef: request.specRef } as ReasoningSpec<unknown, unknown>),
				inferenceRef,
				enqueuedAt,
			};
			return finishFailure(
				errorResult(
					placeholder,
					"INVALID_REQUEST",
					"unknown Spec or mode is not allowed",
					now(),
				),
			);
		}
		try {
			spec.inputSchema.parse(request.payload);
		} catch {
			return finishFailure(
				errorResult(
					{ request, spec, inferenceRef, enqueuedAt },
					"INVALID_REQUEST",
					"payload failed Spec validation",
					now(),
				),
			);
		}
		if (
			spec.maxContextBytes &&
			Buffer.byteLength(stableJson(request.payload)) > spec.maxContextBytes
		) {
			return finishFailure(
				errorResult(
					{ request, spec, inferenceRef, enqueuedAt },
					"CONTEXT_TOO_LARGE",
					"payload exceeds Spec context limit",
					now(),
				),
			);
		}
		return new Promise<InferenceResult>((resolve) => {
			const job: Job = {
				request,
				spec,
				inferenceRef,
				enqueuedAt,
				resolve,
				transportRetryUsed: false,
				...(optionsInput.signal ? { signal: optionsInput.signal } : {}),
			};
			const queueTimeoutMs = Math.min(
				request.timeoutMs ?? Number.POSITIVE_INFINITY,
				options.queueTimeoutMs ?? Number.POSITIVE_INFINITY,
			);
			if (Number.isFinite(queueTimeoutMs)) {
				job.queueTimer = setTimeout(() => {
					if (removeQueued(job))
						resolve(
							finishFailure(
								errorResult(job, "QUEUE_TIMEOUT", "queue timeout", now()),
							),
						);
				}, queueTimeoutMs);
			}
			if (job.signal) {
				job.abortListener = () => {
					if (removeQueued(job)) {
						if (job.queueTimer) clearTimeout(job.queueTimer);
						resolve(
							finishFailure(
								errorResult(
									job,
									"CANCELLED",
									"queued inference cancelled",
									now(),
								),
							),
						);
					}
				};
				job.signal.addEventListener("abort", job.abortListener, { once: true });
			}
			queues[request.priority].push(job);
			queueMicrotask(drain);
		});
	};

	const getRuntimeStatus = (): ModelRuntimeStatus => {
		const base = healthFromRoles(options.roles);
		return {
			...base,
			lane: active ? "BUSY" : "IDLE",
			...(active
				? { activeInferenceRef: active.inferenceRef, activeRole }
				: {}),
			businessQueueDepth: queues.business.length,
			backgroundQueueDepth: queues.background.length,
			...(lastSuccessAt ? { lastSuccessAt } : {}),
			...(lastFailureAt ? { lastFailureAt } : {}),
			...(lastErrorCode ? { lastErrorCode } : {}),
		};
	};

	options.restartSignal?.addEventListener(
		"abort",
		() => {
			for (const priority of ["business", "background"] as const) {
				for (const job of queues[priority].splice(0)) {
					if (job.queueTimer) clearTimeout(job.queueTimer);
					job.resolve(
						finishFailure(
							errorResult(
								job,
								"INFERENCE_FAILED",
								"runtime restarted before inference",
								now(),
							),
						),
					);
				}
			}
			activeController?.abort("RESTART");
		},
		{ once: true },
	);

	return Object.freeze({ infer, getRuntimeStatus });
}
