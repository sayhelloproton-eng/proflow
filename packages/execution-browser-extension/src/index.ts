import { randomUUID } from "node:crypto";

import {
	browserCapabilityIds,
	type ExecuteCapabilityRequest,
	type ExecutionCapabilityResult,
	type ExecutionEvidence,
	executeCapabilityRequestSchema,
	parseExecutionRecord,
} from "@tomflow/proflow-execution-contracts";
import type { ExecutionExecutorPort } from "@tomflow/proflow-execution-runtime";

export type { BrowserRealityBridgeOptions } from "./bridge.ts";
export {
	BrowserRealityBridgeError,
	createBrowserRealityBridgeServer,
} from "./bridge.ts";

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
	screenshot(tabId: number): Promise<{ evidenceRef: string }>;
	perform?(
		request: ExecuteCapabilityRequest,
		tabId: number,
	): Promise<BrowserPageObservation>;
}

export interface TaskBrowserPort {
	getWorkerBinding(taskId: string, roleRef: string): Promise<string | null>;
	bindWorker(input: {
		taskId: string;
		roleRef: string;
		workerRef: string;
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
	): Promise<void>;
}

export interface ExecutionBrowserOptions {
	browser: BrowserRealityPort;
	task: TaskBrowserPort;
	agent: AgentDeliveryPort;
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
		| "UNKNOWN_SIDE_EFFECT";
	readonly retryable = false;
	constructor(code: ExecutionBrowserError["code"], message: string) {
		super(message);
		this.name = "ExecutionBrowserError";
		this.code = code;
	}
}

const browserCapabilities = new Set<string>(browserCapabilityIds);

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
): ExecutionEvidence {
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
	) => {
		const bound = await options.task.getWorkerBinding(taskId, roleRef);
		if (bound !== workerRef)
			throw new ExecutionBrowserError(
				"PRECONDITION_FAILED",
				"WORKER_BINDING_MISMATCH",
			);
		const existing = await matchingTab(roleRef, workerRef);
		if (existing) return existing;
		const opened = await options.browser.open(
			`https://chatgpt.com/g/${roleRef}/c/${workerRef}`,
		);
		const observed = await options.browser.observe(opened.tabId);
		const identity = parseCarrierIdentity(observed.url);
		if (identity.roleRef !== roleRef || identity.workerRef !== workerRef)
			throw new ExecutionBrowserError(
				"PRECONDITION_FAILED",
				"RESTORE_IDENTITY_MISMATCH",
			);
		registerContentSession(observed);
		return observed;
	};

	const effectStarted = async (invocation: ExecutorInvocation) => {
		await invocation.onEffectStarted?.({
			kind: "opaque",
			capability: invocation.request.capability,
		} as never);
	};

	const result = (
		capabilityResult: ExecutionCapabilityResult,
		observation: BrowserPageObservation,
		effectApplied: boolean,
	): ExecutorResult => ({
		result: capabilityResult,
		evidence: [browserEvidence(idFactory, observation, true)],
		artifacts: [],
		precondition: {
			kind: "opaque",
			capability: capabilityResult.capability,
		} as never,
		effectApplied,
		successful: true,
	});

	const execute = async (raw: ExecutorInvocation): Promise<ExecutorResult> => {
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
				const opened = await options.browser.open(request.input.roleUrl);
				await effectStarted(raw);
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
				);
			});

		if (request.capability === "worker.restore") {
			const observed = await ensureRestored(
				taskId,
				request.input.roleRef,
				request.input.workerRef,
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
				if (request.input.trigger.length > 4_096)
					throw new ExecutionBrowserError(
						"PRECONDITION_FAILED",
						"WAKE_TRIGGER_TOO_LARGE",
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
				await effectStarted(raw);
				const trigger = JSON.stringify({
					protocol: "aap.agent.browser-trigger.v1",
					triggerId: request.input.fingerprint,
					triggerType: "NODE_READY",
					taskId,
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
				await effectStarted(raw);
				const trigger = JSON.stringify({
					protocol: "aap.agent.browser-trigger.v1",
					triggerId: message.messageId,
					triggerType: "PEER_MESSAGE",
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
		if (request.capability === "browser.observe")
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
		if (request.capability === "browser.screenshot") {
			const shot = await options.browser.screenshot(observed.tabId);
			return {
				...result(
					{
						capability: "browser.screenshot",
						data: {
							targetRef: target,
							verified: true,
							observationRef: shot.evidenceRef,
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
			await effectStarted(raw);
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
			);
		});
	};

	const reconcile = async (
		requestRaw: ExecuteCapabilityRequest,
	): Promise<Reconciliation> => {
		const request = executeCapabilityRequestSchema.parse(requestRaw);
		let roleRef: string | undefined;
		let workerRef: string | undefined;
		let fingerprint: string | undefined;
		if (request.capability === "worker.wake")
			({ roleRef, workerRef, fingerprint } = request.input);
		else if (request.capability === "collaboration.deliver") {
			roleRef = request.input.roleRef;
			workerRef = request.input.workerRef;
			fingerprint = request.input.contentFingerprint;
		} else if (request.capability === "worker.restore")
			({ roleRef, workerRef } = request.input);
		else if (request.capability === "worker.create") {
			roleRef = request.input.roleRef;
			const candidates = (await options.browser.listTabs()).filter((tab) => {
				try {
					const identity = parseCarrierIdentity(tab.url);
					return identity.roleRef === roleRef && identity.workerRef !== null;
				} catch {
					return false;
				}
			});
			if (candidates.length !== 1)
				return {
					state: candidates.length === 0 ? "NOT_APPLIED" : "UNKNOWN",
					evidence: [],
				};
			const observed = candidates[0];
			if (!observed) return { state: "UNKNOWN", evidence: [] };
			const identity = parseCarrierIdentity(observed.url);
			if (!identity.workerRef || !request.taskId)
				return { state: "UNKNOWN", evidence: [] };
			await options.task.bindWorker({
				taskId: request.taskId,
				roleRef,
				workerRef: identity.workerRef,
			});
			return {
				state: "APPLIED",
				evidence: [browserEvidence(idFactory, observed, true)],
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
		if (!roleRef || !workerRef) return { state: "UNKNOWN", evidence: [] };
		const observed = await matchingTab(roleRef, workerRef);
		if (!observed) return { state: "NOT_APPLIED", evidence: [] };
		if (
			fingerprint &&
			!(await options.browser.hasMessage(observed.tabId, fingerprint))
		)
			return {
				state: "NOT_APPLIED",
				evidence: [browserEvidence(idFactory, observed, false)],
			};
		return {
			state: "APPLIED",
			evidence: [browserEvidence(idFactory, observed, true)],
		};
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
		reconcile,
		async finalizeCollaborationDelivery(recordRaw: unknown) {
			const record = parseExecutionRecord(recordRaw);
			if (
				record.status !== "SUCCEEDED" ||
				record.sideEffectState !== "APPLIED" ||
				record.result?.capability !== "collaboration.deliver" ||
				record.result.data.delivered !== true
			)
				throw new ExecutionBrowserError(
					"PRECONDITION_FAILED",
					"COLLABORATION_EXECUTION_NOT_COMMITTED",
				);
			await options.agent.reportPhysicalDelivery(
				record.result.data.messageRef,
				record.result.data.evidenceRef,
			);
			return { status: "DELIVERED" as const };
		},
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
						? await reconcile(item.request)
						: { state: "NOT_APPLIED" as const, evidence: [] },
				);
			return { status: "COMPLETED" as const, reconciled };
		},
	});
}
