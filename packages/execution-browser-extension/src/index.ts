import {
	browserCapabilityIds,
	type ExecuteCapabilityRequest,
	type ExecutorPrecondition,
	executeCapabilityRequestSchema,
} from "@tomflow/proflow-execution-contracts";
import { executeBrowserPrimitive } from "./browser-primitive-executor.ts";
import { createBrowserReconciliation } from "./browser-reconciliation.ts";
import type { BrowserPageState } from "./browser-reality.ts";
import {
	createExecutionBrowserContext,
	ExecutionBrowserError,
	type ExecutionBrowserOptions,
} from "./execution-browser-context.ts";
import { executeWorkerCarrier } from "./worker-carrier-executor.ts";
import type {
	BrowserVisionObservationContext,
	TypedVisionObservation,
} from "./vision.ts";

export type { BrowserRealityBridgeOptions } from "./bridge.ts";
export {
	BrowserRealityBridgeError,
	createBrowserRealityBridgeServer,
} from "./bridge.ts";
export type {
	BrowserActivityKind,
	BrowserPageObservation,
	BrowserPageState,
	BrowserRealityPort,
	BrowserWakeGuardInput,
} from "./browser-reality.ts";
export {
	type CollaborationCarrierAgentPort,
	type CollaborationCarrierExecutionPort,
	type CollaborationCarrierOutcome,
	type CollaborationCarrierTaskPort,
	createCollaborationCarrierApplication,
	type PendingCollaborationCarrierMessage,
} from "./collaboration-carrier.ts";
export type {
	AgentDeliveryPort,
	ExecutionBrowserOptions,
	TaskBrowserPort,
} from "./execution-browser-context.ts";
export { ExecutionBrowserError } from "./execution-browser-context.ts";
export {
	createSystemObserver,
	type SystemObserverAssessment,
	type SystemObserverPriority,
	type SystemObserverReasonFailure,
	type SystemObserverReasonRequest,
	type SystemObserverReasonResult,
	type SystemObserverSnapshotPort,
	type SystemObserverView,
} from "./system-observer.ts";
export type {
	BrowserVisionDeferral,
	BrowserVisionDeferralReason,
	BrowserVisionImage,
	BrowserVisionObservation,
	BrowserVisionObservationContext,
	BrowserVisionPort,
	TypedVisionObservation,
	VisionMimeType,
	VisionRecommendedNext,
} from "./vision.ts";
export {
	deferVisionObservation,
	isVisionObservationVerified,
	parseCapturedScreenshot,
	VISION_OBSERVATION_MIN_CONFIDENCE,
	visionMimeTypes,
	visionRecommendedNext,
} from "./vision.ts";

const browserCapabilities = new Set<string>(browserCapabilityIds);

export function createExecutionBrowserExtension(
	options: ExecutionBrowserOptions,
) {
	const context = createExecutionBrowserContext(options);
	const recovery = createBrowserReconciliation(context);

	const execute = async (
		raw: Parameters<
			import("@tomflow/proflow-execution-contracts").ExecutionExecutorPort["execute"]
		>[0],
	) => {
		context.assertNotAborted(raw);
		const request = executeCapabilityRequestSchema.parse(raw.request);
		if (!browserCapabilities.has(request.capability))
			throw new ExecutionBrowserError(
				"EXECUTOR_UNAVAILABLE",
				"BROWSER_CAPABILITY_REQUIRED",
			);
		const workerResult = await executeWorkerCarrier(context, raw, request);
		if (workerResult) return workerResult;
		return executeBrowserPrimitive(context, raw, request);
	};

	return Object.freeze({
		extensionInstanceId: context.extensionInstanceId,
		parseCarrierIdentity: context.parseCarrierIdentity,
		registerContentSession: context.registerContentSession,
		isContentSessionCurrent(tabId: number, contentInstanceId: string) {
			return context.sessions.get(tabId)?.contentInstanceId === contentInstanceId;
		},
		classifyProgress(input: {
			pageState: BrowserPageState;
			nodeInProgress: boolean;
			millisecondsWithoutProgress: number;
			legitimateWait: boolean;
		}) {
			if (input.legitimateWait) return "EXPECTED_WAIT" as const;
			if (input.pageState === "IDLE" && input.nodeInProgress)
				return "PROGRESS_GAP" as const;
			if (
				input.pageState === "BUSY" &&
				input.millisecondsWithoutProgress > 60_000
			)
				return "RUNTIME_STALL" as const;
			return "NORMAL" as const;
		},
		async inspectScreenshot(
			tabId: number,
			observationContext: BrowserVisionObservationContext,
		): Promise<TypedVisionObservation> {
			const shot = await options.browser.screenshot(tabId);
			return context.visionObservation(shot, observationContext);
		},
		async handlePermissionFallback(tabId: number, continuationRef: string) {
			const observed = await options.browser.observe(tabId);
			const shot = await options.browser.screenshot(tabId);
			const identity = context.parseCarrierIdentity(observed.url);
			if (identity.workerRef) {
				const key = `${identity.roleRef}:${identity.workerRef}`;
				const lane = context.lanes.get(key);
				if (lane)
					context.lanes.set(key, {
						...lane,
						pageState: "BLOCKED",
						activityKind: "WAITING_HUMAN",
						continuationRef,
					});
			}
			return {
				status: "WAITING_HUMAN" as const,
				continuationRef,
				evidenceRef: shot.evidenceRef,
			};
		},
		getSidePanelSnapshot() {
			const snapshot = {
				extensionInstanceId: context.extensionInstanceId,
				observedAt: context.now().toISOString(),
				sessions: [...context.sessions.values()].map((item) => ({
					tabId: item.tabId,
					windowId: item.windowId,
					url: item.url,
					contentInstanceId: item.contentInstanceId,
					pageState: item.pageState,
					activityKind: item.activityKind,
				})),
				lanes: [...context.lanes.values()].map((item) => ({ ...item })),
			};
			Object.freeze(snapshot.sessions);
			Object.freeze(snapshot.lanes);
			return Object.freeze(snapshot);
		},
		execute,
		observePrecondition: async (
			request: ExecuteCapabilityRequest,
		): Promise<ExecutorPrecondition | undefined> =>
			context.browserPrecondition(request),
		reconcile: recovery.reconcile,
		async readArtifact() {
			throw new ExecutionBrowserError(
				"EXECUTOR_UNAVAILABLE",
				"ARTIFACT_OWNED_BY_EXECUTION_RUNTIME",
			);
		},
		recoveryScan: recovery.recoveryScan,
	});
}
