import {
	browserCapabilityIds,
	type ExecuteCapabilityRequest,
	type ExecutorPrecondition,
	executeCapabilityRequestSchema,
} from "@tomflow/proflow-execution-contracts";
import { executeBrowserPrimitive } from "./browser-primitive-executor.ts";
import { createBrowserReconciliation } from "./browser-reconciliation.ts";
import { createBrowserSessionState } from "./browser-session-state.ts";
import { createWorkerCarrierTarget } from "./worker-carrier-target.ts";
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
	const sessions = createBrowserSessionState(context);
	const restoreWorker = createWorkerCarrierTarget({
		task: options.task,
		browser: options.browser,
		matchingTab: sessions.matchingTab,
		registerContentSession: sessions.registerContentSession,
		parseCarrierIdentity: context.parseCarrierIdentity,
	});
	const recovery = createBrowserReconciliation(context, options.task, sessions);

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
		const workerResult = await executeWorkerCarrier(context, raw, request, {
			task: options.task,
			agent: options.agent,
			restoreWorker,
			registerContentSession: sessions.registerContentSession,
		});
		if (workerResult) return workerResult;
		return executeBrowserPrimitive(context, raw, request, restoreWorker);
	};

	return Object.freeze({
		extensionInstanceId: context.extensionInstanceId,
		parseCarrierIdentity: context.parseCarrierIdentity,
		registerContentSession: sessions.registerContentSession,
		isContentSessionCurrent: sessions.isContentSessionCurrent,
		classifyProgress: sessions.classifyProgress,
		async inspectScreenshot(
			tabId: number,
			observationContext: BrowserVisionObservationContext,
		): Promise<TypedVisionObservation> {
			const shot = await options.browser.screenshot(tabId);
			return context.visionObservation(shot, observationContext);
		},
		handlePermissionFallback: sessions.handlePermissionFallback,
		getSidePanelSnapshot: sessions.getSidePanelSnapshot,
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
