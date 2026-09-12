import { createCollaborationCarrierApplication } from "../../src/collaboration-carrier.js";
import { createObserverRecoveryRearm } from "../../src/observer-recovery-rearm.js";
import {
	createSystemObserver,
	type SystemObserverReasonFailure,
	type SystemObserverReasonRequest,
	type SystemObserverReasonResult,
	type SystemObserverView,
} from "../../src/system-observer.js";

type StoragePort = {
	get(key: string): Promise<Record<string, unknown>>;
	set(value: Record<string, unknown>): Promise<void>;
};

export type PersistedSystemObserverState = {
	assessmentRef: string;
	observedAt: string;
	unresolved: string[];
	carryForward: Array<{
		hypothesis: string;
		risk?: string;
		evidenceRef?: string;
		confidence: number;
	}>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createObserverRecoveryController(options: {
	storage: StoragePort;
	invokeObserver(
		operation: string,
		input: Record<string, unknown>,
	): Promise<unknown>;
	emitDiagnostic(status: string, attemptNo: number, operationRef: string): void;
}) {
	const stateKey = "proflowSystemObserverState";
	let bridgeSessionEpoch = 0;
	let recoveryAttemptNo = 0;
	let recoveryInFlight: Promise<void> | null = null;
	let trailingRequested = false;

	const collaborationCarrier = createCollaborationCarrierApplication({
		task: {
			async getWorkerBinding(taskId, roleRef) {
				return (await options.invokeObserver("collaboration.binding", {
					taskId,
					roleRef,
				})) as { workerRef: string; conversationLocator: string | null } | null;
			},
		},
		agent: {
			async listPendingMessages(limit) {
				const triggerRef = `bridge-session:${bridgeSessionEpoch}`;
				options.emitDiagnostic(
					"COLLABORATION_LIST_PENDING_BEGIN",
					recoveryAttemptNo,
					triggerRef,
				);
				try {
					return (await options.invokeObserver("collaboration.listPending", {
						limit,
					})) as Awaited<
						ReturnType<
							Parameters<
								typeof createCollaborationCarrierApplication
							>[0]["agent"]["listPendingMessages"]
						>
					>;
				} finally {
					options.emitDiagnostic(
						"COLLABORATION_LIST_PENDING_SETTLED",
						recoveryAttemptNo,
						triggerRef,
					);
				}
			},
			async getPendingMessage(messageRef) {
				return (await options.invokeObserver("collaboration.getPending", {
					messageRef,
				})) as Awaited<
					ReturnType<
						Parameters<
							typeof createCollaborationCarrierApplication
						>[0]["agent"]["getPendingMessage"]
					>
				>;
			},
			async reportDeliveryOutcome(input) {
				await options.invokeObserver("collaboration.reportDelivery", input);
			},
		},
		execution: {
			async execute(request) {
				return options.invokeObserver("collaboration.execute", { request });
			},
		},
		callerRef: "extension:collaboration-carrier",
	});

	const systemObserver = createSystemObserver({
		snapshots: {
			async readView(view: SystemObserverView) {
				return options.invokeObserver("system.view", { view });
			},
			async readDrilldown({ topic }) {
				return options.invokeObserver("system.drilldown", { topic });
			},
		},
		async reason(request: SystemObserverReasonRequest) {
			return (await options.invokeObserver("system.reason", {
				assessmentRef: request.assessmentRef,
				payload: request,
			})) as SystemObserverReasonResult | SystemObserverReasonFailure;
		},
	});

	const loadState = async (): Promise<PersistedSystemObserverState | null> => {
		const stored = await options.storage.get(stateKey);
		const value = stored[stateKey];
		if (!isRecord(value)) return null;
		if (
			typeof value.assessmentRef !== "string" ||
			typeof value.observedAt !== "string"
		)
			return null;
		const unresolved = Array.isArray(value.unresolved)
			? value.unresolved
					.filter((item): item is string => typeof item === "string")
					.slice(0, 50)
			: [];
		const carryForward = Array.isArray(value.carryForward)
			? value.carryForward.slice(0, 50).flatMap((item) => {
					if (
						!isRecord(item) ||
						typeof item.hypothesis !== "string" ||
						typeof item.confidence !== "number"
					)
						return [];
					return [
						{
							hypothesis: item.hypothesis,
							...(typeof item.risk === "string" ? { risk: item.risk } : {}),
							...(typeof item.evidenceRef === "string"
								? { evidenceRef: item.evidenceRef }
								: {}),
							confidence: item.confidence,
						},
					];
				})
			: [];
		return {
			assessmentRef: value.assessmentRef,
			observedAt: value.observedAt,
			unresolved,
			carryForward,
		};
	};

	const persistState = async (
		result: Awaited<ReturnType<typeof systemObserver.synthesize>>,
	) => {
		if (result.status !== "ASSESSED" || !result.global) return;
		await options.storage.set({
			[stateKey]: {
				assessmentRef: result.assessmentRef,
				observedAt: result.observedAt,
				unresolved: [...result.global.unresolved],
				carryForward: result.global.carryForward.map((item) => ({ ...item })),
			} satisfies PersistedSystemObserverState,
		});
	};

	const requestRecovery = (): Promise<void> => {
		const triggerRef = `bridge-session:${bridgeSessionEpoch}`;
		if (recoveryInFlight) {
			trailingRequested = true;
			options.emitDiagnostic("REUSED_IN_FLIGHT", recoveryAttemptNo, triggerRef);
			return recoveryInFlight;
		}
		recoveryAttemptNo += 1;
		const attemptNo = recoveryAttemptNo;
		options.emitDiagnostic("STARTED", attemptNo, triggerRef);
		recoveryInFlight = (async () => {
			options.emitDiagnostic("COLLABORATION_RECOVERY_BEGIN", attemptNo, triggerRef);
			await collaborationCarrier.recoverPending(50).catch(() => undefined);
			options.emitDiagnostic(
				"COLLABORATION_RECOVERY_SETTLED",
				attemptNo,
				triggerRef,
			);
			void options.invokeObserver("task.reconcileAll", {}).catch(() => undefined);
			const previous = await loadState().catch(() => null);
			const assessment = await systemObserver
				.synthesize({
					previousUnresolved: previous?.unresolved ?? [],
					previousCarryForward: previous?.carryForward ?? [],
				})
				.catch(() => null);
			if (assessment) await persistState(assessment).catch(() => undefined);
		})().finally(() => {
			recoveryInFlight = null;
			if (!trailingRequested) return;
			trailingRequested = false;
			void requestRecovery();
		});
		return recoveryInFlight;
	};

	const rearm = createObserverRecoveryRearm(() => {
		options.emitDiagnostic(
			"REARM_CALLBACK_ENTERED",
			bridgeSessionEpoch,
			`bridge-session:${bridgeSessionEpoch}`,
		);
		void requestRecovery();
	});

	return Object.freeze({
		loadState,
		requestRecovery,
		startupReady(): void {
			rearm.startupReady();
		},
		bridgeSessionEstablished(epoch: number): boolean {
			bridgeSessionEpoch = epoch;
			options.emitDiagnostic(
				"BRIDGE_EPOCH_ACCEPTED",
				epoch,
				`bridge-session:${epoch}`,
			);
			return rearm.bridgeSessionEstablished(epoch);
		},
	});
}
