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
	createFileModelRuntimeLogger,
	fingerprint,
	type ModelRuntimeLogger,
} from "./logging.ts";
import {
	assertVerifiedModelRoles,
	type ModelProvider,
	type ModelRole,
	type ModelRoles,
	type ObservedRoleCapabilities,
	type ProviderCall,
	type ProviderCapabilityFact,
	type ProviderResponse,
	verifyProviderCapabilities,
	verifyRoleCapabilities,
} from "./provider.ts";

export type {
	ModelProvider,
	ModelRole,
	ModelRoles,
	ObservedRoleCapabilities,
	ProviderCall,
	ProviderCapabilityFact,
	ProviderResponse,
};
export {
	createFileModelRuntimeLogger,
	createReasoningSpec,
	verifyProviderCapabilities,
	verifyRoleCapabilities,
};

export const MODEL_RUNTIME_PUBLIC_API = ["infer", "getRuntimeStatus"] as const;

type RuntimeOptions = {
	specs: readonly ReasoningSpec<unknown, unknown>[];
	roles: ModelRoles;
	provider: ModelProvider;
	refreshRoles?: () => Promise<ModelRoles>;
	queueTimeoutMs?: number;
	inferenceTimeoutMs?: number;
	now?: () => number;
	restartSignal?: AbortSignal;
	logger?: ModelRuntimeLogger;
	capabilityVerificationMaxAgeMs?: number;
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
	providerRequestRefs: string[];
	finishReasons: string[];
	thinkingStatuses: string[];
	repairCount: number;
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
	const now = options.now ?? Date.now;
	assertVerifiedModelRoles(options.roles, {
		now: now(),
		maxAgeMs: options.capabilityVerificationMaxAgeMs ?? 300_000,
	});
	let roles = options.roles;
	for (const role of ["fast", "reason"] as const) {
		if (roles[role].profile.modelRef !== options.provider.modelRefs[role])
			throw new TypeError(
				`role ${role} profile modelRef does not match provider model binding`,
			);
	}
	const specs = new Map<string, ReasoningSpec<unknown, unknown>>();
	for (const spec of options.specs) {
		if (specs.has(spec.specRef))
			throw new TypeError(`duplicate ReasoningSpec identity: ${spec.specRef}`);
		specs.set(spec.specRef, spec);
	}
	const queues: Record<"business" | "background", Job[]> = {
		business: [],
		background: [],
	};
	let active: Job | undefined;
	let activeRole: ModelRole | undefined;
	let activeController: AbortController | undefined;
	let lastSuccessAt: string | undefined;
	let lastFailureAt: string | undefined;
	let lastErrorCode: NonNullable<InferenceResult["error"]>["code"] | undefined;
	const roleStates: Record<ModelRole, "READY" | "UNAVAILABLE"> = {
		fast: roles.fast.state,
		reason: roles.reason.state,
	};
	const verificationMaxAgeMs =
		options.capabilityVerificationMaxAgeMs ?? 300_000;
	const currentRoleState = (role: ModelRole): "READY" | "UNAVAILABLE" => {
		const verifiedAt = Date.parse(roles[role].verification.verifiedAt);
		const age = now() - verifiedAt;
		if (
			!Number.isFinite(verifiedAt) ||
			age < -30_000 ||
			age > verificationMaxAgeMs
		)
			return "UNAVAILABLE";
		return roleStates[role];
	};
	let refreshPromise: Promise<void> | undefined;
	const refreshRoleCapabilities = async (): Promise<void> => {
		if (!options.refreshRoles) return;
		refreshPromise ??= (async () => {
			const refreshed = await options.refreshRoles?.();
			if (!refreshed) return;
			assertVerifiedModelRoles(refreshed, {
				now: now(),
				maxAgeMs: verificationMaxAgeMs,
			});
			for (const role of ["fast", "reason"] as const) {
				if (
					refreshed[role].profile.modelRef !== options.provider.modelRefs[role]
				)
					throw new TypeError(
						`role ${role} refreshed profile does not match provider model binding`,
					);
			}
			roles = refreshed;
			roleStates.fast = refreshed.fast.state;
			roleStates.reason = refreshed.reason.state;
		})().finally(() => {
			refreshPromise = undefined;
		});
		await refreshPromise;
	};

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

	const logResult = async (
		job: Job,
		result: InferenceResult,
		event: "PRE_QUEUE_REJECTION" | "INFERENCE_RESULT" = "INFERENCE_RESULT",
	) => {
		if (!options.logger) return;
		const payload = stableJson(job.request.payload);
		await options.logger.log({
			timestamp: new Date().toISOString(),
			event,
			phase: event === "PRE_QUEUE_REJECTION" ? "VALIDATION" : "RESULT",
			inferenceRef: result.inferenceRef,
			specRef: result.specRef,
			callerRef: job.request.trace.callerRef,
			...(job.request.trace.correlationId
				? { correlationId: job.request.trace.correlationId }
				: {}),
			requestedMode: result.requestedMode,
			...(result.actualMode ? { actualMode: result.actualMode } : {}),
			status: result.status,
			...(result.error ? { errorCode: result.error.code } : {}),
			queueLatencyMs: result.metrics.queueLatencyMs,
			...(result.metrics.inferenceLatencyMs === undefined
				? {}
				: { inferenceLatencyMs: result.metrics.inferenceLatencyMs }),
			totalLatencyMs: result.metrics.totalLatencyMs,
			payloadBytes: Buffer.byteLength(payload),
			payloadFingerprint: fingerprint(payload),
			imageCount: job.request.images?.length ?? 0,
			images: (job.request.images ?? []).map((image) => ({
				mimeType: image.mimeType,
				bytes: Buffer.from(image.data, "base64").length,
				fingerprint: fingerprint(image.data),
			})),
			providerRequestRefs: job.providerRequestRefs,
			finishReasons: job.finishReasons,
			thinkingStatuses: job.thinkingStatuses,
			repairCount: job.repairCount,
		});
	};

	const settle = async (job: Job, result: InferenceResult) => {
		try {
			await logResult(job, result);
		} catch {
			const loggingFailure = errorResult(
				job,
				"INFERENCE_FAILED",
				"sanitized model runtime log could not be persisted",
				now(),
				result.actualMode,
			);
			job.resolve(finishFailure(loggingFailure));
			return;
		}
		job.resolve(result);
	};

	const rejectBeforeQueue = async (
		request: InferenceRequest,
		spec: ReasoningSpec<unknown, unknown>,
		inferenceRef: string,
		enqueuedAt: number,
		code: InferenceErrorCode,
		message: string,
	): Promise<InferenceResult> => {
		const job: Job = {
			request,
			spec,
			inferenceRef,
			enqueuedAt,
			resolve: () => undefined,
			transportRetryUsed: false,
			providerRequestRefs: [],
			finishReasons: [],
			thinkingStatuses: [],
			repairCount: 0,
		};
		const result = finishFailure(errorResult(job, code, message, now()));
		try {
			await logResult(job, result, "PRE_QUEUE_REJECTION");
			return result;
		} catch {
			return finishFailure(
				errorResult(
					job,
					"INFERENCE_FAILED",
					"sanitized model runtime rejection log could not be persisted",
					now(),
				),
			);
		}
	};

	const admissionFailure = (
		job: Pick<Job, "request" | "spec">,
		role: ModelRole,
	): RuntimeFailure | undefined => {
		const configuration = roles[role];
		if (currentRoleState(role) !== "READY")
			return new RuntimeFailure(
				"MODEL_UNAVAILABLE",
				`role ${role} is unavailable`,
			);
		const requiredReasoning = role === "fast" ? "no-thinking" : "thinking";
		if (!configuration.profile.reasoningModes.includes(requiredReasoning))
			return new RuntimeFailure(
				"CAPABILITY_UNSUPPORTED",
				`role ${role} does not support ${requiredReasoning}`,
			);
		if (!configuration.profile.inputModalities.includes("text"))
			return new RuntimeFailure(
				"CAPABILITY_UNSUPPORTED",
				`role ${role} does not support text input`,
			);
		const requiresImage = job.spec.requiredModalities.includes("image");
		const hasImage = Boolean(job.request.images?.length);
		if (requiresImage !== hasImage)
			return new RuntimeFailure(
				"CAPABILITY_UNSUPPORTED",
				requiresImage
					? "ReasoningSpec requires image input for this request"
					: "ReasoningSpec does not accept image input for this request",
			);
		if (hasImage && !configuration.profile.inputModalities.includes("image"))
			return new RuntimeFailure(
				"CAPABILITY_UNSUPPORTED",
				`role ${role} cannot accept images`,
			);
		if (configuration.profile.structuredOutput === "unsupported")
			return new RuntimeFailure(
				"CAPABILITY_UNSUPPORTED",
				`role ${role} does not support structured output`,
			);
		if (job.spec.maxOutputTokens > configuration.profile.maxOutputTokens)
			return new RuntimeFailure(
				"CAPABILITY_UNSUPPORTED",
				`ReasoningSpec output limit exceeds role ${role} capability`,
			);
		const contextBytes = Buffer.byteLength(
			renderPrompt(job.spec, job.request.payload),
		);
		if (contextBytes > configuration.profile.contextWindow)
			return new RuntimeFailure(
				"CAPABILITY_UNSUPPORTED",
				`request context exceeds role ${role} capability`,
			);
		return undefined;
	};

	const callProvider = async (
		job: Job,
		role: ModelRole,
		repair: boolean,
		signal: AbortSignal,
	) => {
		if (currentRoleState(role) !== "READY") {
			try {
				await refreshRoleCapabilities();
			} catch {
				roleStates[role] = "UNAVAILABLE";
			}
		}
		const profile = roles[role].profile;
		const rejected = admissionFailure(job, role);
		if (rejected) throw rejected;
		const call = {
			role,
			structuredOutput: profile.structuredOutput,
			request: job.request,
			spec: job.spec,
			prompt: renderPrompt(job.spec, job.request.payload),
			repair,
		};
		const invoke = async () => {
			const providerPromise = options.provider.infer(call, signal);
			const abortPromise = new Promise<never>((_resolve, reject) => {
				if (signal.aborted) {
					reject(new Error(String(signal.reason ?? "CANCELLED")));
					return;
				}
				signal.addEventListener(
					"abort",
					() => reject(new Error(String(signal.reason ?? "CANCELLED"))),
					{ once: true },
				);
			});
			const response = await Promise.race([providerPromise, abortPromise]);
			if (response.providerRequestRef)
				job.providerRequestRefs.push(response.providerRequestRef);
			if (response.finishReason) job.finishReasons.push(response.finishReason);
			if (response.thinkingStatus)
				job.thinkingStatuses.push(response.thinkingStatus);
			roleStates[role] = "READY";
			return response;
		};
		try {
			return await invoke();
		} catch (error) {
			if (
				!job.transportRetryUsed &&
				definitelyUnstartedTransportFailure(error)
			) {
				job.transportRetryUsed = true;
				return invoke();
			}
			if (!signal.aborted) roleStates[role] = "UNAVAILABLE";
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
			job.repairCount += 1;
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
			const result: InferenceResult = {
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
			};
			await settle(job, result);
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
			if (
				failure.code === "PROVIDER_ERROR" ||
				failure.code === "INVALID_OUTPUT" ||
				failure.code === "INFERENCE_TIMEOUT"
			)
				roleStates[activeRole ?? initialRole] = "UNAVAILABLE";
			await settle(job, finishFailure(result));
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
			return rejectBeforeQueue(
				{
					contractVersion: "1.0.0",
					specRef: "invalid",
					mode: "fast",
					priority: "business",
					trace: { callerRef: "unknown-boundary" },
					payload: null,
				},
				{ specRef: "invalid" } as ReasoningSpec<unknown, unknown>,
				randomUUID(),
				timestamp,
				"INVALID_REQUEST",
				"invalid inference request",
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
			return rejectBeforeQueue(
				request,
				placeholder.spec,
				inferenceRef,
				enqueuedAt,
				"INVALID_REQUEST",
				"unknown Spec or mode is not allowed",
			);
		}
		try {
			spec.inputSchema.parse(request.payload);
		} catch {
			return rejectBeforeQueue(
				request,
				spec,
				inferenceRef,
				enqueuedAt,
				"INVALID_REQUEST",
				"payload failed Spec validation",
			);
		}
		if (
			spec.maxContextBytes &&
			Buffer.byteLength(stableJson(request.payload)) > spec.maxContextBytes
		) {
			return rejectBeforeQueue(
				request,
				spec,
				inferenceRef,
				enqueuedAt,
				"CONTEXT_TOO_LARGE",
				"payload exceeds Spec context limit",
			);
		}
		// A signal that was already aborted before `infer()` was called never
		// re-dispatches its "abort" event, so it must be checked explicitly.
		// Fail fast here — before the job occupies the queue or the lane — and
		// preserve the RESTART vs caller-cancel typed distinction.
		if (optionsInput.signal?.aborted) {
			const restarted = optionsInput.signal.reason === "RESTART";
			return rejectBeforeQueue(
				request,
				spec,
				inferenceRef,
				enqueuedAt,
				restarted ? "INFERENCE_FAILED" : "CANCELLED",
				restarted
					? "runtime restarted before inference"
					: "inference cancelled",
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
				providerRequestRefs: [],
				finishReasons: [],
				thinkingStatuses: [],
				repairCount: 0,
				...(optionsInput.signal ? { signal: optionsInput.signal } : {}),
			};
			const queueTimeoutMs = Math.min(
				request.timeoutMs ?? Number.POSITIVE_INFINITY,
				options.queueTimeoutMs ?? Number.POSITIVE_INFINITY,
			);
			if (Number.isFinite(queueTimeoutMs)) {
				job.queueTimer = setTimeout(() => {
					if (removeQueued(job))
						void settle(
							job,
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
						const restarted = job.signal?.reason === "RESTART";
						void settle(
							job,
							finishFailure(
								errorResult(
									job,
									restarted ? "INFERENCE_FAILED" : "CANCELLED",
									restarted
										? "runtime restarted before inference"
										: "queued inference cancelled",
									now(),
								),
							),
						);
					}
				};
				job.signal.addEventListener("abort", job.abortListener, { once: true });
			}
			// Close the check→subscribe race: a signal that aborted after the
			// pre-enqueue check but before the listener was attached will not
			// re-dispatch "abort", so settle it here without occupying the lane.
			if (job.signal?.aborted) {
				if (job.queueTimer) clearTimeout(job.queueTimer);
				const restarted = job.signal.reason === "RESTART";
				void settle(
					job,
					finishFailure(
						errorResult(
							job,
							restarted ? "INFERENCE_FAILED" : "CANCELLED",
							restarted
								? "runtime restarted before inference"
								: "inference cancelled",
							now(),
						),
					),
				);
				return;
			}
			queues[request.priority].push(job);
			queueMicrotask(drain);
		});
	};

	const getRuntimeStatus = (): ModelRuntimeStatus => {
		const currentRoles = {
			...roles,
			fast: { ...roles.fast, state: currentRoleState("fast") },
			reason: { ...roles.reason, state: currentRoleState("reason") },
		} as ModelRoles;
		const base = healthFromRoles(currentRoles);
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
					void settle(
						job,
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

	return Object.freeze({
		infer,
		getRuntimeStatus,
		refreshCapabilities: refreshRoleCapabilities,
	});
}
