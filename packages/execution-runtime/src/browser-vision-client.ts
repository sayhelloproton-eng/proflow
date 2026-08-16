import {
	type BrowserVisionObservation,
	type BrowserVisionPort,
	deferVisionObservation,
} from "@tomflow/proflow-execution-browser-extension";
import {
	browserPageVisionObservationSchema,
	inferenceResultSchema,
} from "@tomflow/proflow-model-contracts";

const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const browserPageVisionSpecRef = "browser.page-vision.v1";

/**
 * Typed Browser Vision inference client. It talks to the same Model Runtime
 * `infer` boundary as the command-risk decision client, but for the
 * spec-ized `browser.page-vision.v1` REASON-only image observation. A Vision
 * call returns an OBSERVED interpretation or a typed DEFERRED fail-safe; it
 * never fabricates page state and never decides Task/Execution/Approval truth.
 */
export function createExecutionBrowserVisionClient(config: {
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

	const port: BrowserVisionPort = {
		async inspect({ image, observationContext }) {
			try {
				const response = await fetch(`${endpoint.origin}/infer`, {
					method: "POST",
					headers: {
						...authorizationHeaders,
						"content-type": "application/json",
					},
					body: JSON.stringify({
						contractVersion: "1.0.0",
						specRef: browserPageVisionSpecRef,
						mode: "reason",
						priority: "business",
						trace: { callerRef: "execution-runtime:browser-vision" },
						payload: {
							targetRef: observationContext.targetRef,
							pageState: observationContext.pageState,
							activityKind: observationContext.activityKind,
							observedAt: observationContext.observedAt,
						},
						images: [{ mimeType: image.mimeType, data: image.base64 }],
						timeoutMs,
					}),
					signal: AbortSignal.timeout(timeoutMs + 1_000),
				});
				if (!response.ok)
					throw new Error(`MODEL_INFER_HTTP_${response.status}`);
				const result = inferenceResultSchema.parse(await response.json());
				if (
					result.specRef !== browserPageVisionSpecRef ||
					result.requestedMode !== "reason"
				)
					throw new Error("MODEL_INFERENCE_PROTOCOL_MISMATCH");
				if (result.status !== "SUCCEEDED")
					throw new Error(result.error?.code ?? result.status);
				const data = browserPageVisionObservationSchema.parse(result.data);
				const observation: BrowserVisionObservation = {
					status: "OBSERVED",
					observationRef: result.inferenceRef,
					pageState: data.pageState,
					activityKind: data.activityKind,
					confidence: data.confidence,
					recommendedNext: data.recommendedNext,
					reasonCode: data.reasonCode,
					rationale: data.rationale,
				};
				return Object.freeze(observation);
			} catch (error) {
				return deferVisionObservation(
					"VISION_INFERENCE_FAILED",
					error instanceof Error ? error.message : "vision inference failed",
				);
			}
		},
	};

	return Object.freeze({ port });
}
