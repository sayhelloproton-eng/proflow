import type { ExecuteCapabilityRequest } from "@tomflow/proflow-execution-contracts";
import {
	type InferenceResult,
	inferenceResultSchema,
	modelRuntimeStatusSchema,
} from "@tomflow/proflow-model-contracts";
import type { ExecutionModelDecisionPort } from "./index.ts";

const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const sensitiveKey =
	/(?:authorization|bearer|api[_-]?key|token|password|cookie|private[_-]?key|secret|body|content|env|value)/i;

function boundedString(value: string, max = 600): string {
	return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function sanitizeUrl(value: string): string {
	try {
		const url = new URL(value);
		url.username = "";
		url.password = "";
		url.search = "";
		url.hash = "";
		return boundedString(url.toString());
	} catch {
		return boundedString(value);
	}
}

function sanitizeArgumentString(value: string): {
	value: string;
	redactNext: boolean;
} {
	if (/^(?:https?:)?\/\//i.test(value))
		return { value: sanitizeUrl(value), redactNext: false };

	const assignment = value.match(/^([^=:\s]+)([=:])(.*)$/);
	if (assignment) {
		const [, name, separator] = assignment;
		const normalizedName = name?.replace(/^-+/, "") ?? "";
		if (sensitiveKey.test(normalizedName))
			return {
				value: `${name}${separator}[REDACTED]`,
				redactNext: false,
			};
	}

	const normalizedFlag = value.replace(/^-+/, "");
	if (value.startsWith("-") && sensitiveKey.test(normalizedFlag))
		return { value: boundedString(value, 240), redactNext: true };

	if (/^bearer\s+/i.test(value))
		return { value: "Bearer [REDACTED]", redactNext: false };

	return { value: boundedString(value, 240), redactNext: false };
}

function sanitizeArgumentArray(
	raw: unknown[],
): Array<string | number | boolean | null> {
	let redactNext = false;
	return raw.slice(0, 24).map((item) => {
		if (redactNext) {
			redactNext = false;
			return "[REDACTED]";
		}
		if (item === null || typeof item === "number" || typeof item === "boolean")
			return item;
		if (typeof item !== "string") return "[OBJECT]";
		const sanitized = sanitizeArgumentString(item);
		redactNext = sanitized.redactNext;
		return sanitized.value;
	});
}

function flattenOperation(
	input: Record<string, unknown>,
	budgetBytes: number,
): Record<
	string,
	string | number | boolean | null | Array<string | number | boolean | null>
> {
	const output: Record<
		string,
		string | number | boolean | null | Array<string | number | boolean | null>
	> = {};
	let fields = 0;
	let truncated = false;
	const fits = (candidate: typeof output) =>
		Buffer.byteLength(JSON.stringify(candidate)) <= budgetBytes;
	for (const [key, raw] of Object.entries(input)) {
		if (fields >= 96) {
			truncated = true;
			break;
		}
		let value:
			| string
			| number
			| boolean
			| null
			| Array<string | number | boolean | null>;
		if (sensitiveKey.test(key)) value = "[REDACTED]";
		else if (
			raw === null ||
			typeof raw === "number" ||
			typeof raw === "boolean"
		)
			value = raw;
		else if (typeof raw === "string")
			value = /^(?:https?:)?\/\//i.test(raw)
				? sanitizeUrl(raw)
				: boundedString(raw);
		else if (Array.isArray(raw)) {
			value = sanitizeArgumentArray(raw);
			if (raw.length > 24) truncated = true;
		} else value = "[OBJECT]";
		const candidate = { ...output, [key]: value };
		if (!fits(candidate)) {
			truncated = true;
			break;
		}
		output[key] = value;
		fields += 1;
	}
	if (truncated && fits({ ...output, _truncated: true }))
		output._truncated = true;
	return output;
}

function commandRiskPayload(
	request: ExecuteCapabilityRequest,
	inputFingerprint: string,
	budgetBytes = 6_000,
) {
	return {
		capability: request.capability,
		inputFingerprint,
		callerRef: request.callerRef,
		...(request.taskId ? { taskId: request.taskId } : {}),
		...(request.nodeId ? { nodeId: request.nodeId } : {}),
		...(request.roleRef ? { roleRef: request.roleRef } : {}),
		...(request.workerRef ? { workerRef: request.workerRef } : {}),
		...(request.projectRoot
			? { projectRoot: boundedString(request.projectRoot, 1_000) }
			: {}),
		operation: flattenOperation(
			request.input as Record<string, unknown>,
			budgetBytes,
		),
	};
}

function outputData(value: unknown) {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new TypeError("command-risk result data must be an object");
	const record = value as Record<string, unknown>;
	if (!new Set(["ALLOW", "DENY", "ESCALATE"]).has(String(record.decision)))
		throw new TypeError("command-risk decision is invalid");
	if (typeof record.rationale !== "string" || record.rationale.length === 0)
		throw new TypeError("command-risk rationale is required");
	return {
		decision: record.decision as "ALLOW" | "DENY" | "ESCALATE",
		rationale: record.rationale,
	};
}

export function createExecutionModelDecisionClient(config: {
	endpoint: string;
	timeoutMs?: number;
	credential?: string;
}) {
	const endpoint = new URL(config.endpoint);
	if (
		endpoint.protocol !== "http:" ||
		!loopbackHosts.has(endpoint.hostname) ||
		endpoint.pathname !== "/" ||
		endpoint.search ||
		endpoint.hash
	)
		throw new TypeError("modelDecision.endpoint must be loopback HTTP root");
	if (config.credential && config.credential.length < 32)
		throw new TypeError(
			"modelDecision credential must contain at least 32 characters",
		);
	const timeoutMs = config.timeoutMs ?? 12_000;
	const authorizationHeaders = config.credential
		? { authorization: `Bearer ${config.credential}` }
		: {};
	let ready = false;
	const status = async () => {
		const response = await fetch(`${endpoint.origin}/status`, {
			headers: authorizationHeaders,
			signal: AbortSignal.timeout(Math.min(timeoutMs, 3_000)),
		});
		if (!response.ok) throw new Error(`MODEL_STATUS_HTTP_${response.status}`);
		return modelRuntimeStatusSchema.parse(await response.json());
	};
	const probe = async () => {
		try {
			const current = await status();
			ready =
				current.runtime !== "UNAVAILABLE" &&
				current.fast === "READY" &&
				current.reason === "READY";
		} catch {
			ready = false;
		}
		return ready;
	};
	const infer = async (
		request: ExecuteCapabilityRequest,
		context?: { executionRef?: string; inputFingerprint?: string },
		compact = false,
	): Promise<InferenceResult> => {
		const payload = commandRiskPayload(
			request,
			context?.inputFingerprint ?? "sha256:unknown",
			compact ? 1_800 : 6_000,
		);
		const response = await fetch(`${endpoint.origin}/infer`, {
			method: "POST",
			headers: {
				...authorizationHeaders,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				contractVersion: "1.0.0",
				specRef: "execution.command-risk.v1",
				mode: "auto",
				priority: "business",
				trace: {
					callerRef: "execution-runtime:model-decision",
					...(request.correlationId
						? { correlationId: request.correlationId }
						: {}),
					...(request.taskId ? { taskId: request.taskId } : {}),
					...(request.nodeId ? { nodeId: request.nodeId } : {}),
					...(context?.executionRef
						? { executionRef: context.executionRef }
						: {}),
				},
				payload,
				timeoutMs,
			}),
			signal: AbortSignal.timeout(timeoutMs + 1_000),
		});
		if (!response.ok) {
			ready = false;
			throw new Error(`MODEL_INFER_HTTP_${response.status}`);
		}
		const result: InferenceResult = inferenceResultSchema.parse(
			await response.json(),
		);
		if (
			result.specRef !== "execution.command-risk.v1" ||
			result.requestedMode !== "auto"
		) {
			ready = false;
			throw new Error("MODEL_INFERENCE_PROTOCOL_MISMATCH");
		}
		return result;
	};
	const port: ExecutionModelDecisionPort = {
		async decide(request, context) {
			if (!(await probe()))
				throw new Error(
					"DECISION_UNRESOLVED: model decision roles are unavailable",
				);
			let result: InferenceResult;
			try {
				result = await infer(request, context, false);
				if (
					result.status !== "SUCCEEDED" &&
					result.error?.code === "CONTEXT_TOO_LARGE"
				)
					result = await infer(request, context, true);
			} catch (error) {
				throw new Error(
					`DECISION_UNRESOLVED: ${error instanceof Error ? error.message : "model inference failed"}`,
				);
			}
			if (result.status !== "SUCCEEDED") {
				if (result.error?.code !== "CONTEXT_TOO_LARGE") ready = false;
				throw new Error(
					`DECISION_UNRESOLVED: ${result.error?.code ?? result.status}`,
				);
			}
			const data = outputData(result.data);
			if (data.decision === "DENY")
				return {
					decision: "DENY",
					decisionPath: result.actualMode ?? "fast",
					reason: data.rationale,
				};
			if (data.decision === "ESCALATE")
				return {
					decision: "ALLOW",
					decisionPath: result.actualMode ?? "reason",
					approvalRequired: true,
					reason: data.rationale,
				};
			return {
				decision: "ALLOW",
				decisionPath: result.actualMode ?? "fast",
				approvalRequired: false,
				reason: data.rationale,
			};
		},
	};
	return Object.freeze({ port, probe, readiness: () => ready });
}
