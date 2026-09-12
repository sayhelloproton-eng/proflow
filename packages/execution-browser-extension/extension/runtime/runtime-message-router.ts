import type {
	ChromeTab,
	ContentObservation,
	RuntimeMessage,
} from "./chrome-runtime.js";
import type { PageRealityController } from "./page-reality-controller.js";
import type { PermissionController } from "./permission-controller.js";

type ObserverState = {
	assessmentRef: string;
	observedAt: string;
	unresolved: string[];
	carryForward: unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relayBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 0x8000)
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	return btoa(binary);
}

export function createRuntimeMessageRouter(options: {
	getExtensionInstanceId(): string;
	page: Pick<PageRealityController, "sessions">;
	permissions: Pick<PermissionController, "attentionViews" | "decideAttention">;
	onObservation(observed: ContentObservation): void;
	taskApplicationConfig(): Promise<unknown>;
	approvalApplicationConfig(): Promise<unknown>;
	loadObserverState(): Promise<ObserverState | null>;
	observabilitySnapshot?(): Promise<unknown>;
	invokeTask(operation: string, input: Record<string, unknown>): Promise<unknown>;
	invokeApproval(operation: string, input: Record<string, unknown>): Promise<unknown>;
	fetchImpl?: typeof fetch;
}) {
	const fetchImpl = options.fetchImpl ?? fetch;
	return Object.freeze({
		handle(
			message: RuntimeMessage,
			sender: { tab?: ChromeTab },
			sendResponse: (value: unknown) => void,
		): boolean | undefined {
			if (message.type === "PROFLOW_PROVISIONING_RELAY_FETCH") {
				const rawUrl = typeof message.url === "string" ? message.url : "";
				let parsed: URL;
				try {
					parsed = new URL(rawUrl);
				} catch {
					sendResponse({ ok: false, error: "KNOWLEDGE_RELAY_URL_INVALID" });
					return;
				}
				if (
					parsed.protocol !== "http:" ||
					parsed.hostname !== "127.0.0.1" ||
					!parsed.pathname.startsWith("/v1/provisioning/files/") ||
					parsed.username !== "" ||
					parsed.password !== "" ||
					parsed.search !== "" ||
					parsed.hash !== ""
				) {
					sendResponse({ ok: false, error: "KNOWLEDGE_RELAY_URL_INVALID" });
					return;
				}
				void fetchImpl(parsed.toString(), { cache: "no-store" }).then(
					async (response) => {
						if (!response.ok) {
							sendResponse({
								ok: false,
								error: `KNOWLEDGE_RELAY_FETCH_FAILED:${response.status}`,
							});
							return;
						}
						const bytes = new Uint8Array(await response.arrayBuffer());
						sendResponse({ ok: true, base64: relayBase64(bytes) });
					},
					(error: unknown) =>
						sendResponse({
							ok: false,
							error:
								error instanceof Error
									? `KNOWLEDGE_RELAY_FETCH_FAILED:${error.message}`
									: "KNOWLEDGE_RELAY_FETCH_FAILED",
						}),
				);
				return true;
			}
			if (
				message.type === "PROFLOW_CONTENT_OBSERVATION" &&
				message.observation &&
				sender.tab?.id !== undefined &&
				sender.tab.windowId !== undefined
			) {
				options.onObservation({
					...message.observation,
					tabId: sender.tab.id,
					windowId: sender.tab.windowId,
				});
				sendResponse({
					accepted: true,
					extensionInstanceId: options.getExtensionInstanceId(),
				});
				return;
			}
			if (message.type === "PROFLOW_SIDE_PANEL_SNAPSHOT") {
				void Promise.all([
					options.taskApplicationConfig(),
					options.approvalApplicationConfig(),
					options.loadObserverState().catch(() => null),
					options.observabilitySnapshot?.().catch(() => null) ?? Promise.resolve(null),
				]).then(([task, approval, observerState, observability]) =>
					sendResponse({
						extensionInstanceId: options.getExtensionInstanceId(),
						observedAt: new Date().toISOString(),
						sessions: options.page.sessions(),
						carrierAttentions: options.permissions.attentionViews(),
						taskApplicationConfigured: task !== null,
						approvalApplicationConfigured: approval !== null,
						observability,
						systemObserver: observerState
							? {
									assessmentRef: observerState.assessmentRef,
									observedAt: observerState.observedAt,
									unresolved: observerState.unresolved,
									carryForward: observerState.carryForward,
									needsHumanAttention:
										observerState.unresolved.length > 0 ||
										observerState.carryForward.length > 0,
								}
							: null,
					}),
				);
				return true;
			}
			if (message.type === "PROFLOW_CARRIER_ATTENTION_ACTION") {
				const attentionRef = message.input?.attentionRef;
				const action = message.input?.action;
				if (
					typeof attentionRef !== "string" ||
					(action !== "allowOnce" && action !== "deny")
				) {
					sendResponse({ ok: false, error: "CARRIER_ATTENTION_MESSAGE_INVALID" });
					return;
				}
				void options.permissions.decideAttention(attentionRef, action).then(
					(value) => sendResponse({ ok: true, value }),
					(error: unknown) =>
						sendResponse({
							ok: false,
							error:
								error instanceof Error
									? error.message
									: "CARRIER_ATTENTION_ACTION_FAILED",
						}),
				);
				return true;
			}
			if (
				message.type === "PROFLOW_TASK_APPLICATION" ||
				message.type === "PROFLOW_APPROVAL_APPLICATION"
			) {
				if (typeof message.operation !== "string" || !message.input) {
					sendResponse({
						ok: false,
						error:
							message.type === "PROFLOW_TASK_APPLICATION"
								? "TASK_APPLICATION_MESSAGE_INVALID"
								: "APPROVAL_APPLICATION_MESSAGE_INVALID",
					});
					return;
				}
				const invoke =
					message.type === "PROFLOW_TASK_APPLICATION"
						? options.invokeTask
						: options.invokeApproval;
				void invoke(message.operation, message.input).then(
					(value) => sendResponse({ ok: true, value }),
					(error: unknown) =>
						sendResponse({
							ok: false,
							error:
								error instanceof Error
									? error.message
									: "APPLICATION_REQUEST_FAILED",
						}),
				);
				return true;
			}
		},
	});
}
