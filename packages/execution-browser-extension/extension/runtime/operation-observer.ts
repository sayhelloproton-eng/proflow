import type { ContentObservation } from "./chrome-runtime.js";
import type {
	BrowserBridgeCommand,
	BrowserCommandResult,
} from "./browser-session-lane.js";
import type { ExtensionLogger } from "./extension-logger.js";
import type { PermissionObservationOutcome } from "./permission-controller.js";
import type { ProvisioningCommandOutcome } from "./provisioning-lane.js";
import { normalizeLogErrorCode } from "./application-client.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hostAxes(input: Record<string, unknown>) {
	const axes: Record<string, string | number> = {};
	for (const key of [
		"correlationId",
		"taskId",
		"nodeId",
		"roleRef",
		"workerRef",
		"executionRef",
		"messageRef",
		"artifactRef",
		"evidenceRef",
		"conversationLocator",
	] as const) {
		const value = input[key];
		if (typeof value === "string" && value.length > 0) axes[key] = value;
	}
	if (Number.isInteger(input.runNo) && Number(input.runNo) >= 0)
		axes.runNo = Number(input.runNo);
	return axes;
}

function pageAxes(observed: ContentObservation) {
	return {
		tabId: observed.tabId,
		contentInstanceId: observed.contentInstanceId,
		conversationLocator: observed.url,
		...(observed.blockerFacts?.fingerprint
			? {
					operationRef: observed.blockerFacts.fingerprint,
					correlationId: `permission:${observed.blockerFacts.fingerprint}`,
					correlationKind: "EXACT" as const,
					operationId: observed.blockerFacts.operationId,
				}
			: {}),
	};
}

function commandAxes(command: BrowserBridgeCommand) {
	const capability =
		command.request && typeof command.request.capability === "string"
			? command.request.capability
			: undefined;
	return {
		operationRef: command.commandId,
		...(command.tabId === undefined ? {} : { tabId: command.tabId }),
		...(command.taskId ? { taskId: command.taskId } : {}),
		...(command.roleRef ? { roleRef: command.roleRef } : {}),
		...(command.workerRef ? { workerRef: command.workerRef } : {}),
		...(command.conversationLocator
			? { conversationLocator: command.conversationLocator }
			: {}),
		...(capability ? { capability } : {}),
	};
}

export function createExtensionOperationObserver(options: { logger: ExtensionLogger }) {
	const emit = (input: Parameters<ExtensionLogger["emit"]>[0]): void => {
		void options.logger.emit(input).catch(() => undefined);
	};

	const wrapHostApplication = (
		surface: "task" | "approval" | "observer",
		invoke: (operation: string, input: Record<string, unknown>) => Promise<unknown>,
	) =>
		async (operation: string, input: Record<string, unknown>): Promise<unknown> => {
			const started = performance.now();
			try {
				const value = await invoke(operation, input);
				emit({
					component: "platform-host-application-boundary",
					event: "HOST_APPLICATION",
					phase: surface.toUpperCase(),
					status: "SUCCEEDED",
					operationId: operation,
					operationRef: operation,
					durationMs: performance.now() - started,
					...hostAxes(input),
				});
				return value;
			} catch (error) {
				emit({
					component: "platform-host-application-boundary",
					event: "HOST_APPLICATION",
					phase: surface.toUpperCase(),
					status: "FAILED",
					operationId: operation,
					operationRef: operation,
					errorCode: normalizeLogErrorCode(error, "HOST_APPLICATION_FAILED"),
					durationMs: performance.now() - started,
					...hostAxes(input),
				});
				throw error;
			}
		};

	return Object.freeze({
		wrapHostApplication,
		lifecycle(input: {
			operationId: "INITIALIZE";
			status: "SUCCEEDED" | "FAILED";
			error?: unknown;
			durationMs: number;
		}) {
			emit({
				component: "browser-extension-boundary",
				event: "EXTENSION_LIFECYCLE",
				phase: input.operationId,
				status: input.status,
				level: input.status === "FAILED" ? "ERROR" : "INFO",
				...(input.error === undefined
					? {}
					: {
							errorCode: normalizeLogErrorCode(
								input.error,
								"EXTENSION_INITIALIZATION_FAILED",
							),
						}),
				durationMs: input.durationMs,
			});
		},
		browserSession(input: {
			state: "ONLINE" | "OFFLINE";
			browserSessionEpoch: number;
			errorCode?: string;
		}) {
			emit({
				component: "browser-session-boundary",
				event: "BROWSER_SESSION_STATE",
				status: input.state === "ONLINE" ? "SUCCEEDED" : "FAILED",
				phase: input.state,
				browserSessionEpoch: input.browserSessionEpoch,
				...(input.errorCode ? { errorCode: input.errorCode } : {}),
			});
		},
		browserCommand(input: {
			command: BrowserBridgeCommand;
			result: BrowserCommandResult;
			browserSessionEpoch: number;
			reported: boolean;
			durationMs: number;
		}) {
			const status = input.reported
				? input.result.ok
					? "SUCCEEDED"
					: "FAILED"
				: "UNKNOWN";
			emit({
				component: "browser-command-boundary",
				event: "BROWSER_COMMAND",
				status,
				operationId: input.command.type,
				browserSessionEpoch: input.browserSessionEpoch,
				...(input.reported
					? input.result.error
						? {
								errorCode: normalizeLogErrorCode(
									input.result.error,
									"EXTENSION_COMMAND_FAILED",
								),
							}
						: {}
					: { errorCode: "BRIDGE_RESULT_REJECTED" }),
				durationMs: input.durationMs,
				...commandAxes(input.command),
			});
		},
		localToolSession(input: { state: "ONLINE" | "OFFLINE"; errorCode?: string }) {
			emit({
				component: "local-tool-session-boundary",
				event: "LOCAL_TOOL_SESSION_STATE",
				status: input.state === "ONLINE" ? "SUCCEEDED" : "FAILED",
				phase: input.state,
				...(input.errorCode ? { errorCode: input.errorCode } : {}),
			});
		},
		provisioningSession(input: {
			state: "ONLINE" | "OFFLINE";
			errorCode?: string;
		}) {
			emit({
				component: "provisioning-session-boundary",
				event: "PROVISIONING_SESSION_STATE",
				status: input.state === "ONLINE" ? "SUCCEEDED" : "FAILED",
				phase: input.state,
				...(input.errorCode ? { errorCode: input.errorCode } : {}),
			});
		},
		provisioningCommand(outcome: ProvisioningCommandOutcome) {
			emit({
				component: "provisioning-command-boundary",
				event: "PROVISIONING_COMMAND",
				status: outcome.status,
				operationId: outcome.operationId,
				operationRef: outcome.commandId,
				attemptNo: outcome.attemptNo,
				sideEffectState: outcome.sideEffectState,
				...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
				durationMs: outcome.durationMs,
			});
		},
		pageTransition(
			previous: ContentObservation | undefined,
			observed: ContentObservation,
		) {
			const changed =
				!previous ||
				previous.contentInstanceId !== observed.contentInstanceId ||
				previous.pageState !== observed.pageState ||
				previous.activityKind !== observed.activityKind ||
				previous.blockerFacts?.fingerprint !== observed.blockerFacts?.fingerprint;
			if (!changed) return;
			const before = previous
				? `${previous.pageState}:${previous.activityKind ?? "NONE"}`
				: "NONE";
			const after = `${observed.pageState}:${observed.activityKind ?? "NONE"}`;
			emit({
				component: "page-reality-boundary",
				event: "PAGE_REALITY_TRANSITION",
				status: observed.pageState === "BLOCKED" ? "BLOCKED" : "SUCCEEDED",
				phase: `${before}->${after}`,
				...pageAxes(observed),
			});
		},
		permission(outcome: PermissionObservationOutcome) {
			const status =
				outcome.status === "RELEASED"
					? "SUCCEEDED"
					: outcome.status === "HUMAN_REQUIRED"
						? "BLOCKED"
						: outcome.status === "STALE"
							? "DEFERRED"
							: "FAILED";
			emit({
				component: "permission-boundary",
				event: "PERMISSION_OPERATION",
				status,
				...(outcome.decision ? { decision: outcome.decision } : {}),
				...(outcome.reason ? { reason: outcome.reason } : {}),
				...(outcome.action ? { action: outcome.action } : {}),
				sideEffectState: outcome.sideEffectState,
				operationId: outcome.operationId,
				operationRef: outcome.operationRef,
				correlationId: outcome.correlationId,
				correlationKind: "EXACT",
				tabId: outcome.tabId,
				contentInstanceId: outcome.contentInstanceId,
				conversationLocator: outcome.conversationLocator,
				...(outcome.taskId ? { taskId: outcome.taskId } : {}),
				...(outcome.roleRef ? { roleRef: outcome.roleRef } : {}),
				...(outcome.workerRef ? { workerRef: outcome.workerRef } : {}),
			});
		},
		permissionFailure(observed: ContentObservation, error: unknown) {
			const facts = observed.blockerFacts;
			if (!facts) return;
			emit({
				component: "permission-boundary",
				event: "PERMISSION_OPERATION",
				status: "FAILED",
				operationId: facts.operationId,
				operationRef: facts.fingerprint,
				correlationId: `permission:${facts.fingerprint}`,
				correlationKind: "EXACT",
				errorCode: normalizeLogErrorCode(error, "PERMISSION_OPERATION_FAILED"),
				sideEffectState: "UNKNOWN",
				...pageAxes(observed),
			});
		},
		async snapshot() {
			return options.logger.snapshot();
		},
	});
}

