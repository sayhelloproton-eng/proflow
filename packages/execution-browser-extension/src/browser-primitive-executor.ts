import {
	type ExecuteCapabilityRequest,
	type ExecutionCapabilityResult,
} from "@tomflow/proflow-execution-contracts";
import type {
	ExecutionBrowserContext,
	ExecutorInvocation,
	ExecutorResult,
} from "./execution-browser-context.ts";
import { ExecutionBrowserError } from "./execution-browser-context.ts";
import { isVisionObservationVerified } from "./vision.ts";

export async function executeBrowserPrimitive(
	context: ExecutionBrowserContext,
	raw: ExecutorInvocation,
	request: ExecuteCapabilityRequest,
): Promise<ExecutorResult> {
	const target =
		"targetRef" in request.input ? request.input.targetRef : request.workerRef;
	if (!target)
		throw new ExecutionBrowserError(
			"PRECONDITION_FAILED",
			"BROWSER_TARGET_REQUIRED",
		);
	const numericTab = Number(target.replace(/^tab:/, ""));
	const observed = Number.isInteger(numericTab)
		? await context.options.browser.observe(numericTab)
		: request.roleRef && request.workerRef
			? await context.ensureRestored(
					request.taskId ?? "",
					request.roleRef,
					request.workerRef,
				)
			: null;
	if (!observed)
		throw new ExecutionBrowserError(
			"PRECONDITION_FAILED",
			"BROWSER_TARGET_NOT_FOUND",
		);

	if (request.capability === "browser.observe") {
		const needsVisionFallback =
			observed.pageState === "UNKNOWN" ||
			observed.activityKind === "RECOVERING";
		if (!needsVisionFallback)
			return context.result(
				{
					capability: "browser.observe",
					data: {
						targetRef: target,
						verified: true,
						observationRef: `observation:${context.idFactory()}`,
					},
				},
				observed,
				false,
			);

		const shot = await context.options.browser.screenshot(observed.tabId);
		const vision = await context.visionObservation(shot, {
			targetRef: target,
			pageState: observed.pageState,
			activityKind: observed.activityKind,
			observedAt: observed.observedAt,
		});
		const visionVerified = isVisionObservationVerified(vision);
		const observationRef =
			vision.status === "OBSERVED" ? vision.observationRef : shot.evidenceRef;
		return {
			...context.result(
				{
					capability: "browser.observe",
					data: {
						targetRef: target,
						verified: visionVerified,
						observationRef,
						visionFallback: "REAL_EXTERNAL_PENDING",
					},
				},
				observed,
				false,
			),
			evidence: [
				{
					kind: "browser",
					evidenceRef: shot.evidenceRef,
					targetRef: target,
					observationRef: shot.evidenceRef,
					verified: visionVerified,
				},
			],
			artifacts: [
				{
					ref: shot.evidenceRef,
					path: "",
					bytes: shot.sizeBytes,
					stream: "report",
					kind: "output",
					hash: shot.hash,
					mime: shot.mimeType,
					metadata: {
						source: "browser.observe.vision-fallback",
						trigger: {
							pageState: observed.pageState,
							activityKind: observed.activityKind,
						},
						vision,
					},
				},
			],
		};
	}

	if (request.capability === "browser.screenshot") {
		const shot = await context.options.browser.screenshot(observed.tabId);
		const vision = await context.visionObservation(shot, {
			targetRef: target,
			pageState: observed.pageState,
			activityKind: observed.activityKind,
			observedAt: observed.observedAt,
		});
		return {
			...context.result(
				{
					capability: "browser.screenshot",
					data: {
						targetRef: target,
						verified: true,
						observationRef: shot.evidenceRef,
						mimeType: shot.mimeType,
						sizeBytes: shot.sizeBytes,
						hash: shot.hash,
						visionFallback: "REAL_EXTERNAL_PENDING",
					},
				},
				observed,
				false,
			),
			evidence: [
				{
					kind: "browser",
					evidenceRef: shot.evidenceRef,
					targetRef: target,
					observationRef: shot.evidenceRef,
					verified: true,
				},
			],
			artifacts: [
				{
					ref: shot.evidenceRef,
					path: "",
					bytes: shot.sizeBytes,
					stream: "report",
					kind: "output",
					hash: shot.hash,
					mime: shot.mimeType,
					metadata: {
						source: "browser.screenshot",
						vision,
					},
				},
			],
		};
	}

	if (request.capability === "browser.verify") {
		const verified = await context.options.browser.hasMessage(
			observed.tabId,
			request.input.expectedFingerprint,
		);
		return context.result(
			{
				capability: "browser.verify",
				data: {
					targetRef: target,
					verified,
					observationRef: `observation:${context.idFactory()}`,
				},
			},
			observed,
			false,
		);
	}

	const perform = context.options.browser.perform;
	if (!perform)
		throw new ExecutionBrowserError(
			"EXECUTOR_UNAVAILABLE",
			"BROWSER_PRIMITIVE_UNAVAILABLE",
		);
	return context.serializeWrite(async () => {
		const precondition = await context.effectStarted(raw);
		const after = await perform(request, observed.tabId);
		if (!after)
			throw new ExecutionBrowserError(
				"UNKNOWN_SIDE_EFFECT",
				"BROWSER_RESULT_MISSING",
			);
		return context.result(
			{
				capability: request.capability,
				data: {
					targetRef: target,
					verified: true,
					observationRef: `observation:${context.idFactory()}`,
				},
			} as ExecutionCapabilityResult,
			after,
			true,
			precondition,
		);
	});
}
