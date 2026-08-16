import type { BrowserActivityKind, BrowserPageState } from "./index.ts";

/**
 * Browser screenshot → Model Vision fallback port.
 *
 * Deterministic DOM/URL/runtime observation is primary. Only when the page
 * cannot be explained deterministically does the Carrier capture a screenshot
 * and ask an injected `BrowserVisionPort` for a spec-ized semantic observation
 * (see MODEL-DOC-03-05 §6: pageState / activityKind / confidence /
 * recommendedNext / reasonCode). The port returns an OBSERVED interpretation or
 * a typed DEFERRED fail-safe; it never decides Task/Execution/Approval truth
 * and never fabricates a page state.
 *
 * Raw screenshot bytes (dataUrl/base64) never enter structured logs: only the
 * bounded typed observation and image mimeType/size/hash are retained.
 */

export const visionMimeTypes = [
	"image/png",
	"image/jpeg",
	"image/webp",
] as const;
export type VisionMimeType = (typeof visionMimeTypes)[number];

export const visionRecommendedNext = [
	"NONE",
	"RECOVER",
	"WAIT",
	"REQUEST_HUMAN",
] as const;
export type VisionRecommendedNext = (typeof visionRecommendedNext)[number];

/** A runtime-validated screenshot payload ready to hand to a Vision port. */
export interface BrowserVisionImage {
	dataUrl: string;
	base64: string;
	mimeType: VisionMimeType;
	hash: string;
	sizeBytes: number;
}

/** Bounded deterministic facts that accompany the image for interpretation. */
export interface BrowserVisionObservationContext {
	targetRef: string;
	pageState: BrowserPageState;
	activityKind: BrowserActivityKind;
	observedAt: string;
}

export interface BrowserVisionObservation {
	status: "OBSERVED";
	observationRef: string;
	pageState: BrowserPageState;
	activityKind: BrowserActivityKind;
	confidence: number;
	recommendedNext: VisionRecommendedNext;
	reasonCode: string;
	rationale: string;
}

export type BrowserVisionDeferralReason =
	| "VISION_PORT_UNAVAILABLE"
	| "VISION_IMAGE_INVALID"
	| "VISION_INFERENCE_FAILED";

export interface BrowserVisionDeferral {
	status: "DEFERRED";
	reasonCode: BrowserVisionDeferralReason;
	message: string;
}

export type TypedVisionObservation =
	| BrowserVisionObservation
	| BrowserVisionDeferral;

export interface BrowserVisionPort {
	inspect(input: {
		image: BrowserVisionImage;
		observationContext: BrowserVisionObservationContext;
	}): Promise<TypedVisionObservation>;
}

export function deferVisionObservation(
	reasonCode: BrowserVisionDeferralReason,
	message: string,
): BrowserVisionDeferral {
	return Object.freeze({ status: "DEFERRED", reasonCode, message });
}

export const VISION_OBSERVATION_MIN_CONFIDENCE = 0.75;

/**
 * Deterministic Carrier policy for deciding whether a model observation is
 * strong enough to count as a verified Browser observation. A successful
 * model response is diagnostic evidence only; UNKNOWN, low-confidence, or
 * explicit human-escalation recommendations remain unverified.
 */
export function isVisionObservationVerified(
	value: TypedVisionObservation,
): value is BrowserVisionObservation {
	return (
		value.status === "OBSERVED" &&
		value.pageState !== "UNKNOWN" &&
		value.confidence >= VISION_OBSERVATION_MIN_CONFIDENCE &&
		value.recommendedNext !== "REQUEST_HUMAN"
	);
}

/**
 * Runtime-validate a raw screenshot capture into a trusted image payload before
 * it may reach a Vision port. Only supported image MIME types are accepted; the
 * MIME must match the dataUrl prefix, sizeBytes must be a positive integer, and
 * the hash must be present. The raw dataUrl never leaves this boundary.
 */
export function parseCapturedScreenshot(value: unknown): BrowserVisionImage {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new TypeError("screenshot capture must be an object");
	const record = value as Record<string, unknown>;
	const dataUrl = record.dataUrl;
	const mimeType = record.mimeType;
	const sizeBytes = record.sizeBytes;
	const hash = record.hash;
	if (typeof dataUrl !== "string" || dataUrl.length === 0)
		throw new TypeError("screenshot dataUrl must be a non-empty string");
	if (
		typeof mimeType !== "string" ||
		!(visionMimeTypes as readonly string[]).includes(mimeType)
	)
		throw new TypeError("screenshot mimeType is not a supported image type");
	if (
		typeof sizeBytes !== "number" ||
		!Number.isInteger(sizeBytes) ||
		sizeBytes <= 0
	)
		throw new TypeError("screenshot sizeBytes must be a positive integer");
	if (typeof hash !== "string" || hash.length === 0)
		throw new TypeError("screenshot hash must be a non-empty string");
	const prefix = `data:${mimeType};base64,`;
	if (!dataUrl.startsWith(prefix))
		throw new TypeError("screenshot dataUrl does not match its mimeType");
	const base64 = dataUrl.slice(prefix.length);
	if (base64.length === 0)
		throw new TypeError("screenshot dataUrl has no base64 payload");
	if (Buffer.from(base64, "base64").length === 0)
		throw new TypeError("screenshot image payload is empty");
	return Object.freeze({
		dataUrl,
		base64,
		mimeType: mimeType as VisionMimeType,
		hash,
		sizeBytes,
	});
}
