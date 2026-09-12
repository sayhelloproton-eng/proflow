import { createCarrierAttentionRegistry } from "../../src/carrier-attention.js";
import {
	type CarrierContinuationDenial,
	createCarrierContinuationControl,
} from "../../src/carrier-continuation-control.js";
import { parseChatGptCarrierIdentity } from "../../src/carrier-identity.js";
import { createCarrierPermissionAttemptRegistry } from "../../src/carrier-permission-attempt.js";
import {
	type CarrierPermissionDecision,
	resolveHumanCarrierPermission,
	resolveRoutineCarrierPermission,
} from "../../src/carrier-permission-lifecycle.js";
import type { ContentObservation } from "./chrome-runtime.js";
import type { PageRealityController } from "./page-reality-controller.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createPermissionController(options: {
	storageSession: {
		get(key: string): Promise<Record<string, unknown>>;
		set(value: Record<string, unknown>): Promise<void>;
	};
	page: Pick<
		PageRealityController,
		"current" | "contentCommand" | "waitForPermissionReleased" | "sessions"
	>;
	getExtensionInstanceId(): string;
	invokeObserver(
		operation: string,
		input: Record<string, unknown>,
	): Promise<unknown>;
	publishCarrierAttentions(
		extensionInstanceId: string,
		views: readonly unknown[],
	): Promise<void>;
	sleep(milliseconds: number): Promise<void>;
}) {
	const snapshotKey = "proflowBrowserSnapshot";
	const handling = new Map<number, string>();
	const autoAttempts = createCarrierPermissionAttemptRegistry();
	const attentions = createCarrierAttentionRegistry();
	const continuation = createCarrierContinuationControl();
	let restoreFlight: Promise<boolean> | null = null;
	let snapshotTail = Promise.resolve();

	const permissionKey = (observed: ContentObservation): string | null =>
		observed.blockerFacts
			? `${observed.url}:${observed.blockerFacts.fingerprint}`
			: null;

	const attentionViews = () =>
		attentions
			.values()
			.map(
				({
					attentionRef,
					occurrenceRef,
					taskId,
					roleRef,
					workerRef,
					targetHost,
					operationId,
					reason,
					actions,
					observedAt,
				}) => ({
					attentionRef,
					occurrenceRef,
					taskId,
					roleRef,
					workerRef,
					targetHost,
					operationId,
					reason,
					actions,
					observedAt,
				}),
			);

	const publish = (): Promise<void> =>
		options.publishCarrierAttentions(
			options.getExtensionInstanceId(),
			attentionViews(),
		);

	const persist = (): Promise<void> => {
		const value = {
			[snapshotKey]: {
				extensionInstanceId: options.getExtensionInstanceId(),
				observedAt: new Date().toISOString(),
				sessions: options.page.sessions(),
				permissionAutoAttempts: autoAttempts.snapshot(),
				carrierContinuationDenials: continuation.snapshot(),
				recoveryScan: "BOUNDED_ON_START",
			},
		};
		snapshotTail = snapshotTail
			.catch(() => undefined)
			.then(() => options.storageSession.set(value));
		return snapshotTail;
	};

	const restore = (): Promise<boolean> => {
		if (restoreFlight) return restoreFlight;
		restoreFlight = (async () => {
			try {
				const stored = await options.storageSession.get(snapshotKey);
				const snapshot = stored[snapshotKey];
				const valid = isRecord(snapshot);
				const attemptsLoaded = autoAttempts.load(
					valid ? snapshot.permissionAutoAttempts : undefined,
				);
				const denialsLoaded = continuation.load(
					valid ? snapshot.carrierContinuationDenials : undefined,
				);
				return attemptsLoaded && denialsLoaded;
			} catch {
				autoAttempts.load(undefined);
				continuation.load(undefined);
				return false;
			}
		})();
		return restoreFlight;
	};

	const setAttention = (observed: ContentObservation, reason: string): void => {
		const facts = observed.blockerFacts;
		if (!facts) return;
		const identity = parseChatGptCarrierIdentity(observed.url);
		attentions.derive({
			tabId: observed.tabId,
			contentInstanceId: observed.contentInstanceId,
			url: observed.url,
			permissionFingerprint: facts.fingerprint,
			taskId: facts.taskId,
			roleRef: identity?.roleRef ?? null,
			workerRef: identity?.workerRef ?? null,
			targetHost: facts.targetHost,
			operationId: facts.operationId,
			reason,
			actions: facts.actions.filter(
				(action): action is "allowOnce" | "deny" =>
					action === "allowOnce" || action === "deny",
			),
			observedAt: new Date().toISOString(),
		});
		void publish().catch(() => undefined);
	};

	const handlePermission = async (observed: ContentObservation): Promise<void> => {
		const facts = observed.blockerFacts;
		const key = permissionKey(observed);
		if (
			observed.pageState !== "BLOCKED" ||
			observed.activityKind !== "ACTION_PERMISSION" ||
			!facts ||
			!key
		)
			return;
		if (handling.get(observed.tabId) === key) return;
		const existing = attentions.current(observed.tabId);
		if (
			existing?.contentInstanceId === observed.contentInstanceId &&
			existing.permissionFingerprint === facts.fingerprint
		)
			return;
		handling.set(observed.tabId, key);
		try {
			const identity = parseChatGptCarrierIdentity(observed.url);
			const humanDenied = () =>
				continuation.hasMatchingPermissionDenial({
					tabId: observed.tabId,
					contentInstanceId: observed.contentInstanceId,
					url: observed.url,
					permissionFingerprint: facts.fingerprint,
					taskId: facts.taskId,
					roleRef: identity?.roleRef ?? null,
					workerRef: identity?.workerRef ?? null,
				});
			if (humanDenied()) {
				setAttention(observed, "HUMAN_DENIED");
				return;
			}
			if (!(await restore())) {
				setAttention(observed, "PERMISSION_ATTEMPT_STATE_UNAVAILABLE");
				return;
			}
			if (!identity?.workerRef) {
				setAttention(observed, "PERMISSION_CONTEXT_INCOMPLETE");
				return;
			}
			const result = await resolveRoutineCarrierPermission({
				facts,
				autoAlreadyAttempted: autoAttempts.has(observed.tabId, key),
				humanDenied,
				port: {
					async classify(): Promise<CarrierPermissionDecision> {
						const value = await options.invokeObserver(
							"browser.permission.classify",
							{
								roleRef: identity.roleRef,
								workerRef: identity.workerRef,
								conversationLocator: observed.url,
								targetHost: facts.targetHost,
								operationId: facts.operationId,
								...(facts.taskId ? { taskId: facts.taskId } : {}),
							},
						);
						if (
							!isRecord(value) ||
							(value.decision !== "AUTO_ALLOW" &&
								value.decision !== "DEFER" &&
								value.decision !== "HUMAN_REQUIRED") ||
							typeof value.reason !== "string"
						)
							return {
								decision: "HUMAN_REQUIRED",
								reason: "PERMISSION_CLASSIFICATION_INVALID",
							};
						return { decision: value.decision, reason: value.reason };
					},
					revalidate() {
						const current = options.page.current(observed.tabId);
						return (
							current.contentInstanceId === observed.contentInstanceId &&
							current.url === observed.url &&
							current.blockerFacts?.fingerprint === facts.fingerprint
						);
					},
					waitBeforeReclassify: () => options.sleep(250),
					async act(action) {
						autoAttempts.begin(observed.tabId, key);
						await persist();
						await options.page.contentCommand(observed.tabId, {
							operation: "permissionAction",
							permissionFingerprint: facts.fingerprint,
							permissionAction: action,
						});
					},
					released: () =>
						options.page.waitForPermissionReleased(
							observed.tabId,
							facts.fingerprint,
						),
				},
			});
			if (result.status === "RELEASED") {
				autoAttempts.release(observed.tabId, key);
				attentions.removeTab(observed.tabId);
				await publish().catch(() => undefined);
				await persist();
				return;
			}
			if (result.status === "HUMAN_REQUIRED") setAttention(observed, result.reason);
		} catch {
			setAttention(observed, "AUTO_ALLOW_FAILED");
		} finally {
			if (handling.get(observed.tabId) === key) handling.delete(observed.tabId);
		}
	};

	return Object.freeze({
		restore,
		persist,
		publish,
		attentionViews,
		async observe(observed: ContentObservation): Promise<void> {
			autoAttempts.observe(observed.tabId, permissionKey(observed));
			const attention = attentions.current(observed.tabId);
			if (
				attention &&
				(observed.contentInstanceId !== attention.contentInstanceId ||
					observed.url !== attention.url ||
					observed.blockerFacts?.fingerprint !== attention.permissionFingerprint)
			) {
				attentions.removeTab(observed.tabId);
				await publish().catch(() => undefined);
			}
			await handlePermission(observed);
			await persist();
		},
		consumeRecovery(
			previous: ContentObservation | undefined,
			current: ContentObservation,
		): CarrierContinuationDenial | null {
			return continuation.consumeRecovery(previous, current);
		},
		suppressRecovery(
			previous: ContentObservation | undefined,
			current: ContentObservation,
		): boolean {
			return continuation.suppressRecovery(previous, current);
		},
		guardWake(input: {
			taskId: string;
			roleRef: string;
			workerRef: string;
			conversationLocator: string;
		}): boolean {
			return !continuation.hasMatchingDispatchDenial(input);
		},
		async decideAttention(attentionRef: string, action: "allowOnce" | "deny") {
			const attention = attentions.find(attentionRef);
			if (!attention?.actions.includes(action))
				throw new Error("CARRIER_ATTENTION_ACTION_DENIED");
			await resolveHumanCarrierPermission({
				action,
				revalidate() {
					const current = options.page.current(attention.tabId);
					return (
						current.contentInstanceId === attention.contentInstanceId &&
						current.url === attention.url &&
						current.blockerFacts?.fingerprint === attention.permissionFingerprint
					);
				},
				async act(semanticAction) {
					if (semanticAction === "deny") {
						continuation.beginDenied({
							attentionRef: attention.attentionRef,
							tabId: attention.tabId,
							taskId: attention.taskId,
							roleRef: attention.roleRef,
							workerRef: attention.workerRef,
							url: attention.url,
							contentInstanceId: attention.contentInstanceId,
							permissionFingerprint: attention.permissionFingerprint,
						});
						await persist();
					}
					try {
						await options.page.contentCommand(attention.tabId, {
							operation: "permissionAction",
							permissionFingerprint: attention.permissionFingerprint,
							permissionAction: semanticAction,
						});
					} catch (error) {
						if (semanticAction === "deny") {
							continuation.cancelDenied(attention.attentionRef);
							await persist();
						}
						throw error;
					}
				},
				released: () =>
					options.page.waitForPermissionReleased(
						attention.tabId,
						attention.permissionFingerprint,
					),
			});
			autoAttempts.release(
				attention.tabId,
				`${attention.url}:${attention.permissionFingerprint}`,
			);
			attentions.delete(attention.attentionRef);
			await publish().catch(() => undefined);
			await persist();
			return { attentionRef, action, status: "APPLIED" as const };
		},
	});
}

export type PermissionController = ReturnType<typeof createPermissionController>;
