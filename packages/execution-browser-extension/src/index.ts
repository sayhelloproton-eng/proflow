import { randomUUID } from "node:crypto";

import {
	type BrowserCapabilityId,
	browserCapabilityIds,
	type ExecuteCapabilityRequest,
	type ExecutionCapabilityResult,
	type ExecutionEvidence,
	type ExecutionExecutorPort,
	type ExecutorPrecondition,
	executeCapabilityRequestSchema,
} from "@tomflow/proflow-execution-contracts";
import type {
	BrowserVisionImage,
	BrowserVisionObservationContext,
	BrowserVisionPort,
	TypedVisionObservation,
} from "./vision.ts";
import {
	deferVisionObservation,
	isVisionObservationVerified,
	parseCapturedScreenshot,
} from "./vision.ts";

export type { BrowserRealityBridgeOptions } from "./bridge.ts";
export {
	BrowserRealityBridgeError,
	createBrowserRealityBridgeServer,
} from "./bridge.ts";
export {
	type CollaborationCarrierAgentPort,
	type CollaborationCarrierExecutionPort,
	type CollaborationCarrierOutcome,
	type CollaborationCarrierTaskPort,
	createCollaborationCarrierApplication,
	type PendingCollaborationCarrierMessage,
} from "./collaboration-carrier.ts";
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
export {
	createTaskObserver,
	type TaskDriveProjection,
	type TaskObserverAnomalySignal,
	type TaskObserverCarrierPort,
	type TaskObserverDecision,
	type TaskObserverDiagnosticAssessment,
	type TaskObserverDiagnosticFailure,
	type TaskObserverDiagnosticPort,
	type TaskObserverOwnerPort,
	type TaskObserverResumeSignal,
} from "./task-observer.ts";
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

export type BrowserPageState = "IDLE" | "BUSY" | "BLOCKED" | "UNKNOWN";
export type BrowserActivityKind =
	| "GENERATING"
	| "ACTION_PERMISSION"
	| "ACTION_RUNNING"
	| "WAITING_HUMAN"
	| "WAITING_PEER"
	| "RECOVERING"
	| null;

export interface BrowserPageObservation {
	tabId: number;
	windowId: number;
	url: string;
	contentInstanceId: string;
	pageState: BrowserPageState;
	activityKind: BrowserActivityKind;
	observedAt: string;
}

export interface BrowserRealityPort {
	listTabs(): Promise<BrowserPageObservation[]>;
	open(url: string): Promise<BrowserPageObservation>;
	observe(tabId: number): Promise<BrowserPageObservation>;
	submit(
		tabId: number,
		text: string,
		fingerprint: string,
	): Promise<BrowserPageObservation>;
	hasMessage(tabId: number, fingerprint: string): Promise<boolean>;
	screenshot(tabId: number): Promise<{
		evidenceRef: string;
		dataUrl: string;
		mimeType: string;
		sizeBytes: number;
		hash: string;
	}>;
	perform?(
		request: ExecuteCapabilityRequest,
		tabId: number,
	): Promise<BrowserPageObservation>;
}

export interface TaskBrowserPort {
	getWorkerBinding(
		taskId: string,
		roleRef: string,
	): Promise<{ workerRef: string; conversationLocator: string | null } | null>;
	bindWorker(input: {
		taskId: string;
		roleRef: string;
		workerRef: string;
		conversationLocator: string;
	}): Promise<void>;
}

export interface AgentDeliveryPort {
	getPendingMessage(messageRef: string): Promise<{
		messageId: string;
		threadId: string;
		taskId: string;
		kind: "QUESTION" | "REPLY";
		fromRoleRef: string;
		fromWorkerRef: string;
		targetRoleRef: string;
		targetWorkerRef: string;
		replyToMessageId: string | null;
		content: string;
		status: "PENDING";
	}>;
	reportPhysicalDelivery(
		messageRef: string,
		evidenceRef: string,
		executionRef: string,
	): Promise<void>;
}

export interface ExecutionBrowserOptions {
	browser: BrowserRealityPort;
	task: TaskBrowserPort;
	agent: AgentDeliveryPort;
	vision?: BrowserVisionPort;
	idFactory?: () => string;
	now?: () => Date;
}

type ExecutorInvocation = Parameters<ExecutionExecutorPort["execute"]>[0];
type ExecutorResult = Awaited<ReturnType<ExecutionExecutorPort["execute"]>>;
type Reconciliation = Awaited<ReturnType<ExecutionExecutorPort["reconcile"]>>;

export class ExecutionBrowserError extends Error {
	readonly code:
		| "PRECONDITION_FAILED"
		| "EXECUTOR_UNAVAILABLE"
		| "UNKNOWN_SIDE_EFFECT"
		| "CANCELLED";
	readonly retryable = false;
	constructor(code: ExecutionBrowserError["code"], message: string) {
		super(message);
		this.name = "ExecutionBrowserError";
		this.code = code;
	}
}

const browserCapabilities = new Set<string>(browserCapabilityIds);
const workerWakeTriggerTypes = new Set([
	"NODE_READY",
	"REOPEN",
	"EXECUTION_RESULT_READY",
	"PEER_REPLY_READY",
	"RECOVERY_RESUME",
]);

function parseCarrierIdentity(raw: string): {
	roleRef: string;
	workerRef: string | null;
} {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new ExecutionBrowserError(
			"PRECONDITION_FAILED",
			"CARRIER_URL_INVALID",
		);
	}
	if (url.protocol !== "https:" || url.hostname !== "chatgpt.com")
		throw new ExecutionBrowserError(
			"PRECONDITION_FAILED",
			"CARRIER_URL_INVALID",
		);
	const segments = url.pathname.split("/").filter(Boolean);
	if (segments[0] !== "g" || !segments[1]?.startsWith("g-"))
		throw new ExecutionBrowserError("PRECONDITION_FAILED", "ROLE_URL_INVALID");
	if (segments.length === 2) return { roleRef: segments[1], workerRef: null };
	if (
		segments[2] !== "c" ||
		!segments[3] ||
		segments[3].length > 512 ||
		!/^[A-Za-z0-9_-]+$/.test(segments[3]) ||
		segments.length !== 4
	)
		throw new ExecutionBrowserError(
			"PRECONDITION_FAILED",
			"WORKER_URL_INVALID",
		);
	return { roleRef: segments[1], workerRef: segments[3] };
}

function browserEvidence(
	idFactory: () => string,
	observation: BrowserPageObservation,
	verified: boolean,
): Extract<ExecutionEvidence, { kind: "browser" }> {
	return {
		kind: "browser",
		evidenceRef: `evidence:${idFactory()}`,
		targetRef: `tab:${observation.tabId}`,
		observationRef: `observation:${idFactory()}`,
		verified,
	};
}

export function createExecutionBrowserExtension(
	options: ExecutionBrowserOptions,
) {
	const idFactory = options.idFactory ?? randomUUID;
	const now = options.now ?? (() => new Date());
	const extensionInstanceId = `extension:${idFactory()}`;
	const sessions = new Map<number, BrowserPageObservation>();
	const lanes = new Map<
		string,
		{
			roleRef: string;
			workerRef: string;
			tabId: number;
			pageState: BrowserPageState;
			activityKind: BrowserActivityKind;
			currentExecutionRef: string | null;
			continuationRef: string | null;
			lastProgressAt: string;
		}
	>();
	let recoveryCompleted = false;
	let writeTail: Promise<void> = Promise.resolve();

	const serializeWrite = async <Value>(
		operation: () => Promise<Value>,
	): Promise<Value> => {
		let release!: () => void;
		const previous = writeTail;
		writeTail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			return await operation();
		} finally {
			release();
		}
	};

	const registerContentSession = (observation: BrowserPageObservation) => {
		const identity = parseCarrierIdentity(observation.url);
		sessions.set(observation.tabId, structuredClone(observation));
		if (identity.workerRef) {
			lanes.set(`${identity.roleRef}:${identity.workerRef}`, {
				roleRef: identity.roleRef,
				workerRef: identity.workerRef,
				tabId: observation.tabId,
				pageState: observation.pageState,
				activityKind: observation.activityKind,
				currentExecutionRef: null,
				continuationRef: null,
				lastProgressAt: observation.observedAt,
			});
		}
	};

	const matchingTab = async (roleRef: string, workerRef: string) => {
		for (const tab of await options.browser.listTabs()) {
			try {
				const identity = parseCarrierIdentity(tab.url);
				if (identity.roleRef === roleRef && identity.workerRef === workerRef) {
					registerContentSession(tab);
					return tab;
				}
			} catch {
				/* an unrelated tab is not a carrier identity */
			}
		}
		return null;
	};

	const ensureRestored = async (
		taskId: string,
		roleRef: string,
		workerRef: string,
		expectedConversationLocator?: string,
	) => {
		const bound = await options.task.getWorkerBinding(taskId, roleRef);
		if (!bound || bound.workerRef !== workerRef)
			throw new ExecutionBrowserError(
				"PRECONDITION_FAILED",
				"WORKER_BINDING_MISMATCH",
			);
		if (!bound.conversationLocator)
			throw new ExecutionBrowserError(
				"PRECONDITION_FAILED",
				"CONVERSATION_LOCATOR_REQUIRED",
			);
		if (
			expectedConversationLocator !== undefined &&
			expectedConversationLocator !== bound.conversationLocator
		)
			throw new ExecutionBrowserError(
				"PRECONDITION_FAILED",
				"CONVERSATION_LOCATOR_MISMATCH",
			);
		const existing = await matchingTab(roleRef, workerRef);
		if (existing?.url === bound.conversationLocator) return existing;
		const opened = await options.browser.open(bound.conversationLocator);
		const observed = await options.browser.observe(opened.tabId);
		const identity = parseCarrierIdentity(observed.url);
		if (identity.roleRef !== roleRef || identity.workerRef !== workerRef)
			throw new ExecutionBrowserError(
				"PRECONDITION_FAILED",
				"RESTORE_IDENTITY_MISMATCH",
			);
		if (observed.url !== bound.conversationLocator)
			throw new ExecutionBrowserError(
				"PRECONDITION_FAILED",
				"RESTORE_LOCATOR_MISMATCH",
			);
		registerContentSession(observed);
		return observed;
	};

	const browserPrecondition = (
		request: ExecuteCapabilityRequest,
	): Extract<ExecutorPrecondition, { kind: "browser" }> => {
		const precondition: Extract<ExecutorPrecondition, { kind: "browser" }> = {
			kind: "browser",
			capability: request.capability as BrowserCapabilityId,
			...(request.taskId ? { taskId: request.taskId } : {}),
			...(request.roleRef ? { roleRef: request.roleRef } : {}),
			...(request.workerRef ? { workerRef: request.workerRef } : {}),
		};
		if (request.capability === "worker.create")
			return {
				...precondition,
				roleRef: request.input.roleRef,
				roleUrl: request.input.roleUrl,
				fingerprint: request.input.bootstrapFingerprint,
			};
		if (request.capability === "worker.restore")
			return {
				...precondition,
				roleRef: request.input.roleRef,
				workerRef: request.input.workerRef,
				conversationUrl: request.input.conversationUrl,
			};
		if (request.capability === "worker.wake")
			return {
				...precondition,
				roleRef: request.input.roleRef,
				workerRef: request.input.workerRef,
				fingerprint: request.input.fingerprint,
			};
		if (request.capability === "collaboration.deliver")
			return {
				...precondition,
				roleRef: request.input.roleRef,
				workerRef: request.input.workerRef,
				fingerprint: request.input.contentFingerprint,
				messageRef: request.input.messageRef,
			};
		if ("targetRef" in request.input)
			precondition.targetRef = request.input.targetRef;
		if (request.capability === "browser.submit")
			precondition.fingerprint = request.input.fingerprint;
		if (request.capability === "browser.navigate")
			precondition.expectedUrl = request.input.url;
		return precondition;
	};

	const assertNotAborted = (invocation: ExecutorInvocation) => {
		if (invocation.signal?.aborted)
			throw new ExecutionBrowserError(
				"CANCELLED",
				"EXECUTION_ABORTED_BEFORE_BROWSER_EFFECT",
			);
	};

	const effectStarted = async (
		invocation: ExecutorInvocation,
	): Promise<Extract<ExecutorPrecondition, { kind: "browser" }>> => {
		assertNotAborted(invocation);
		const precondition = browserPrecondition(invocation.request);
		if (!invocation.onEffectStarted)
			throw new ExecutionBrowserError(
				"PRECONDITION_FAILED",
				"DURABLE_EFFECT_BOUNDARY_REQUIRED",
			);
		await invocation.onEffectStarted(precondition);
		assertNotAborted(invocation);
		return precondition;
	};

	const visionObservation = async (
		shot: Awaited<ReturnType<BrowserRealityPort["screenshot"]>>,
		observationContext: BrowserVisionObservationContext,
	): Promise<TypedVisionObservation> => {
		let image: BrowserVisionImage;
		try {
			image = parseCapturedScreenshot(shot);
		} catch (error) {
			return deferVisionObservation(
				"VISION_IMAGE_INVALID",
				error instanceof Error ? error.message : "screenshot image is invalid",
			);
		}
		if (!options.vision)
			return deferVisionObservation(
				"VISION_PORT_UNAVAILABLE",
				"no Browser Vision port is injected",
			);
		try {
			return await options.vision.inspect({ image, observationContext });
		} catch (error) {
			return deferVisionObservation(
				"VISION_INFERENCE_FAILED",
				error instanceof Error ? error.message : "vision inference failed",
			);
		}
	};

	const result = (
		capabilityResult: ExecutionCapabilityResult,
		observation: BrowserPageObservation,
		effectApplied: boolean,
		precondition?: Extract<ExecutorPrecondition, { kind: "browser" }>,
	): ExecutorResult => ({
		result: capabilityResult,
		evidence: [browserEvidence(idFactory, observation, true)],
		artifacts: [],
		precondition: precondition ?? {
			kind: "browser",
			capability: capabilityResult.capability as BrowserCapabilityId,
		},
		effectApplied,
		successful: true,
	});

	const execute = async (raw: ExecutorInvocation): Promise<ExecutorResult> => {
		assertNotAborted(raw);
		const request = executeCapabilityRequestSchema.parse(raw.request);
		if (!browserCapabilities.has(request.capability))
			throw new ExecutionBrowserError(
				"EXECUTOR_UNAVAILABLE",
				"BROWSER_CAPABILITY_REQUIRED",
			);
		if (
			!request.taskId &&
			[
				"worker.create",
				"worker.restore",
				"worker.wake",
				"collaboration.deliver",
			].includes(request.capability)
		)
			throw new ExecutionBrowserError(
				"PRECONDITION_FAILED",
				"TASK_ID_REQUIRED",
			);
		const taskId = request.taskId ?? "";

		if (request.capability === "worker.create")
			return serializeWrite(async () => {
				if (await options.task.getWorkerBinding(taskId, request.input.roleRef))
					throw new ExecutionBrowserError(
						"PRECONDITION_FAILED",
						"WORKER_ALREADY_BOUND",
					);
				const roleIdentity = parseCarrierIdentity(request.input.roleUrl);
				if (
					roleIdentity.roleRef !== request.input.roleRef ||
					roleIdentity.workerRef
				)
					throw new ExecutionBrowserError(
						"PRECONDITION_FAILED",
						"ROLE_URL_MISMATCH",
					);
				const precondition = await effectStarted(raw);
				const opened = await options.browser.open(request.input.roleUrl);
				await options.browser.submit(
					opened.tabId,
					`WORKER_BIND ${request.input.bootstrapFingerprint}`,
					request.input.bootstrapFingerprint,
				);
				const observed = await options.browser.observe(opened.tabId);
				const identity = parseCarrierIdentity(observed.url);
				if (identity.roleRef !== request.input.roleRef || !identity.workerRef)
					throw new ExecutionBrowserError(
						"UNKNOWN_SIDE_EFFECT",
						"CREATE_REALITY_UNCONFIRMED",
					);
				await options.task.bindWorker({
					taskId,
					roleRef: identity.roleRef,
					workerRef: identity.workerRef,
					conversationLocator: observed.url,
				});
				registerContentSession(observed);
				return result(
					{
						capability: "worker.create",
						data: {
							roleRef: identity.roleRef,
							workerRef: identity.workerRef,
							conversationUrl: observed.url,
							verified: true,
						},
					},
					observed,
					true,
					precondition,
				);
			});

		if (request.capability === "worker.restore") {
			const observed = await ensureRestored(
				taskId,
				request.input.roleRef,
				request.input.workerRef,
				request.input.conversationUrl,
			);
			return result(
				{
					capability: "worker.restore",
					data: {
						roleRef: request.input.roleRef,
						workerRef: request.input.workerRef,
						restored: true,
					},
				},
				observed,
				false,
			);
		}

		if (request.capability === "worker.wake")
			return serializeWrite(async () => {
				if (!workerWakeTriggerTypes.has(request.input.trigger))
					throw new ExecutionBrowserError(
						"PRECONDITION_FAILED",
						"WAKE_TRIGGER_TYPE_INVALID",
					);
				const observed = await ensureRestored(
					taskId,
					request.input.roleRef,
					request.input.workerRef,
				);
				if (observed.pageState === "BUSY" || observed.pageState === "BLOCKED")
					throw new ExecutionBrowserError(
						"PRECONDITION_FAILED",
						"PAGE_NOT_WRITABLE",
					);
				const precondition = await effectStarted(raw);
				const trigger = JSON.stringify({
					protocol: "proflow.agent.browser-trigger.v1",
					triggerRef: request.input.fingerprint,
					triggerType: request.input.trigger,
					taskId,
					nodeId: request.input.nodeId,
					runNo: request.input.runNo,
					roleRef: request.input.roleRef,
					workerRef: request.input.workerRef,
					occurredAt: now().toISOString(),
					fingerprint: request.input.fingerprint,
					payload: { trigger: request.input.trigger },
				});
				const after = await options.browser.submit(
					observed.tabId,
					trigger,
					request.input.fingerprint,
				);
				if (
					!(await options.browser.hasMessage(
						after.tabId,
						request.input.fingerprint,
					))
				)
					throw new ExecutionBrowserError(
						"UNKNOWN_SIDE_EFFECT",
						"WAKE_REALITY_UNCONFIRMED",
					);
				registerContentSession(after);
				return result(
					{
						capability: "worker.wake",
						data: {
							roleRef: request.input.roleRef,
							workerRef: request.input.workerRef,
							triggerFingerprint: request.input.fingerprint,
							delivered: true,
						},
					},
					after,
					true,
					precondition,
				);
			});

		if (request.capability === "collaboration.deliver")
			return serializeWrite(async () => {
				const message = await options.agent.getPendingMessage(
					request.input.messageRef,
				);
				if (
					message.messageId !== request.input.messageRef ||
					message.taskId !== taskId ||
					message.targetRoleRef !== request.input.roleRef ||
					message.targetWorkerRef !== request.input.workerRef ||
					message.status !== "PENDING"
				)
					throw new ExecutionBrowserError(
						"PRECONDITION_FAILED",
						"DELIVERY_OWNER_FACT_MISMATCH",
					);
				const observed = await ensureRestored(
					taskId,
					request.input.roleRef,
					request.input.workerRef,
				);
				const precondition = await effectStarted(raw);
				const trigger = JSON.stringify({
					protocol: "proflow.agent.browser-trigger.v1",
					triggerRef: message.messageId,
					triggerType:
						message.kind === "REPLY" ? "PEER_REPLY_READY" : "PEER_MESSAGE",
					taskId,
					roleRef: message.targetRoleRef,
					workerRef: message.targetWorkerRef,
					occurredAt: now().toISOString(),
					fingerprint: request.input.contentFingerprint,
					payload: { collaboration: message },
				});
				const after = await options.browser.submit(
					observed.tabId,
					trigger,
					request.input.contentFingerprint,
				);
				if (
					!(await options.browser.hasMessage(
						after.tabId,
						request.input.contentFingerprint,
					))
				)
					throw new ExecutionBrowserError(
						"UNKNOWN_SIDE_EFFECT",
						"DELIVERY_REALITY_UNCONFIRMED",
					);
				const evidence = browserEvidence(idFactory, after, true);
				return {
					...result(
						{
							capability: "collaboration.deliver",
							data: {
								messageRef: request.input.messageRef,
								delivered: true,
								evidenceRef: evidence.evidenceRef,
							},
						},
						after,
						true,
						precondition,
					),
					evidence: [evidence],
				};
			});

		const target =
			"targetRef" in request.input
				? request.input.targetRef
				: request.workerRef;
		if (!target)
			throw new ExecutionBrowserError(
				"PRECONDITION_FAILED",
				"BROWSER_TARGET_REQUIRED",
			);
		const numericTab = Number(target.replace(/^tab:/, ""));
		const observed = Number.isInteger(numericTab)
			? await options.browser.observe(numericTab)
			: request.roleRef && request.workerRef
				? await ensureRestored(taskId, request.roleRef, request.workerRef)
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
				return result(
					{
						capability: "browser.observe",
						data: {
							targetRef: target,
							verified: true,
							observationRef: `observation:${idFactory()}`,
						},
					},
					observed,
					false,
				);

			// Deterministic DOM/runtime observation is always primary. Only an
			// explicitly ambiguous/recovery state may escalate to screenshot Vision.
			// The typed Vision result remains bounded diagnostic evidence and never
			// mutates Task/Execution/Approval authority.
			const shot = await options.browser.screenshot(observed.tabId);
			const vision = await visionObservation(shot, {
				targetRef: target,
				pageState: observed.pageState,
				activityKind: observed.activityKind,
				observedAt: observed.observedAt,
			});
			const visionVerified = isVisionObservationVerified(vision);
			const observationRef =
				vision.status === "OBSERVED" ? vision.observationRef : shot.evidenceRef;
			return {
				...result(
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
			const shot = await options.browser.screenshot(observed.tabId);
			// The screenshot is the ambiguity/recovery fallback: hand the real
			// captured image bytes to the injected Vision port and retain only the
			// bounded typed observation. `visionFallback` stays REAL_EXTERNAL_PENDING
			// as the honest marker that the physical-phone Vision E2E is not wired;
			// the code wiring (capture → typed Vision port → typed observation) is
			// complete and recorded in the artifact metadata below.
			const vision = await visionObservation(shot, {
				targetRef: target,
				pageState: observed.pageState,
				activityKind: observed.activityKind,
				observedAt: observed.observedAt,
			});
			return {
				...result(
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
			const verified = await options.browser.hasMessage(
				observed.tabId,
				request.input.expectedFingerprint,
			);
			return result(
				{
					capability: "browser.verify",
					data: {
						targetRef: target,
						verified,
						observationRef: `observation:${idFactory()}`,
					},
				},
				observed,
				false,
			);
		}
		if (!options.browser.perform)
			throw new ExecutionBrowserError(
				"EXECUTOR_UNAVAILABLE",
				"BROWSER_PRIMITIVE_UNAVAILABLE",
			);
		return serializeWrite(async () => {
			const precondition = await effectStarted(raw);
			const after = await options.browser.perform?.(request, observed.tabId);
			if (!after)
				throw new ExecutionBrowserError(
					"UNKNOWN_SIDE_EFFECT",
					"BROWSER_RESULT_MISSING",
				);
			return result(
				{
					capability: request.capability,
					data: {
						targetRef: target,
						verified: true,
						observationRef: `observation:${idFactory()}`,
					},
				} as ExecutionCapabilityResult,
				after,
				true,
				precondition,
			);
		});
	};

	const reconcile = async (
		requestRaw: ExecuteCapabilityRequest,
		preconditionRaw: ExecutorPrecondition,
	): Promise<Reconciliation> => {
		const request = executeCapabilityRequestSchema.parse(requestRaw);
		if (
			preconditionRaw.kind !== "browser" ||
			preconditionRaw.capability !== request.capability
		)
			return { state: "UNKNOWN", evidence: [] };
		const precondition = preconditionRaw;

		const observeTarget = async (): Promise<BrowserPageObservation | null> => {
			if (precondition.roleRef && precondition.workerRef)
				return matchingTab(precondition.roleRef, precondition.workerRef);
			if (precondition.targetRef) {
				const numericTab = Number(precondition.targetRef.replace(/^tab:/, ""));
				if (Number.isInteger(numericTab)) {
					try {
						return await options.browser.observe(numericTab);
					} catch {
						return null;
					}
				}
			}
			return null;
		};

		if (request.capability === "worker.create") {
			const roleRef = precondition.roleRef;
			const taskId = precondition.taskId;
			if (!roleRef || !taskId || !precondition.fingerprint)
				return { state: "UNKNOWN", evidence: [] };

			const boundWorker = await options.task.getWorkerBinding(taskId, roleRef);
			if (boundWorker) {
				const observed = await matchingTab(roleRef, boundWorker.workerRef);
				if (!observed) return { state: "UNKNOWN", evidence: [] };
				if (
					!(await options.browser.hasMessage(
						observed.tabId,
						precondition.fingerprint,
					))
				)
					return { state: "UNKNOWN", evidence: [] };
				const evidence = browserEvidence(idFactory, observed, true);
				return {
					state: "APPLIED",
					evidence: [evidence],
					result: {
						capability: "worker.create",
						data: {
							roleRef,
							workerRef: boundWorker.workerRef,
							conversationUrl: observed.url,
							verified: true,
						},
					},
				};
			}

			const candidates: BrowserPageObservation[] = [];
			for (const tab of await options.browser.listTabs()) {
				try {
					const identity = parseCarrierIdentity(tab.url);
					if (
						identity.roleRef === roleRef &&
						identity.workerRef !== null &&
						(await options.browser.hasMessage(
							tab.tabId,
							precondition.fingerprint,
						))
					)
						candidates.push(tab);
				} catch {
					// Ignore unrelated/non-carrier tabs.
				}
			}
			if (candidates.length !== 1) return { state: "UNKNOWN", evidence: [] };
			const observed = candidates[0];
			if (!observed) return { state: "UNKNOWN", evidence: [] };
			const identity = parseCarrierIdentity(observed.url);
			if (!identity.workerRef) return { state: "UNKNOWN", evidence: [] };
			await options.task.bindWorker({
				taskId,
				roleRef,
				workerRef: identity.workerRef,
				conversationLocator: observed.url,
			});
			const evidence = browserEvidence(idFactory, observed, true);
			return {
				state: "APPLIED",
				evidence: [evidence],
				result: {
					capability: "worker.create",
					data: {
						roleRef,
						workerRef: identity.workerRef,
						conversationUrl: observed.url,
						verified: true,
					},
				},
			};
		}

		if (request.capability === "worker.wake") {
			if (
				!precondition.roleRef ||
				!precondition.workerRef ||
				!precondition.fingerprint
			)
				return { state: "UNKNOWN", evidence: [] };
			const observed = await matchingTab(
				precondition.roleRef,
				precondition.workerRef,
			);
			if (!observed) return { state: "UNKNOWN", evidence: [] };
			const delivered = await options.browser.hasMessage(
				observed.tabId,
				precondition.fingerprint,
			);
			const evidence = browserEvidence(idFactory, observed, delivered);
			if (!delivered) return { state: "NOT_APPLIED", evidence: [evidence] };
			return {
				state: "APPLIED",
				evidence: [evidence],
				result: {
					capability: "worker.wake",
					data: {
						roleRef: precondition.roleRef,
						workerRef: precondition.workerRef,
						triggerFingerprint: precondition.fingerprint,
						delivered: true,
					},
				},
			};
		}

		if (request.capability === "collaboration.deliver") {
			if (
				!precondition.roleRef ||
				!precondition.workerRef ||
				!precondition.fingerprint ||
				!precondition.messageRef
			)
				return { state: "UNKNOWN", evidence: [] };
			const observed = await matchingTab(
				precondition.roleRef,
				precondition.workerRef,
			);
			if (!observed) return { state: "UNKNOWN", evidence: [] };
			const delivered = await options.browser.hasMessage(
				observed.tabId,
				precondition.fingerprint,
			);
			const evidence = browserEvidence(idFactory, observed, delivered);
			if (!delivered) return { state: "NOT_APPLIED", evidence: [evidence] };
			return {
				state: "APPLIED",
				evidence: [evidence],
				result: {
					capability: "collaboration.deliver",
					data: {
						messageRef: precondition.messageRef,
						delivered: true,
						evidenceRef: evidence.evidenceRef,
					},
				},
			};
		}

		if (request.capability === "browser.submit" && precondition.fingerprint) {
			const observed = await observeTarget();
			if (!observed) return { state: "UNKNOWN", evidence: [] };
			const delivered = await options.browser.hasMessage(
				observed.tabId,
				precondition.fingerprint,
			);
			const evidence = browserEvidence(idFactory, observed, delivered);
			if (!delivered) return { state: "NOT_APPLIED", evidence: [evidence] };
			return {
				state: "APPLIED",
				evidence: [evidence],
				result: {
					capability: "browser.submit",
					data: {
						targetRef: precondition.targetRef ?? `tab:${observed.tabId}`,
						verified: true,
						observationRef: evidence.observationRef,
					},
				},
			};
		}

		if (request.capability === "browser.navigate" && precondition.expectedUrl) {
			const observed = await observeTarget();
			if (!observed || observed.url !== precondition.expectedUrl)
				return { state: "UNKNOWN", evidence: [] };
			const evidence = browserEvidence(idFactory, observed, true);
			return {
				state: "APPLIED",
				evidence: [evidence],
				result: {
					capability: "browser.navigate",
					data: {
						targetRef: precondition.targetRef ?? `tab:${observed.tabId}`,
						verified: true,
						observationRef: evidence.observationRef,
					},
				},
			};
		}

		// click/input/upload and other writes lack a durable postcondition that can
		// prove the exact effect after restart. Never infer APPLIED from tab presence.
		return { state: "UNKNOWN", evidence: [] };
	};

	return Object.freeze({
		extensionInstanceId,
		parseCarrierIdentity,
		registerContentSession,
		isContentSessionCurrent(tabId: number, contentInstanceId: string) {
			return sessions.get(tabId)?.contentInstanceId === contentInstanceId;
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
			return visionObservation(shot, observationContext);
		},
		async handlePermissionFallback(tabId: number, continuationRef: string) {
			const observed = await options.browser.observe(tabId);
			const shot = await options.browser.screenshot(tabId);
			const identity = parseCarrierIdentity(observed.url);
			if (identity.workerRef) {
				const lane = lanes.get(`${identity.roleRef}:${identity.workerRef}`);
				if (lane)
					lanes.set(`${identity.roleRef}:${identity.workerRef}`, {
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
				extensionInstanceId,
				observedAt: now().toISOString(),
				sessions: [...sessions.values()].map((item) => ({
					tabId: item.tabId,
					windowId: item.windowId,
					url: item.url,
					contentInstanceId: item.contentInstanceId,
					pageState: item.pageState,
					activityKind: item.activityKind,
				})),
				lanes: [...lanes.values()].map((item) => ({ ...item })),
			};
			Object.freeze(snapshot.sessions);
			Object.freeze(snapshot.lanes);
			return Object.freeze(snapshot);
		},
		execute,
		observePrecondition: async (
			request: ExecuteCapabilityRequest,
		): Promise<ExecutorPrecondition | undefined> =>
			browserPrecondition(request),
		reconcile,
		async readArtifact() {
			throw new ExecutionBrowserError(
				"EXECUTOR_UNAVAILABLE",
				"ARTIFACT_OWNED_BY_EXECUTION_RUNTIME",
			);
		},
		async recoveryScan(
			unfinished: Array<{
				request: ExecuteCapabilityRequest;
				effectStarted: boolean;
			}>,
		) {
			if (recoveryCompleted)
				return { status: "ALREADY_COMPLETED" as const, reconciled: [] };
			recoveryCompleted = true;
			for (const tab of await options.browser.listTabs()) {
				try {
					registerContentSession(tab);
				} catch {
					/* unrelated tab */
				}
			}
			const reconciled = [];
			for (const item of unfinished)
				reconciled.push(
					item.effectStarted
						? await reconcile(item.request, browserPrecondition(item.request))
						: { state: "NOT_APPLIED" as const, evidence: [] },
				);
			return { status: "COMPLETED" as const, reconciled };
		},
	});
}
