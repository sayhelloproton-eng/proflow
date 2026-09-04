import { createCollaborationCarrierApplication } from "../src/collaboration-carrier.js";
import {
	createSystemObserver,
	type SystemObserverReasonFailure,
	type SystemObserverReasonRequest,
	type SystemObserverReasonResult,
	type SystemObserverView,
} from "../src/system-observer.js";
import {
	createTaskObserver,
	type TaskDriveProjection,
	type TaskObserverDiagnosticAssessment,
	type TaskObserverDiagnosticFailure,
} from "../src/task-observer.js";
import { shouldTriggerObserverRecovery } from "../src/recovery-trigger.js";

type PageState = "IDLE" | "BUSY" | "BLOCKED" | "UNKNOWN";
type ActivityKind =
	| "GENERATING"
	| "ACTION_PERMISSION"
	| "ACTION_RUNNING"
	| "WAITING_HUMAN"
	| "WAITING_PEER"
	| "RECOVERING"
	| null;
type ContentObservation = {
	tabId: number;
	windowId: number;
	url: string;
	contentInstanceId: string;
	pageState: PageState;
	activityKind: ActivityKind;
	observedAt: string;
};
type RuntimeMessage = {
	type:
		| "PROFLOW_CONTENT_OBSERVATION"
		| "PROFLOW_SIDE_PANEL_SNAPSHOT"
		| "PROFLOW_TASK_APPLICATION"
		| "PROFLOW_APPROVAL_APPLICATION"
		| "PROFLOW_PROVISIONING_RELAY_FETCH";
	observation?: Omit<ContentObservation, "tabId" | "windowId">;
	operation?: string;
	input?: Record<string, unknown>;
	url?: string;
};
type BridgeConfig = { endpoint: string; token: string };
type BridgeCommand = {
	commandId: string;
	type:
		| "LIST_TABS"
		| "OPEN"
		| "OBSERVE"
		| "SUBMIT"
		| "VERIFY"
		| "SCREENSHOT"
		| "PERFORM";
	tabId?: number;
	url?: string;
	text?: string;
	fingerprint?: string;
	request?: Record<string, unknown>;
};
type ContentCommand = {
	type: "PROFLOW_PAGE_COMMAND";
	contentInstanceId: string;
	expectedUrl: string;
	operation: "observe" | "input" | "click" | "submit" | "verify";
	selector?: string;
	value?: string;
	fingerprint?: string;
};
type ProvisioningOperation =
	| "PROVISION_CUSTOM_GPT"
	| "FINALIZE_CUSTOM_GPT_AUTH";
type ProvisioningBridgeCommand = {
	commandId: string;
	type: ProvisioningOperation;
	request: Record<string, unknown>;
};
type ProvisioningContentCommand = {
	type: "PROFLOW_PROVISIONING_COMMAND";
	operation: ProvisioningOperation;
	request: Record<string, unknown>;
};
type ChromeTab = {
	id?: number;
	windowId?: number;
	url?: string;
	status?: "loading" | "complete";
};
type ChromeRuntime = {
	runtime: {
		id: string;
		getURL(path: string): string;
		onMessage: {
			addListener(
				listener: (
					message: RuntimeMessage,
					sender: { tab?: ChromeTab },
					sendResponse: (value: unknown) => void,
				) => boolean | undefined,
			): void;
		};
		onStartup: { addListener(listener: () => void): void };
		onInstalled: { addListener(listener: () => void): void };
	};
	storage: {
		session: {
			get(key: string): Promise<Record<string, unknown>>;
			set(value: Record<string, unknown>): Promise<void>;
		};
		local: {
			get(key: string): Promise<Record<string, unknown>>;
			set(value: Record<string, unknown>): Promise<void>;
		};
	};
	action: {
		onClicked: { addListener(listener: () => void): void };
	};
	tabs: {
		query(query: { url?: string; currentWindow?: boolean }): Promise<ChromeTab[]>;
		get(tabId: number): Promise<ChromeTab>;
		create(create: { url: string; active: boolean }): Promise<ChromeTab>;
		reload(tabId: number): Promise<void>;
		update(
			tabId: number,
			update: { url?: string; active?: boolean },
		): Promise<ChromeTab>;
		sendMessage(
			tabId: number,
			message: ContentCommand | ProvisioningContentCommand,
		): Promise<unknown>;
		captureVisibleTab(
			windowId: number,
			options: { format: "png" },
		): Promise<string>;
	};
};
declare const chrome: ChromeRuntime;

const extensionInstanceId = `extension:${crypto.randomUUID()}`;
const sessions = new Map<number, ContentObservation>();
const BROWSER_CARRIER_KEEPALIVE_KEY = "proflowBrowserSnapshot";
const BROWSER_CARRIER_KEEPALIVE_MS = 20_000;
const BROWSER_BRIDGE_FETCH_TIMEOUT_MS = 5_000;

const sleep = (milliseconds: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function persistSnapshot() {
	await chrome.storage.session.set({
		proflowBrowserSnapshot: {
			extensionInstanceId,
			observedAt: new Date().toISOString(),
			sessions: [...sessions.values()],
			recoveryScan: "BOUNDED_ON_START",
		},
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConfig(value: unknown): BridgeConfig | null {
	if (!isRecord(value)) return null;
	const endpoint = value.endpoint;
	const token = value.token;
	if (typeof endpoint !== "string" || typeof token !== "string") return null;
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		return null;
	}
	if (
		url.protocol !== "http:" ||
		url.hostname !== "127.0.0.1" ||
		url.pathname !== "/" ||
		url.search !== "" ||
		url.hash !== "" ||
		token.length < 32
	)
		return null;
	return { endpoint: endpoint.replace(/\/$/, ""), token };
}

type ManagedRuntimeConfig = {
	proflowRuntimeBridge?: unknown;
	proflowProvisioningBridge?: unknown;
	proflowTaskApplication?: unknown;
	proflowApprovalApplication?: unknown;
};

async function bootstrapManagedRuntimeConfig(): Promise<void> {
	let response: Response;
	try {
		response = await fetch(chrome.runtime.getURL("runtime-config.json"), {
			cache: "no-store",
		});
	} catch {
		return;
	}
	if (!response.ok) return;
	const raw = (await response.json()) as unknown;
	if (!isRecord(raw)) return;
	const managed = raw as ManagedRuntimeConfig;
	const bridge = parseConfig(managed.proflowRuntimeBridge);
	const provisioning = parseConfig(managed.proflowProvisioningBridge);
	const task = parseConfig(managed.proflowTaskApplication);
	const approval = parseConfig(managed.proflowApprovalApplication);
	if (!bridge || !task || !approval) {
		throw new Error("MANAGED_RUNTIME_CONFIG_INVALID");
	}
	await chrome.storage.local.set({
		proflowRuntimeBridge: bridge,
		...(provisioning ? { proflowProvisioningBridge: provisioning } : {}),
		proflowTaskApplication: task,
		proflowApprovalApplication: approval,
	});
}

async function bridgeConfig(): Promise<BridgeConfig | null> {
	const stored = await chrome.storage.local.get("proflowRuntimeBridge");
	return parseConfig(stored.proflowRuntimeBridge);
}

async function provisioningBridgeConfig(): Promise<BridgeConfig | null> {
	const stored = await chrome.storage.local.get("proflowProvisioningBridge");
	return parseConfig(stored.proflowProvisioningBridge);
}

async function taskApplicationConfig(): Promise<BridgeConfig | null> {
	const stored = await chrome.storage.local.get("proflowTaskApplication");
	return parseConfig(stored.proflowTaskApplication);
}

async function approvalApplicationConfig(): Promise<BridgeConfig | null> {
	const stored = await chrome.storage.local.get("proflowApprovalApplication");
	return parseConfig(stored.proflowApprovalApplication);
}

async function invokeApprovalApplication(
	operation: string,
	input: Record<string, unknown>,
): Promise<unknown> {
	const config = await approvalApplicationConfig();
	if (!config) throw new Error("APPROVAL_APPLICATION_NOT_CONFIGURED");
	const response = await fetch(`${config.endpoint}/application/approval`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${config.token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ operation, input }),
	});
	const body = (await response.json()) as unknown;
	if (!response.ok) {
		const detail =
			isRecord(body) && typeof body.error === "string"
				? body.error
				: "APPROVAL_APPLICATION_REQUEST_FAILED";
		throw new Error(detail);
	}
	return body;
}

async function invokeTaskApplication(
	operation: string,
	input: Record<string, unknown>,
): Promise<unknown> {
	const config = await taskApplicationConfig();
	if (!config) throw new Error("TASK_APPLICATION_NOT_CONFIGURED");
	const response = await fetch(`${config.endpoint}/application/task`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${config.token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ operation, input }),
	});
	const body = (await response.json()) as unknown;
	if (!response.ok) {
		const detail =
			isRecord(body) && typeof body.error === "string"
				? body.error
				: "TASK_APPLICATION_REQUEST_FAILED";
		throw new Error(detail);
	}
	return body;
}

type BrowserStructuredLogEntry = {
	level: "DEBUG" | "INFO" | "WARN" | "ERROR";
	component: string;
	capability?: string;
	operation?: string;
	status?: string;
	errorCode?: string;
	correlationId?: string;
	taskId?: string;
	nodeId?: string;
	runNo?: number;
	agentPackageRef?: string;
	roleRef?: string;
	workerRef?: string;
	executionRef?: string;
	messageRef?: string;
	artifactRef?: string;
	evidenceRef?: string;
	conversationLocator?: string;
	operationRef?: string;
	attemptNo?: number;
	tabId?: number;
};

function sanitizeConversationLocator(value: string): string {
	try {
		const locator = new URL(value);
		locator.username = "";
		locator.password = "";
		locator.search = "";
		locator.hash = "";
		return locator.toString();
	} catch {
		return "[REDACTED_INVALID_LOCATOR]";
	}
}

function normalizeLogErrorCode(error: unknown, fallback: string): string {
	const value = error instanceof Error ? error.message : error;
	return typeof value === "string" && /^[A-Z][A-Z0-9_.:-]{0,159}$/.test(value)
		? value
		: fallback;
}

function structuredAxes(input: Record<string, unknown>) {
	const result: Record<string, string | number> = {};
	for (const key of [
		"correlationId",
		"taskId",
		"nodeId",
		"agentPackageRef",
		"roleRef",
		"workerRef",
		"executionRef",
		"messageRef",
		"artifactRef",
		"evidenceRef",
	] as const) {
		const value = input[key];
		if (typeof value === "string" && value.length > 0) result[key] = value;
	}
	if (
		typeof input.conversationLocator === "string" &&
		input.conversationLocator.length > 0
	)
		result.conversationLocator = sanitizeConversationLocator(
			input.conversationLocator,
		);
	for (const key of ["runNo", "attemptNo", "tabId"] as const) {
		const value = input[key];
		if (Number.isInteger(value) && Number(value) >= 0)
			result[key] = Number(value);
	}
	return result;
}

async function emitStructuredLog(entry: BrowserStructuredLogEntry) {
	const config = await taskApplicationConfig();
	if (!config) return;
	await fetch(`${config.endpoint}/application/log`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${config.token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ timestamp: new Date().toISOString(), ...entry }),
	}).catch(() => undefined);
}

async function invokeObserverApplication(
	operation: string,
	input: Record<string, unknown>,
): Promise<unknown> {
	const config = await taskApplicationConfig();
	if (!config) throw new Error("OBSERVER_APPLICATION_NOT_CONFIGURED");
	const component = operation.startsWith("collaboration.")
		? "browser-collaboration-carrier"
		: "browser-observer";
	try {
		const response = await fetch(`${config.endpoint}/application/observer`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${config.token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ operation, input }),
		});
		const body = (await response.json()) as unknown;
		if (!response.ok) {
			const detail =
				isRecord(body) && typeof body.error === "string"
					? body.error
					: "OBSERVER_APPLICATION_REQUEST_FAILED";
			throw new Error(detail);
		}
		void emitStructuredLog({
			level: "INFO",
			component,
			operation,
			status: "SUCCEEDED",
			...structuredAxes(input),
		});
		return body;
	} catch (error) {
		void emitStructuredLog({
			level: "WARN",
			component,
			operation,
			status: "FAILED",
			errorCode: normalizeLogErrorCode(
				error,
				"OBSERVER_APPLICATION_REQUEST_FAILED",
			),
			...structuredAxes(input),
		});
		throw error;
	}
}

const taskObserver = createTaskObserver({
	owner: {
		async getTaskDriveProjection(taskId) {
			return (await invokeObserverApplication("task.projection", {
				taskId,
			})) as TaskDriveProjection;
		},
	},
	diagnostic: {
		async assess(input) {
			return (await invokeObserverApplication("task.diagnostic", {
				taskId: input.taskId,
				nodeId: input.nodeId,
				correlationId: input.anomaly.ref,
				payload: input,
			})) as TaskObserverDiagnosticAssessment | TaskObserverDiagnosticFailure;
		},
	},
	carrier: {
		async requestWake(input) {
			return invokeObserverApplication("task.wake", input);
		},
	},
});

const collaborationCarrier = createCollaborationCarrierApplication({
	task: {
		async getWorkerBinding(taskId, roleRef) {
			return (await invokeObserverApplication("collaboration.binding", {
				taskId,
				roleRef,
			})) as { workerRef: string; conversationLocator: string | null } | null;
		},
	},
	agent: {
		async listPendingMessages(limit) {
			return (await invokeObserverApplication("collaboration.listPending", {
				limit,
			})) as Awaited<
				ReturnType<
					Parameters<
						typeof createCollaborationCarrierApplication
					>[0]["agent"]["listPendingMessages"]
				>
			>;
		},
		async getPendingMessage(messageRef) {
			return (await invokeObserverApplication("collaboration.getPending", {
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
			await invokeObserverApplication("collaboration.reportDelivery", input);
		},
	},
	execution: {
		async execute(request) {
			return invokeObserverApplication("collaboration.execute", { request });
		},
	},
	callerRef: "extension:collaboration-carrier",
});

const systemObserver = createSystemObserver({
	snapshots: {
		async readView(view: SystemObserverView) {
			return invokeObserverApplication("system.view", { view });
		},
		async readDrilldown({ topic }) {
			return invokeObserverApplication("system.drilldown", { topic });
		},
	},
	async reason(request: SystemObserverReasonRequest) {
		return (await invokeObserverApplication("system.reason", {
			assessmentRef: request.assessmentRef,
			payload: request,
		})) as SystemObserverReasonResult | SystemObserverReasonFailure;
	},
});

const SYSTEM_OBSERVER_STATE_KEY = "proflowSystemObserverState";
type PersistedSystemObserverState = {
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

async function loadSystemObserverState(): Promise<PersistedSystemObserverState | null> {
	const stored = await chrome.storage.local.get(SYSTEM_OBSERVER_STATE_KEY);
	const value = stored[SYSTEM_OBSERVER_STATE_KEY];
	if (!isRecord(value)) return null;
	if (
		typeof value.assessmentRef !== "string" ||
		typeof value.observedAt !== "string"
	) {
		return null;
	}
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
				) {
					return [];
				}
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
}

async function persistSystemObserverState(
	result: Awaited<ReturnType<typeof systemObserver.synthesize>>,
) {
	if (result.status !== "ASSESSED" || !result.global) return;
	await chrome.storage.local.set({
		[SYSTEM_OBSERVER_STATE_KEY]: {
			assessmentRef: result.assessmentRef,
			observedAt: result.observedAt,
			unresolved: [...result.global.unresolved],
			carryForward: result.global.carryForward.map((item) => ({ ...item })),
		} satisfies PersistedSystemObserverState,
	});
}

let observerRecoveryInFlight: Promise<void> | null = null;
let observerRecoveryRetryCount = 0;
function runObserverRecovery() {
	if (observerRecoveryInFlight) return observerRecoveryInFlight;
	observerRecoveryInFlight = (async () => {
		let recoveryNeedsRetry = false;
		await collaborationCarrier.recoverPending(50).catch(() => undefined);
		const signalBatch = await invokeObserverApplication(
			"execution.listSignals",
			{ limit: 50 },
		).catch(() => null);
		if (isRecord(signalBatch) && Array.isArray(signalBatch.signals)) {
			for (const candidate of signalBatch.signals) {
				if (
					!isRecord(candidate) ||
					typeof candidate.signalRef !== "string" ||
					typeof candidate.executionRef !== "string" ||
					typeof candidate.taskId !== "string" ||
					typeof candidate.workerRef !== "string"
				)
					continue;
				try {
					const decision =
						candidate.kind === "RECOVERY_RESUME"
							? await taskObserver.drive(candidate.taskId, {
									trigger: "RECOVERY_RESUME",
									ref: candidate.executionRef,
									targetWorkerRef: candidate.workerRef,
								})
							: candidate.kind === "UNKNOWN_REALITY"
								? await taskObserver.drive(candidate.taskId, undefined, {
										kind: "UNKNOWN_REALITY",
										ref: candidate.executionRef,
										facts: {
											executionRef: candidate.executionRef,
											summary: `Execution ${candidate.executionRef} recovery remains UNKNOWN`,
										},
									})
								: null;
					if (!decision) continue;
					if (
						decision.kind === "NOOP" &&
						(decision.reason === "BINDING_NOT_READY" ||
							decision.reason === "RESUME_TARGET_NOT_CURRENT_WORKER" ||
							decision.reason === "DIAGNOSTIC_UNAVAILABLE" ||
							decision.reason.startsWith("DIAGNOSTIC_DEFERRED:"))
					)
						continue;
					await invokeObserverApplication("execution.ackSignal", {
						signalRef: candidate.signalRef,
					});
				} catch {
					// Leave the durable signal unacknowledged for the next bounded recovery pass.
					recoveryNeedsRetry = true;
				}
			}
		}
		const listed = await invokeTaskApplication("task.list", {}).catch(
			() => null,
		);
		if (listed === null) recoveryNeedsRetry = true;
		if (isRecord(listed) && Array.isArray(listed.tasks)) {
			for (const candidate of listed.tasks.slice(0, 100)) {
				if (!isRecord(candidate) || typeof candidate.taskId !== "string")
					continue;
				if (
					candidate.status === "SUCCEEDED" ||
					candidate.status === "TERMINATED"
				)
					continue;
				// J1 Worker teaming recovery is driven from durable Task binding facts.
				// This bounded startup/event recovery pass re-runs the idempotent
				// ensureWorkers application before Task progression, so Dev/Test
				// completion never depends on an in-memory Promise surviving a Host
				// or Extension restart. Successful bindings are preserved and only
				// missing roles are re-provisioned by the Host/Execution path.
				await invokeTaskApplication("task.ensureWorkers", {
					taskId: candidate.taskId,
				}).catch(() => {
					recoveryNeedsRetry = true;
				});
				await taskObserver.drive(candidate.taskId).catch(() => {
					recoveryNeedsRetry = true;
				});
			}
		}
		// A bounded retry continues the same stable Execution identities. Execution
		// remains the no-blind-replay authority for APPLIED/NOT_APPLIED/UNKNOWN.
		if (recoveryNeedsRetry && observerRecoveryRetryCount < 6) {
			observerRecoveryRetryCount += 1;
			setTimeout(() => void runObserverRecovery(), 2_000);
		} else if (!recoveryNeedsRetry) {
			observerRecoveryRetryCount = 0;
		}
		const previousSystemState = await loadSystemObserverState().catch(
			() => null,
		);
		const systemAssessment = await systemObserver
			.synthesize({
				previousUnresolved: previousSystemState?.unresolved ?? [],
				previousCarryForward: previousSystemState?.carryForward ?? [],
			})
			.catch(() => null);
		if (systemAssessment) {
			await persistSystemObserverState(systemAssessment).catch(() => undefined);
		}
	})().finally(() => {
		observerRecoveryInFlight = null;
	});
	return observerRecoveryInFlight;
}

function observationFor(tabId: number): ContentObservation {
	const observed = sessions.get(tabId);
	if (!observed) throw new Error("CONTENT_SESSION_NOT_READY");
	return observed;
}

async function waitForObservation(
	tabId: number,
	predicate: (value: ContentObservation) => boolean = () => true,
): Promise<ContentObservation> {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		const observed = sessions.get(tabId);
		if (observed && predicate(observed)) return observed;
		await sleep(250);
	}
	throw new Error("CONTENT_SESSION_TIMEOUT");
}

async function contentCommand(
	tabId: number,
	command: Omit<ContentCommand, "type" | "contentInstanceId" | "expectedUrl">,
): Promise<unknown> {
	const observed = observationFor(tabId);
	const response = await chrome.tabs.sendMessage(tabId, {
		type: "PROFLOW_PAGE_COMMAND",
		contentInstanceId: observed.contentInstanceId,
		expectedUrl: observed.url,
		...command,
	});
	if (!isRecord(response) || response.ok !== true) {
		const detail =
			isRecord(response) && typeof response.error === "string"
				? response.error
				: "PAGE_COMMAND_FAILED";
		throw new Error(detail);
	}
	return response.value;
}

async function waitForSubmittedMessage(
	tabId: number,
	fingerprint: string,
): Promise<ContentObservation> {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		try {
			const value = await contentCommand(tabId, {
				operation: "verify",
				fingerprint,
			});
			if (isRecord(value) && value.verified === true)
				return observationFor(tabId);
		} catch {
			// Navigation can replace the content instance after submit. The next
			// bounded observation/verification pass uses the newly published session.
		}
		await sleep(250);
	}
	throw new Error("MESSAGE_SUBMIT_REALITY_UNCONFIRMED");
}

function numeric(value: unknown, name: string): number {
	if (!Number.isInteger(value)) throw new Error(`${name}_INVALID`);
	return value as number;
}

function text(value: unknown, name: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`${name}_INVALID`);
	return value;
}

async function executeCommand(command: BridgeCommand): Promise<unknown> {
	if (command.type === "LIST_TABS") {
		const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/g/*" });
		return tabs
			.map((tab) => tab.id)
			.filter((tabId): tabId is number => tabId !== undefined)
			.map((tabId) => sessions.get(tabId))
			.filter((value): value is ContentObservation => value !== undefined);
	}
	if (command.type === "OPEN") {
		const url = text(command.url, "URL");
		const parsed = new URL(url);
		if (parsed.protocol !== "https:" || parsed.hostname !== "chatgpt.com")
			throw new Error("URL_SCOPE_DENIED");
		const tab = await chrome.tabs.create({ url, active: true });
		return waitForObservation(numeric(tab.id, "TAB_ID"));
	}
	const tabId = numeric(command.tabId, "TAB_ID");
	if (command.type === "OBSERVE")
		return contentCommand(tabId, { operation: "observe" });
	if (command.type === "SUBMIT") {
		const before = observationFor(tabId);
		const fingerprint = text(command.fingerprint, "FINGERPRINT");
		try {
			await contentCommand(tabId, {
				operation: "submit",
				value: text(command.text, "TEXT"),
				fingerprint,
			});
		} catch (error) {
			const replacement = await waitForObservation(
				tabId,
				(value) => value.contentInstanceId !== before.contentInstanceId,
			).catch(() => null);
			if (!replacement) throw error;
		}
		return waitForSubmittedMessage(tabId, fingerprint);
	}
	if (command.type === "VERIFY")
		return contentCommand(tabId, {
			operation: "verify",
			fingerprint: text(command.fingerprint, "FINGERPRINT"),
		});
	if (command.type === "SCREENSHOT") {
		const observed = observationFor(tabId);
		await chrome.tabs.update(tabId, { active: true });
		const dataUrl = await chrome.tabs.captureVisibleTab(observed.windowId, {
			format: "png",
		});
		const bytes = new TextEncoder().encode(dataUrl);
		const digest = await crypto.subtle.digest("SHA-256", bytes);
		const hex = [...new Uint8Array(digest)]
			.map((value) => value.toString(16).padStart(2, "0"))
			.join("");
		return {
			evidenceRef: `screenshot:sha256:${hex}`,
			dataUrl,
			mimeType: "image/png",
			sizeBytes: bytes.byteLength,
			hash: `sha256:${hex}`,
		};
	}
	const request = command.request;
	if (!isRecord(request) || !isRecord(request.input))
		throw new Error("EXECUTION_REQUEST_INVALID");
	const capability = text(request.capability, "CAPABILITY");
	if (capability === "browser.navigate") {
		const url = text(request.input.url, "URL");
		const parsed = new URL(url);
		if (parsed.protocol !== "https:" || parsed.hostname !== "chatgpt.com")
			throw new Error("URL_SCOPE_DENIED");
		const before = sessions.get(tabId)?.contentInstanceId;
		await chrome.tabs.update(tabId, { url });
		return waitForObservation(
			tabId,
			(value) => before === undefined || value.contentInstanceId !== before,
		);
	}
	if (capability === "browser.input" || capability === "browser.click") {
		await contentCommand(tabId, {
			operation: capability === "browser.input" ? "input" : "click",
			selector: text(request.input.selector, "SELECTOR"),
			...(capability === "browser.input"
				? { value: text(request.input.value, "VALUE") }
				: {}),
		});
		return waitForObservation(tabId);
	}
	if (capability === "browser.submit") {
		await contentCommand(tabId, {
			operation: "submit",
			...(typeof request.input.selector === "string"
				? { selector: request.input.selector }
				: {}),
			value: text(request.input.fingerprint, "FINGERPRINT"),
			fingerprint: text(request.input.fingerprint, "FINGERPRINT"),
		});
		return waitForObservation(tabId);
	}
	if (capability === "browser.wait") {
		const timeoutMs = numeric(request.input.timeoutMs, "TIMEOUT");
		const end = Date.now() + timeoutMs;
		while (Date.now() < end) {
			const observed = await contentCommand(tabId, { operation: "observe" });
			if (isRecord(observed) && observed.pageState === "IDLE") return observed;
			await sleep(250);
		}
		throw new Error("WAIT_TIMEOUT");
	}
	throw new Error("BROWSER_PRIMITIVE_UNAVAILABLE");
}

function missingProvisioningReceiver(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.includes("Could not establish connection") ||
		message.includes("Receiving end does not exist")
	);
}

function isEditorUrl(url: string | undefined): boolean {
	return (
		url === "https://chatgpt.com/gpts/editor" ||
		Boolean(url?.startsWith("https://chatgpt.com/gpts/editor/"))
	);
}

async function provisioningContentCommand(
	tabId: number,
	operation: ProvisioningOperation,
	request: Record<string, unknown>,
): Promise<unknown> {
	let receiverReloaded = false;
	for (let attempt = 0; attempt < 60; attempt += 1) {
		let response: unknown;
		try {
			response = await chrome.tabs.sendMessage(tabId, {
				type: "PROFLOW_PROVISIONING_COMMAND",
				operation,
				request,
			});
		} catch (error) {
			if (!receiverReloaded && missingProvisioningReceiver(error)) {
				try {
					const tab = await chrome.tabs.get(tabId);
					if (tab.status === "complete" && isEditorUrl(tab.url)) {
						await chrome.tabs.reload(tabId);
						receiverReloaded = true;
					}
				} catch {}
			}
			if (attempt === 59) throw error;
			await sleep(250);
			continue;
		}
		if (!isRecord(response) || response.ok !== true) {
			const detail =
				isRecord(response) && typeof response.error === "string"
					? response.error
					: "PROVISIONING_CONTENT_FAILED";
			if (
				(detail === "PROVISIONING_SURFACE_NOT_READY" ||
					detail === "GPT_EDITOR_CONFIGURE_SURFACE_NOT_READY") &&
				attempt < 59
			) {
				await sleep(250);
				continue;
			}
			throw new Error(detail);
		}
		return response.value;
	}
	throw new Error("PROVISIONING_CONTENT_TIMEOUT");
}

async function executeProvisioningCommand(
	command: ProvisioningBridgeCommand,
): Promise<unknown> {
	if (!isRecord(command.request))
		throw new Error("PROVISIONING_COMMAND_INVALID");
	let editorUrl = "https://chatgpt.com/gpts/editor";
	if (command.type === "FINALIZE_CUSTOM_GPT_AUTH") {
		const carrierUrl = new URL(text(command.request.carrierUrl, "CARRIER_URL"));
		const match = /^\/g\/(g-[A-Za-z0-9_-]+)$/.exec(carrierUrl.pathname);
		if (
			carrierUrl.origin !== "https://chatgpt.com" ||
			carrierUrl.username !== "" ||
			carrierUrl.password !== "" ||
			carrierUrl.search !== "" ||
			carrierUrl.hash !== "" ||
			!match?.[1]
		)
			throw new Error("PROVISIONING_CARRIER_URL_INVALID");
		editorUrl = `https://chatgpt.com/gpts/editor/${match[1]}`;
	}
	const tab = await chrome.tabs.create({ url: editorUrl, active: true });
	return provisioningContentCommand(
		numeric(tab.id, "TAB_ID"),
		command.type,
		command.request,
	);
}
async function bridgeFetch(
	config: BridgeConfig,
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	return fetch(`${config.endpoint}${path}`, {
		...init,
		signal: init.signal ?? AbortSignal.timeout(BROWSER_BRIDGE_FETCH_TIMEOUT_MS),
		headers: {
			authorization: `Bearer ${config.token}`,
			"content-type": "application/json",
			...(init.headers ?? {}),
		},
	});
}

let bridgeLoopStarted = false;
async function runBridgeLoop() {
	if (bridgeLoopStarted) return;
	bridgeLoopStarted = true;
	while (true) {
		const config = await bridgeConfig().catch(() => null);
		if (!config) {
			await sleep(1_000);
			continue;
		}
		const query = `?extensionInstanceId=${encodeURIComponent(extensionInstanceId)}`;
		try {
			const hello = await bridgeFetch(config, "/v1/session/hello", {
				method: "POST",
				body: JSON.stringify({
					extensionId: chrome.runtime.id,
					extensionInstanceId,
				}),
			});
			if (!hello.ok) throw new Error("BRIDGE_HELLO_REJECTED");
			// Hello only establishes a session. The first inner-loop action must be
			// a real command poll so Runtime readiness cannot be granted by hello alone.
			let lastHeartbeatAt = Date.now();
			let lastExtensionKeepaliveAt = Date.now();
			while (true) {
				if (
					Date.now() - lastExtensionKeepaliveAt >=
					BROWSER_CARRIER_KEEPALIVE_MS
				) {
					await chrome.storage.session
						.get(BROWSER_CARRIER_KEEPALIVE_KEY)
						.catch(() => ({}));
					lastExtensionKeepaliveAt = Date.now();
				}
				if (Date.now() - lastHeartbeatAt >= 5_000) {
					const heartbeat = await bridgeFetch(
						config,
						`/v1/session/heartbeat${query}`,
						{ method: "POST", body: "{}" },
					);
					if (!heartbeat.ok) throw new Error("BRIDGE_HEARTBEAT_REJECTED");
					lastHeartbeatAt = Date.now();
				}
				const response = await bridgeFetch(config, `/v1/commands/next${query}`);
				if (response.status === 204) {
					await sleep(250);
					continue;
				}
				if (!response.ok) throw new Error("BRIDGE_POLL_REJECTED");
				const command = (await response.json()) as BridgeCommand;
				let result: Record<string, unknown>;
				try {
					result = {
						commandId: command.commandId,
						ok: true,
						value: await executeCommand(command),
					};
				} catch (error) {
					result = {
						commandId: command.commandId,
						ok: false,
						error:
							error instanceof Error
								? error.message
								: "EXTENSION_COMMAND_FAILED",
					};
				}
				void emitStructuredLog({
					level: result.ok === true ? "INFO" : "WARN",
					component: "browser-carrier",
					operation: command.type,
					operationRef: command.commandId,
					status: result.ok === true ? "SUCCEEDED" : "FAILED",
					...(typeof result.error === "string"
						? {
								errorCode: normalizeLogErrorCode(
									result.error,
									"EXTENSION_COMMAND_FAILED",
								),
							}
						: {}),
					...(command.tabId === undefined ? {} : { tabId: command.tabId }),
					...(isRecord(command.request)
						? {
								...(typeof command.request.capability === "string"
									? { capability: command.request.capability }
									: {}),
								...structuredAxes(command.request),
							}
						: {}),
				});
				const reported = await bridgeFetch(
					config,
					`/v1/commands/result${query}`,
					{ method: "POST", body: JSON.stringify(result) },
				);
				if (!reported.ok) throw new Error("BRIDGE_RESULT_REJECTED");
			}
		} catch {
			await sleep(1_000);
		}
	}
}

let provisioningBridgeLoopStarted = false;
async function runProvisioningBridgeLoop() {
	if (provisioningBridgeLoopStarted) return;
	provisioningBridgeLoopStarted = true;
	while (true) {
		const config = await provisioningBridgeConfig();
		if (!config) {
			await sleep(1_000);
			continue;
		}
		const query = `?extensionInstanceId=${encodeURIComponent(extensionInstanceId)}`;
		try {
			const hello = await bridgeFetch(
				config,
				"/v1/provisioning/session/hello",
				{
					method: "POST",
					body: JSON.stringify({
						extensionId: chrome.runtime.id,
						extensionInstanceId,
					}),
				},
			);
			if (!hello.ok) throw new Error("PROVISIONING_BRIDGE_HELLO_REJECTED");
			let lastHeartbeatAt = 0;
			while (true) {
				if (Date.now() - lastHeartbeatAt >= 5_000) {
					const heartbeat = await bridgeFetch(
						config,
						`/v1/provisioning/session/heartbeat${query}`,
						{ method: "POST", body: "{}" },
					);
					if (!heartbeat.ok)
						throw new Error("PROVISIONING_BRIDGE_HEARTBEAT_REJECTED");
					lastHeartbeatAt = Date.now();
				}
				const response = await bridgeFetch(
					config,
					`/v1/provisioning/commands/next${query}`,
				);
				if (response.status === 204) {
					await sleep(250);
					continue;
				}
				if (!response.ok) throw new Error("PROVISIONING_BRIDGE_POLL_REJECTED");
				const command = (await response.json()) as ProvisioningBridgeCommand;
				const commandHeartbeat = setInterval(() => {
					void bridgeFetch(
						config,
						`/v1/provisioning/session/heartbeat${query}`,
						{ method: "POST", body: "{}" },
					).catch(() => undefined);
				}, 2_000);
				let result: Record<string, unknown>;
				try {
					result = {
						commandId: command.commandId,
						ok: true,
						value: await executeProvisioningCommand(command),
					};
				} catch (error) {
					result = {
						commandId: command.commandId,
						ok: false,
						error:
							error instanceof Error
								? error.message
								: "PROVISIONING_EXTENSION_COMMAND_FAILED",
					};
				} finally {
					clearInterval(commandHeartbeat);
				}
				const reported = await bridgeFetch(
					config,
					`/v1/provisioning/commands/result${query}`,
					{ method: "POST", body: JSON.stringify(result) },
				);
				if (!reported.ok)
					throw new Error("PROVISIONING_BRIDGE_RESULT_REJECTED");
			}
		} catch {
			await sleep(1_000);
		}
	}
}

function provisioningRelayBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 0x8000)
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	return btoa(binary);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
		void fetch(parsed.toString(), { cache: "no-store" }).then(
			async (response) => {
				if (!response.ok) {
					sendResponse({
						ok: false,
						error: `KNOWLEDGE_RELAY_FETCH_FAILED:${response.status}`,
					});
					return;
				}
				const bytes = new Uint8Array(await response.arrayBuffer());
				sendResponse({ ok: true, base64: provisioningRelayBase64(bytes) });
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
		const previous = sessions.get(sender.tab.id);
		const observed: ContentObservation = {
			...message.observation,
			tabId: sender.tab.id,
			windowId: sender.tab.windowId,
		};
		sessions.set(sender.tab.id, observed);
		void persistSnapshot();
		if (shouldTriggerObserverRecovery(previous, observed))
			void runObserverRecovery();
		sendResponse({ accepted: true, extensionInstanceId });
		return;
	}
	if (message.type === "PROFLOW_SIDE_PANEL_SNAPSHOT") {
		void Promise.all([
			taskApplicationConfig(),
			approvalApplicationConfig(),
			loadSystemObserverState().catch(() => null),
		]).then(([application, approval, observerState]) =>
			sendResponse({
				extensionInstanceId,
				observedAt: new Date().toISOString(),
				sessions: [...sessions.values()],
				taskApplicationConfigured: application !== null,
				approvalApplicationConfigured: approval !== null,
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
	if (message.type === "PROFLOW_APPROVAL_APPLICATION") {
		if (typeof message.operation !== "string" || !message.input) {
			sendResponse({
				ok: false,
				error: "APPROVAL_APPLICATION_MESSAGE_INVALID",
			});
			return;
		}
		void invokeApprovalApplication(message.operation, message.input).then(
			(value) => {
				if (
					(message.operation === "approval.allow" ||
						message.operation === "approval.deny" ||
						message.operation === "approval.revoke") &&
					isRecord(value) &&
					typeof value.approvalRef === "string" &&
					typeof value.taskId === "string" &&
					typeof value.workerRef === "string"
				)
					void taskObserver
						.drive(value.taskId, {
							trigger: "RECOVERY_RESUME",
							ref: value.approvalRef,
							targetWorkerRef: value.workerRef,
						})
						.catch(() => undefined);
				sendResponse({ ok: true, value });
			},
			(error: unknown) =>
				sendResponse({
					ok: false,
					error:
						error instanceof Error
							? error.message
							: "APPROVAL_APPLICATION_FAILED",
				}),
		);
		return true;
	}
	if (message.type === "PROFLOW_TASK_APPLICATION") {
		if (typeof message.operation !== "string" || !message.input) {
			sendResponse({ ok: false, error: "TASK_APPLICATION_MESSAGE_INVALID" });
			return;
		}
		void invokeTaskApplication(message.operation, message.input).then(
			(value) => {
				void runObserverRecovery();
				sendResponse({ ok: true, value });
			},
			(error: unknown) =>
				sendResponse({
					ok: false,
					error:
						error instanceof Error ? error.message : "TASK_APPLICATION_FAILED",
				}),
		);
		return true;
	}
});

async function openTaskPage(): Promise<void> {
	const bridge = await bridgeConfig();
	if (bridge) {
		try {
			const response = await fetch(`${bridge.endpoint}/v1/tasks/session`, {
				method: "POST",
				headers: { authorization: `Bearer ${bridge.token}` },
			});
			const body = (await response.json()) as unknown;
			if (
				response.ok &&
				isRecord(body) &&
				typeof body.url === "string" &&
				body.url.startsWith(`${bridge.endpoint}/tasks/bootstrap/`)
			) {
				const webUrl = `${bridge.endpoint}/tasks`;
				const [existing] = await chrome.tabs.query({ url: webUrl, currentWindow: true });
				if (existing?.id !== undefined) {
					await chrome.tabs.update(existing.id, { url: body.url, active: true });
				} else {
					await chrome.tabs.create({ url: body.url, active: true });
				}
				return;
			}
		} catch {
			/* bridge-unavailable fallback keeps the extension-owned Task UI reachable */
		}
	}
	const fallbackUrl = chrome.runtime.getURL("extension/tasks.html");
	const [fallback] = await chrome.tabs.query({
		url: fallbackUrl,
		currentWindow: true,
	});
	if (fallback?.id !== undefined) {
		await chrome.tabs.update(fallback.id, { active: true });
		return;
	}
	await chrome.tabs.create({ url: fallbackUrl, active: true });
}

async function startBackgroundRuntime(): Promise<void> {
	await bootstrapManagedRuntimeConfig();
	await persistSnapshot();
	void runBridgeLoop();
	void runProvisioningBridgeLoop();
	void runObserverRecovery();
}

chrome.action.onClicked.addListener(() => {
	void openTaskPage();
});
chrome.runtime.onInstalled.addListener(() => {
	void bootstrapManagedRuntimeConfig().then(async () => {
		await persistSnapshot();
		void runBridgeLoop();
		void runObserverRecovery();
	});
});
chrome.runtime.onStartup.addListener(() => {
	sessions.clear();
	void bootstrapManagedRuntimeConfig().then(async () => {
		await persistSnapshot();
		void runBridgeLoop();
		void runObserverRecovery();
	});
});
void startBackgroundRuntime();
