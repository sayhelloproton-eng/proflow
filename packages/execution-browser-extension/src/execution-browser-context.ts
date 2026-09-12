import { randomUUID } from "node:crypto";

import {
	type BrowserCapabilityId,
	type ExecuteCapabilityRequest,
	type ExecutionCapabilityResult,
	type ExecutionEvidence,
	type ExecutionExecutorPort,
	type ExecutorPrecondition,
} from "@tomflow/proflow-execution-contracts";
import { parseChatGptCarrierIdentity } from "./carrier-identity.ts";
import type {
	BrowserPageObservation,
	BrowserRealityPort,
} from "./browser-reality.ts";
import type {
	BrowserVisionImage,
	BrowserVisionObservationContext,
	BrowserVisionPort,
	TypedVisionObservation,
} from "./vision.ts";
import {
	deferVisionObservation,
	parseCapturedScreenshot,
} from "./vision.ts";

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

export type ExecutorInvocation = Parameters<ExecutionExecutorPort["execute"]>[0];
export type ExecutorResult = Awaited<ReturnType<ExecutionExecutorPort["execute"]>>;
export type Reconciliation = Awaited<ReturnType<ExecutionExecutorPort["reconcile"]>>;

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

export function createExecutionBrowserContext(
	options: Pick<ExecutionBrowserOptions, "browser" | "vision" | "idFactory" | "now">,
) {
	const idFactory = options.idFactory ?? randomUUID;
	const now = options.now ?? (() => new Date());
	const extensionInstanceId = `extension:${idFactory()}`;
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

	const parseCarrierIdentity = (raw: string): {
		roleRef: string;
		workerRef: string | null;
	} => {
		const identity = parseChatGptCarrierIdentity(raw);
		if (!identity)
			throw new ExecutionBrowserError(
				"PRECONDITION_FAILED",
				"CARRIER_URL_INVALID",
			);
		return identity;
	};

	const browserEvidence = (
		observation: BrowserPageObservation,
		verified: boolean,
	): Extract<ExecutionEvidence, { kind: "browser" }> => ({
		kind: "browser",
		evidenceRef: `evidence:${idFactory()}`,
		targetRef: `tab:${observation.tabId}`,
		observationRef: `observation:${idFactory()}`,
		verified,
	});

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
		evidence: [browserEvidence(observation, true)],
		artifacts: [],
		precondition: precondition ?? {
			kind: "browser",
			capability: capabilityResult.capability as BrowserCapabilityId,
		},
		effectApplied,
		successful: true,
	});

	return Object.freeze({
		browser: options.browser,
		idFactory,
		now,
		extensionInstanceId,
		serializeWrite,
		parseCarrierIdentity,
		browserEvidence,
		browserPrecondition,
		assertNotAborted,
		effectStarted,
		visionObservation,
		result,
	});
}

export type ExecutionBrowserContext = ReturnType<
	typeof createExecutionBrowserContext
>;
