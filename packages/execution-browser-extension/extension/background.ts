import {
	createBrowserReconnectOwner,
	restoreBrowserSessionIdentity,
} from "../src/browser-session-reconnect.js";
import { createCarrierAttentionRegistry } from "../src/carrier-attention.js";
import {
	type CarrierContinuationDenial,
	createCarrierContinuationControl,
} from "../src/carrier-continuation-control.js";
import {
	createBrowserOpenObservationGate,
	parseChatGptCarrierIdentity,
} from "../src/carrier-identity.js";
import type {
	ActionPermissionFacts,
	PermissionSemanticAction,
} from "../src/carrier-permission.js";
import { createCarrierPermissionAttemptRegistry } from "../src/carrier-permission-attempt.js";
import {
	type CarrierPermissionDecision,
	resolveHumanCarrierPermission,
	resolveRoutineCarrierPermission,
} from "../src/carrier-permission-lifecycle.js";
import { createCollaborationCarrierApplication } from "../src/collaboration-carrier.js";
import { createObserverRecoveryRearm } from "../src/observer-recovery-rearm.js";
import {
	boundedRecoveryObservation,
	shouldTriggerObserverRecovery,
} from "../src/recovery-trigger.js";
import {
	createSystemObserver,
	type SystemObserverReasonFailure,
	type SystemObserverReasonRequest,
	type SystemObserverReasonResult,
	type SystemObserverView,
} from "../src/system-observer.js";

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
	blockerFacts?: ActionPermissionFacts;
	observedAt: string;
};
type RuntimeMessage = {
	type:
		| "PROFLOW_CONTENT_OBSERVATION"
		| "PROFLOW_SIDE_PANEL_SNAPSHOT"
		| "PROFLOW_TASK_APPLICATION"
		| "PROFLOW_APPROVAL_APPLICATION"
		| "PROFLOW_CARRIER_ATTENTION_ACTION"
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
		| "PERFORM"
		| "CARRIER_ATTENTION_ACTION"
		| "WAKE_GUARD";
	tabId?: number;
	url?: string;
	text?: string;
	fingerprint?: string;
	request?: Record<string, unknown>;
	attentionRef?: string;
	action?: "allowOnce" | "deny";
	taskId?: string;
	roleRef?: string;
	workerRef?: string;
	conversationLocator?: string;
	wakeGuard?: { taskId: string; roleRef: string; workerRef: string; conversationLocator: string };
};
type ContentSnapshotRequest = { type: "PROFLOW_PAGE_SNAPSHOT_REQUEST" };
type ContentCommand = {
	type: "PROFLOW_PAGE_COMMAND";
	contentInstanceId: string;
	expectedUrl: string;
	operation:
		| "observe"
		| "input"
		| "click"
		| "submit"
		| "verify"
		| "permissionAction";
	selector?: string;
	value?: string;
	fingerprint?: string;
	permissionFingerprint?: string;
	permissionAction?: PermissionSemanticAction;
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
	alarms: {
		get(name: string): Promise<{ name: string } | undefined>;
		create(name: string, info: { periodInMinutes: number }): Promise<void>;
		onAlarm: { addListener(listener: (alarm: { name: string }) => void): void };
	};
	runtime: {
		id: string;
		getManifest(): { version: string };
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
		setBadgeText(details: { text: string }): Promise<void>;
		setTitle(details: { title: string }): Promise<void>;
	};
	notifications: {
		create(
			notificationId: string,
			options: {
				type: "basic";
				iconUrl: string;
				title: string;
				message: string;
			},
		): Promise<string>;
	};
	tabs: {
		query(query: {
			url?: string;
			currentWindow?: boolean;
		}): Promise<ChromeTab[]>;
		get(tabId: number): Promise<ChromeTab>;
		create(create: { url: string; active: boolean }): Promise<ChromeTab>;
		reload(tabId: number): Promise<void>;
		update(
			tabId: number,
			update: { url?: string; active?: boolean },
		): Promise<ChromeTab>;
		sendMessage(
			tabId: number,
			message:
				| ContentCommand
				| ContentSnapshotRequest
				| ProvisioningContentCommand,
		): Promise<unknown>;
		captureVisibleTab(
			windowId: number,
			options: { format: "png" },
		): Promise<string>;
	};
};
declare const chrome: ChromeRuntime;

let extensionInstanceId = `extension:${crypto.randomUUID()}`;
const extensionModuleVersion = chrome.runtime.getManifest().version;
const sessions = new Map<number, ContentObservation>();
const browserOpenObservationGate = createBrowserOpenObservationGate();
const permissionHandling = new Map<number, string>();
const permissionAutoAttempts = createCarrierPermissionAttemptRegistry();
const carrierAttentions = createCarrierAttentionRegistry();
const carrierContinuationControl = createCarrierContinuationControl();
const BROWSER_CARRIER_KEEPALIVE_KEY = "proflowBrowserSnapshot";
const BROWSER_CARRIER_KEEPALIVE_MS = 20_000;
const BROWSER_BRIDGE_FETCH_TIMEOUT_MS = 5_000;
const BROWSER_RECOVERY_SNAPSHOT_TIMEOUT_MS = 1_000;
let snapshotPersistence = Promise.resolve();
let transientPermissionAttemptsRestore: Promise<boolean> | null = null;

const sleep = (milliseconds: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function persistSnapshot(): Promise<void> {
	const value = {
		proflowBrowserSnapshot: {
			extensionInstanceId,
			observedAt: new Date().toISOString(),
			sessions: [...sessions.values()],
			permissionAutoAttempts: permissionAutoAttempts.snapshot(),
			carrierContinuationDenials: carrierContinuationControl.snapshot(),
			recoveryScan: "BOUNDED_ON_START",
		},
	};
	// Preserve invocation order so an older empty snapshot cannot overwrite a
	// later pre-click uncertainty record.
	snapshotPersistence = snapshotPersistence
		.catch(() => undefined)
		.then(() => chrome.storage.session.set(value));
	return snapshotPersistence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function restoreTransientPermissionAttempts(): Promise<boolean> {
	if (transientPermissionAttemptsRestore)
		return transientPermissionAttemptsRestore;
	transientPermissionAttemptsRestore = (async () => {
		try {
			const stored = await chrome.storage.session.get(
				BROWSER_CARRIER_KEEPALIVE_KEY,
			);
			const snapshot = stored[BROWSER_CARRIER_KEEPALIVE_KEY];
			const validSnapshot = isRecord(snapshot);
			const attemptsLoaded = permissionAutoAttempts.load(
				validSnapshot ? snapshot.permissionAutoAttempts : undefined,
			);
			const denialsLoaded = carrierContinuationControl.load(
				validSnapshot ? snapshot.carrierContinuationDenials : undefined,
			);
			return attemptsLoaded && denialsLoaded;
		} catch {
			// A later pre-click persistence failure still prevents the click. No
			// automatic-action fact is manufactured from unreadable session data.
			permissionAutoAttempts.load(undefined);
			carrierContinuationControl.load(undefined);
			return false;
		}
	})();
	return transientPermissionAttemptsRestore;
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
	proflowLocalToolBridge?: unknown;
	proflowProvisioningBridge?: unknown;
	proflowTaskApplication?: unknown;
	proflowApprovalApplication?: unknown;
};

async function bootstrapManagedRuntimeConfig(): Promise<void> {
	let response: Response;
	try {
		response = await fetch(chrome.runtime.getURL("runtime-config.json"), {
			cache: "no-store",
			signal: AbortSignal.timeout(BROWSER_BRIDGE_FETCH_TIMEOUT_MS),
		});
	} catch {
		return;
	}
	if (!response.ok) return;
	const raw = (await response.json()) as unknown;
	if (!isRecord(raw)) return;
	const managed = raw as ManagedRuntimeConfig;
	const bridge = parseConfig(managed.proflowRuntimeBridge);
	const localTools = parseConfig(managed.proflowLocalToolBridge);
	const provisioning = parseConfig(managed.proflowProvisioningBridge);
	const task = parseConfig(managed.proflowTaskApplication);
	const approval = parseConfig(managed.proflowApprovalApplication);
	if (!bridge) {
		throw new Error("MANAGED_RUNTIME_CONFIG_INVALID");
	}
	await chrome.storage.local.set({
		proflowRuntimeBridge: bridge,
		...(localTools ? { proflowLocalToolBridge: localTools } : {}),
		...(provisioning ? { proflowProvisioningBridge: provisioning } : {}),
		...(task ? { proflowTaskApplication: task } : {}),
		...(approval ? { proflowApprovalApplication: approval } : {}),
	});
}

async function bridgeConfig(): Promise<BridgeConfig | null> {
	const stored = await chrome.storage.local.get("proflowRuntimeBridge");
	return parseConfig(stored.proflowRuntimeBridge);
}

async function localToolBridgeConfig(): Promise<BridgeConfig | null> {
	const stored = await chrome.storage.local.get("proflowLocalToolBridge");
	return parseConfig(stored.proflowLocalToolBridge);
}

async function provisioningBridgeConfig(): Promise<BridgeConfig | null> {
	const stored = await chrome.storage.local.get("proflowProvisioningBridge");
	return parseConfig(stored.proflowProvisioningBridge);
}

async function resolveOwnerApplication(
	surface: "task" | "approval",
): Promise<BridgeConfig | null> {
	const config = await bridgeConfig();
	if (!config) return null;
	try {
		const response = await bridgeFetch(config, "/v1/applications/config", {
			signal: AbortSignal.timeout(2_000),
		});
		if (!response.ok) return null;
		const body: unknown = await response.json();
		return isRecord(body) ? parseConfig(body[surface]) : null;
	} catch {
		return null;
	}
}

async function taskApplicationConfig(): Promise<BridgeConfig | null> {
	const stored = await chrome.storage.local.get("proflowTaskApplication");
	return (
		parseConfig(stored.proflowTaskApplication) ??
		(await resolveOwnerApplication("task"))
	);
}

async function approvalApplicationConfig(): Promise<BridgeConfig | null> {
	const stored = await chrome.storage.local.get("proflowApprovalApplication");
	return (
		parseConfig(stored.proflowApprovalApplication) ??
		(await resolveOwnerApplication("approval"))
	);
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

function emitObserverRecoveryDiagnostic(
	status: string,
	attemptNo: number,
	operationRef: string,
): void {
	void emitStructuredLog({
		level: "INFO",
		component: "browser-observer-recovery",
		operation: "observer.recovery",
		status,
		attemptNo,
		operationRef,
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
			const recoveryTriggerRef = `bridge-session:${bridgeSessionEpoch}`;
			emitObserverRecoveryDiagnostic(
				"COLLABORATION_LIST_PENDING_BEGIN",
				observerRecoveryAttemptNo,
				recoveryTriggerRef,
			);
			try {
				return (await invokeObserverApplication("collaboration.listPending", {
					limit,
				})) as Awaited<
					ReturnType<
						Parameters<
							typeof createCollaborationCarrierApplication
						>[0]["agent"]["listPendingMessages"]
					>
				>;
			} finally {
				emitObserverRecoveryDiagnostic(
					"COLLABORATION_LIST_PENDING_SETTLED",
					observerRecoveryAttemptNo,
					recoveryTriggerRef,
				);
			}
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
let observerRecoveryTrailingRequested = false;
let observerRecoveryAttemptNo = 0;
function runObserverRecovery() {
	const recoveryTriggerRef = `bridge-session:${bridgeSessionEpoch}`;
	if (observerRecoveryInFlight) {
		observerRecoveryTrailingRequested = true;
		emitObserverRecoveryDiagnostic(
			"REUSED_IN_FLIGHT",
			observerRecoveryAttemptNo,
			recoveryTriggerRef,
		);
		return observerRecoveryInFlight;
	}
	observerRecoveryAttemptNo += 1;
	const recoveryAttemptNo = observerRecoveryAttemptNo;
	emitObserverRecoveryDiagnostic(
		"STARTED",
		recoveryAttemptNo,
		recoveryTriggerRef,
	);
	observerRecoveryInFlight = (async () => {
		emitObserverRecoveryDiagnostic(
			"COLLABORATION_RECOVERY_BEGIN",
			recoveryAttemptNo,
			recoveryTriggerRef,
		);
		await collaborationCarrier.recoverPending(50).catch(() => undefined);
		emitObserverRecoveryDiagnostic(
			"COLLABORATION_RECOVERY_SETTLED",
			recoveryAttemptNo,
			recoveryTriggerRef,
		);
		// Browser events only accelerate the backend owner; they never decide progression.
		void invokeObserverApplication("task.reconcileAll", {}).catch(
			() => undefined,
		);
		const previousSystemState = await loadSystemObserverState().catch(
			() => null,
		);
		const systemAssessment = await systemObserver
			.synthesize({
				previousUnresolved: previousSystemState?.unresolved ?? [],
				previousCarryForward: previousSystemState?.carryForward ?? [],
			})
			.catch(() => null);
		if (systemAssessment)
			await persistSystemObserverState(systemAssessment).catch(() => undefined);
	})().finally(() => {
		observerRecoveryInFlight = null;
		if (!observerRecoveryTrailingRequested) return;
		observerRecoveryTrailingRequested = false;
		void runObserverRecovery();
	});
	return observerRecoveryInFlight;
}

const observerRecoveryRearm = createObserverRecoveryRearm(() => {
	emitObserverRecoveryDiagnostic(
		"REARM_CALLBACK_ENTERED",
		bridgeSessionEpoch,
		`bridge-session:${bridgeSessionEpoch}`,
	);
	void runObserverRecovery();
});

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

function permissionAttemptKey(observed: ContentObservation): string | null {
	return observed.blockerFacts
		? `${observed.url}:${observed.blockerFacts.fingerprint}`
		: null;
}

function setCarrierAttention(
	observed: ContentObservation,
	reason: string,
): void {
	const facts = observed.blockerFacts;
	if (!facts) return;
	const identity = parseChatGptCarrierIdentity(observed.url);
	carrierAttentions.derive({
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
	void publishCarrierAttentions();
}

function carrierAttentionViews() {
	return carrierAttentions
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
}

async function publishCarrierAttentions(): Promise<void> {
	const config = await bridgeConfig().catch(() => null);
	if (!config) return;
	const query = `?extensionInstanceId=${encodeURIComponent(extensionInstanceId)}`;
	const response = await bridgeFetch(config, `/v1/carrier/attentions${query}`, {
		method: "POST",
		body: JSON.stringify({ carrierAttentions: carrierAttentionViews() }),
	});
	if (!response.ok) throw new Error("CARRIER_ATTENTION_PUBLISH_REJECTED");
}

function rawPermissionFingerprint(value: unknown): string | null {
	if (!isRecord(value) || !isRecord(value.blockerFacts)) return null;
	return typeof value.blockerFacts.fingerprint === "string"
		? value.blockerFacts.fingerprint
		: null;
}

function parsePermissionFacts(
	value: unknown,
): ActionPermissionFacts | undefined {
	if (!isRecord(value) || value.kind !== "ACTION_PERMISSION") return undefined;
	const actions = value.actions;
	if (
		(value.targetHost !== null && typeof value.targetHost !== "string") ||
		typeof value.operationId !== "string" ||
		(value.taskId !== null && typeof value.taskId !== "string") ||
		!Array.isArray(actions) ||
		actions.some(
			(action) =>
				action !== "allowAlways" && action !== "allowOnce" && action !== "deny",
		) ||
		typeof value.fingerprint !== "string"
	)
		return undefined;
	return {
		kind: "ACTION_PERMISSION",
		targetHost: value.targetHost,
		operationId: value.operationId,
		taskId: value.taskId,
		actions: [...actions],
		fingerprint: value.fingerprint,
	};
}

function parseSnapshotObservation(
	value: unknown,
	tab: ChromeTab,
): ContentObservation | null {
	if (!isRecord(value) || tab.id === undefined || tab.windowId === undefined)
		return null;
	const pageState = value.pageState;
	const activityKind = value.activityKind;
	if (
		typeof value.url !== "string" ||
		typeof value.contentInstanceId !== "string" ||
		(pageState !== "IDLE" &&
			pageState !== "BUSY" &&
			pageState !== "BLOCKED" &&
			pageState !== "UNKNOWN") ||
		(activityKind !== null &&
			activityKind !== "GENERATING" &&
			activityKind !== "ACTION_PERMISSION" &&
			activityKind !== "ACTION_RUNNING" &&
			activityKind !== "WAITING_HUMAN" &&
			activityKind !== "WAITING_PEER" &&
			activityKind !== "RECOVERING") ||
		typeof value.observedAt !== "string"
	)
		return null;
	const blockerFacts = parsePermissionFacts(value.blockerFacts);
	if (activityKind === "ACTION_PERMISSION" && blockerFacts === undefined)
		return null;
	return {
		tabId: tab.id,
		windowId: tab.windowId,
		url: value.url,
		contentInstanceId: value.contentInstanceId,
		pageState,
		activityKind,
		...(blockerFacts ? { blockerFacts } : {}),
		observedAt: value.observedAt,
	};
}

async function waitForPermissionReleased(
	tabId: number,
	fingerprint: string,
): Promise<boolean> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const current = sessions.get(tabId);
		if (current && current.blockerFacts?.fingerprint !== fingerprint)
			return true;
		try {
			const value = await contentCommand(tabId, { operation: "observe" });
			if (rawPermissionFingerprint(value) !== fingerprint) return true;
		} catch {
			// Navigation/content replacement is re-observed on the next bounded pass.
		}
		await sleep(250);
	}
	return false;
}

async function handleActionPermission(
	observed: ContentObservation,
): Promise<void> {
	const facts = observed.blockerFacts;
	const key = permissionAttemptKey(observed);
	if (
		observed.pageState !== "BLOCKED" ||
		observed.activityKind !== "ACTION_PERMISSION" ||
		!facts ||
		!key
	)
		return;
	if (permissionHandling.get(observed.tabId) === key) return;
	const existing = carrierAttentions.current(observed.tabId);
	if (
		existing?.contentInstanceId === observed.contentInstanceId &&
		existing.permissionFingerprint === facts.fingerprint
	)
		return;
	permissionHandling.set(observed.tabId, key);
	try {
		const identity = parseChatGptCarrierIdentity(observed.url);
		const humanDenied = () =>
			carrierContinuationControl.hasMatchingPermissionDenial({
				tabId: observed.tabId,
				contentInstanceId: observed.contentInstanceId,
				url: observed.url,
				permissionFingerprint: facts.fingerprint,
				taskId: facts.taskId,
				roleRef: identity?.roleRef ?? null,
				workerRef: identity?.workerRef ?? null,
			});
		if (humanDenied()) {
			setCarrierAttention(observed, "HUMAN_DENIED");
			return;
		}
		if (!(await restoreTransientPermissionAttempts())) {
			setCarrierAttention(observed, "PERMISSION_ATTEMPT_STATE_UNAVAILABLE");
			return;
		}
		if (!identity || !facts.taskId) {
			setCarrierAttention(observed, "PERMISSION_CONTEXT_INCOMPLETE");
			return;
		}
		const result = await resolveRoutineCarrierPermission({
			facts,
			autoAlreadyAttempted: permissionAutoAttempts.has(observed.tabId, key),
			humanDenied,
			port: {
				async classify(): Promise<CarrierPermissionDecision> {
					const value = await invokeObserverApplication(
						"browser.permission.classify",
						{
							taskId: facts.taskId as string,
							roleRef: identity.roleRef,
							...(identity.workerRef ? { workerRef: identity.workerRef } : {}),
							conversationLocator: observed.url,
							targetHost: facts.targetHost,
							operationId: facts.operationId,
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
					return {
						decision: value.decision,
						reason: value.reason,
					};
				},
				revalidate() {
					const current = observationFor(observed.tabId);
					return (
						current.contentInstanceId === observed.contentInstanceId &&
						current.url === observed.url &&
						current.blockerFacts?.fingerprint === facts.fingerprint
					);
				},
				waitBeforeReclassify: () => sleep(250),
				async act(action) {
					permissionAutoAttempts.begin(observed.tabId, key);
					// Persist uncertainty before the click. If the MV3 worker restarts
					// before readback, the same effect is never replayed blindly.
					await persistSnapshot();
					await contentCommand(observed.tabId, {
						operation: "permissionAction",
						permissionFingerprint: facts.fingerprint,
						permissionAction: action,
					});
				},
				released: () =>
					waitForPermissionReleased(observed.tabId, facts.fingerprint),
			},
		});
		if (result.status === "RELEASED") {
			permissionAutoAttempts.release(observed.tabId, key);
			carrierAttentions.removeTab(observed.tabId);
			void publishCarrierAttentions();
			await persistSnapshot();
			return;
		}
		if (result.status === "HUMAN_REQUIRED")
			setCarrierAttention(observed, result.reason);
	} catch {
		setCarrierAttention(observed, "AUTO_ALLOW_FAILED");
	} finally {
		if (permissionHandling.get(observed.tabId) === key)
			permissionHandling.delete(observed.tabId);
	}
}

type CarrierBlockerHandler = (observed: ContentObservation) => Promise<void>;

// The application lines consume normalized reality only. New blocker cases
// register a strategy here instead of branching Workflow/Collaboration/Observer.
const carrierBlockerStrategies: ReadonlyMap<string, CarrierBlockerHandler> =
	new Map([["ACTION_PERMISSION", handleActionPermission]]);

function handleCarrierBlocker(observed: ContentObservation): void {
	if (observed.pageState !== "BLOCKED" || observed.activityKind === null)
		return;
	const strategy = carrierBlockerStrategies.get(observed.activityKind);
	if (strategy) void strategy(observed);
}

function processContentObservation(
	observed: ContentObservation,
	triggerRecovery: boolean,
): void {
	const previous = sessions.get(observed.tabId);
	sessions.set(observed.tabId, observed);
	browserOpenObservationGate.recordReceipt(observed);
	permissionAutoAttempts.observe(
		observed.tabId,
		permissionAttemptKey(observed),
	);
	const attention = carrierAttentions.current(observed.tabId);
	if (
		attention &&
		(observed.contentInstanceId !== attention.contentInstanceId ||
			observed.url !== attention.url ||
			observed.blockerFacts?.fingerprint !== attention.permissionFingerprint)
	) {
		carrierAttentions.removeTab(observed.tabId);
		void publishCarrierAttentions();
	}
	handleCarrierBlocker(observed);
	const shouldRecover =
		triggerRecovery && shouldTriggerObserverRecovery(previous, observed);
	const suppressed =
		shouldRecover &&
		carrierContinuationControl.suppressRecovery(previous, observed);
	void persistSnapshot();
	if (shouldRecover && !suppressed) void runObserverRecovery();
}

async function rebuildCarrierAttentionsFromTabs(): Promise<
	CarrierContinuationDenial[]
> {
	const consumedDenials: CarrierContinuationDenial[] = [];
	const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/g/*" });
	const snapshots = await Promise.all(
		tabs.map(async (tab) => {
			const tabId = tab.id;
			if (tabId === undefined || tab.windowId === undefined) return null;
			const response = await boundedRecoveryObservation(
				() =>
					chrome.tabs.sendMessage(tabId, {
						type: "PROFLOW_PAGE_SNAPSHOT_REQUEST",
					}),
				BROWSER_RECOVERY_SNAPSHOT_TIMEOUT_MS,
			);
			return { tab, response };
		}),
	);
	for (const snapshot of snapshots) {
		if (!snapshot) continue;
		const { tab, response } = snapshot;
		if (!isRecord(response) || response.ok !== true) continue;
		const observed = parseSnapshotObservation(response.value, tab);
		if (observed) {
			processContentObservation(observed, false);
			const consumed = carrierContinuationControl.consumeRecovery(
				undefined,
				observed,
			);
			if (consumed) consumedDenials.push(consumed);
		}
	}
	await persistSnapshot();
	await publishCarrierAttentions().catch(() => undefined);
	return [
		...consumedDenials,
		...carrierContinuationControl
			.snapshot()
			.filter(
				(denial) =>
					!consumedDenials.some(
						(consumed) => consumed.attentionRef === denial.attentionRef,
					),
			),
	];
}

async function decideCarrierAttention(
	attentionRef: string,
	action: "allowOnce" | "deny",
): Promise<{
	attentionRef: string;
	action: "allowOnce" | "deny";
	status: "APPLIED";
}> {
	const attention = carrierAttentions.find(attentionRef);
	if (!attention?.actions.includes(action))
		throw new Error("CARRIER_ATTENTION_ACTION_DENIED");
	await resolveHumanCarrierPermission({
		action,
		revalidate() {
			const current = observationFor(attention.tabId);
			return (
				current.contentInstanceId === attention.contentInstanceId &&
				current.url === attention.url &&
				current.blockerFacts?.fingerprint === attention.permissionFingerprint
			);
		},
		async act(semanticAction) {
			if (semanticAction === "deny") {
				carrierContinuationControl.beginDenied({
					attentionRef: attention.attentionRef,
					tabId: attention.tabId,
					taskId: attention.taskId,
					roleRef: attention.roleRef,
					workerRef: attention.workerRef,
					url: attention.url,
					contentInstanceId: attention.contentInstanceId,
					permissionFingerprint: attention.permissionFingerprint,
				});
				await persistSnapshot();
			}
			try {
				await contentCommand(attention.tabId, {
					operation: "permissionAction",
					permissionFingerprint: attention.permissionFingerprint,
					permissionAction: semanticAction,
				});
			} catch (error) {
				if (semanticAction === "deny") {
					carrierContinuationControl.cancelDenied(attention.attentionRef);
					await persistSnapshot();
				}
				throw error;
			}
		},
		released: () =>
			waitForPermissionReleased(
				attention.tabId,
				attention.permissionFingerprint,
			),
	});
	permissionAutoAttempts.release(
		attention.tabId,
		`${attention.url}:${attention.permissionFingerprint}`,
	);
	carrierAttentions.delete(attention.attentionRef);
	void publishCarrierAttentions();
	await persistSnapshot();
	return { attentionRef, action, status: "APPLIED" };
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
	if (command.type === "WAKE_GUARD") {
		const denied = carrierContinuationControl.hasMatchingDispatchDenial({
			taskId: text(command.taskId, "TASK_ID"),
			roleRef: text(command.roleRef, "ROLE_REF"),
			workerRef: text(command.workerRef, "WORKER_REF"),
			conversationLocator: text(
				command.conversationLocator,
				"CONVERSATION_LOCATOR",
			),
		});
		return { allowed: !denied };
	}
	if (command.type === "CARRIER_ATTENTION_ACTION") {
		if (command.action !== "allowOnce" && command.action !== "deny")
			throw new Error("ATTENTION_ACTION_INVALID");
		return decideCarrierAttention(
			text(command.attentionRef, "ATTENTION_REF"),
			command.action,
		);
	}
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
		const boundary = browserOpenObservationGate.beginOpen(url);
		const tab = await chrome.tabs.create({ url, active: true });
		const tabId = numeric(tab.id, "TAB_ID");
		return waitForObservation(tabId, () =>
			browserOpenObservationGate.accepts(tabId, boundary),
		);
	}
	const tabId = numeric(command.tabId, "TAB_ID");
	if (command.type === "OBSERVE") {
		const value = await contentCommand(tabId, { operation: "observe" });
		const tab = await chrome.tabs.get(tabId);
		const observed = parseSnapshotObservation(value, tab);
		if (!observed) throw new Error("CONTENT_OBSERVATION_INVALID");
		return observed;
	}
	if (command.type === "SUBMIT") {
		const before = observationFor(tabId);
		const fingerprint = text(command.fingerprint, "FINGERPRINT");
			if (command.wakeGuard && carrierContinuationControl.hasMatchingDispatchDenial(command.wakeGuard)) throw new Error("CARRIER_CONTINUATION_HUMAN_DENIED");
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

let localToolBridgeLoopStarted = false;
async function showLocalToolNotices(command: Record<string, unknown>) { const notices = command.notices; if (!Array.isArray(notices)) return; const rendered = notices.filter((item): item is string => typeof item === "string" && item.length > 0); const message = rendered.join("\n").slice(0, 3500); if (!message) return; try { await chrome.notifications.create(`proflow-local-tool:${crypto.randomUUID()}`, { type: "basic", iconUrl: "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#111827"/><path d="M16 34h32M32 18v32" stroke="white" stroke-width="6" stroke-linecap="round"/></svg>'), title: "ProFlow Workspace notice", message }); } catch (error) { console.warn("PROFLOW_LOCAL_TOOL_NOTICE_FALLBACK", { commandId: command.commandId, notices: rendered, error: error instanceof Error ? error.message : String(error) }); await Promise.allSettled([chrome.action.setBadgeText({ text: "!" }), chrome.action.setTitle({ title: `ProFlow Workspace notice: ${message.slice(0, 400)}` })]); } }

async function runLocalToolBridgeLoop() {
	if (localToolBridgeLoopStarted) return;
	localToolBridgeLoopStarted = true;
	while (true) {
		const config = await localToolBridgeConfig().catch(() => null);
		if (!config) {
			await sleep(1_000);
			continue;
		}
		const query = `?extensionInstanceId=${encodeURIComponent(extensionInstanceId)}`;
		try {
			const hello = await bridgeFetch(config, "/v1/local-tools/session/hello", {
				method: "POST",
				body: JSON.stringify({
					extensionId: chrome.runtime.id,
					extensionInstanceId,
					moduleVersion: extensionModuleVersion,
				}),
			});
			if (!hello.ok) throw new Error("LOCAL_TOOL_BRIDGE_HELLO_REJECTED");
			let lastHeartbeatAt = Date.now();
			while (true) {
				if (Date.now() - lastHeartbeatAt >= 5_000) {
					const heartbeat = await bridgeFetch(
						config,
						`/v1/local-tools/session/heartbeat${query}`,
						{ method: "POST", body: "{}" },
					);
					if (!heartbeat.ok)
						throw new Error("LOCAL_TOOL_BRIDGE_HEARTBEAT_REJECTED");
					lastHeartbeatAt = Date.now();
				}
				const response = await bridgeFetch(
					config,
					`/v1/local-tools/commands/next${query}`,
				);
				if (response.status === 204) {
					await sleep(250);
					continue;
				}
				if (!response.ok) throw new Error("LOCAL_TOOL_BRIDGE_POLL_REJECTED");
				const command = (await response.json()) as unknown;
				if (!isRecord(command)) throw new Error("LOCAL_TOOL_COMMAND_INVALID");
				const commandId = command.commandId;
				const generation = command.generation;
				const commandDigest = command.commandDigest;
				if (
					typeof commandId !== "string" ||
					typeof generation !== "string" ||
					typeof commandDigest !== "string"
				)
					throw new Error("LOCAL_TOOL_COMMAND_INVALID");
				await showLocalToolNotices(command).catch(() => undefined);
				// The Extension is the physical Effect Gate. Notices are informational only:
				// execution continues immediately without approval or acknowledgement.
				const accepted = await bridgeFetch(
					config,
					`/v1/local-tools/commands/execute${query}`,
					{
						method: "POST",
						body: JSON.stringify({ commandId, generation, commandDigest }),
					},
				);
				if (accepted.status !== 202)
					throw new Error("LOCAL_TOOL_BRIDGE_EXECUTE_REJECTED");
			}
		} catch {
			await sleep(1_000);
		}
	}
}

let bridgeSessionEpoch = 0;
async function runBridgeSession(online: () => void): Promise<void> {
	const config = await bridgeConfig();
	if (!config) throw new Error("BRIDGE_NOT_CONFIGURED");
	const query = `?extensionInstanceId=${encodeURIComponent(extensionInstanceId)}`;
	const hello = await bridgeFetch(config, "/v1/session/hello", {
		method: "POST",
		body: JSON.stringify({
			extensionId: chrome.runtime.id,
			extensionInstanceId,
			moduleVersion: extensionModuleVersion,
		}),
	});
	if (!hello.ok) throw new Error("BRIDGE_HELLO_REJECTED");
	bridgeSessionEpoch += 1;
	emitObserverRecoveryDiagnostic(
		"BRIDGE_EPOCH_ACCEPTED",
		bridgeSessionEpoch,
		`bridge-session:${bridgeSessionEpoch}`,
	);
	observerRecoveryRearm.bridgeSessionEstablished(bridgeSessionEpoch);
	await publishCarrierAttentions();
	// Hello only establishes a session. The first inner-loop action must be
	// a real command poll so Runtime readiness cannot be granted by hello alone.
	let lastHeartbeatAt = Date.now();
	let lastExtensionKeepaliveAt = Date.now();
	while (true) {
		if (Date.now() - lastExtensionKeepaliveAt >= BROWSER_CARRIER_KEEPALIVE_MS) {
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
			online();
			await sleep(250);
			continue;
		}
		if (!response.ok) throw new Error("BRIDGE_POLL_REJECTED");
		online();
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
					error instanceof Error ? error.message : "EXTENSION_COMMAND_FAILED",
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
		const reported = await bridgeFetch(config, `/v1/commands/result${query}`, {
			method: "POST",
			body: JSON.stringify(result),
		});
		if (!reported.ok) throw new Error("BRIDGE_RESULT_REJECTED");
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
		const observed: ContentObservation = {
			...message.observation,
			tabId: sender.tab.id,
			windowId: sender.tab.windowId,
		};
		processContentObservation(observed, true);
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
				carrierAttentions: carrierAttentionViews(),
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
	if (message.type === "PROFLOW_CARRIER_ATTENTION_ACTION") {
		if (!message.input) {
			sendResponse({ ok: false, error: "CARRIER_ATTENTION_MESSAGE_INVALID" });
			return;
		}
		const attentionRef = message.input.attentionRef;
		const action = message.input.action;
		if (
			typeof attentionRef !== "string" ||
			(action !== "allowOnce" && action !== "deny")
		) {
			sendResponse({ ok: false, error: "CARRIER_ATTENTION_MESSAGE_INVALID" });
			return;
		}
		void decideCarrierAttention(attentionRef, action).then(
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
				const [existing] = await chrome.tabs.query({
					url: webUrl,
					currentWindow: true,
				});
				if (existing?.id !== undefined) {
					await chrome.tabs.update(existing.id, {
						url: body.url,
						active: true,
					});
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

const BROWSER_RECONNECT_ALARM = "proflow-browser-session-reconnect";
let backgroundInitialization: Promise<void> | null = null;

function initializeBackgroundRuntime(): Promise<void> {
	if (backgroundInitialization) return backgroundInitialization;
	backgroundInitialization = (async () => {
		await restoreTransientPermissionAttempts();
		await bootstrapManagedRuntimeConfig();
		extensionInstanceId = await restoreBrowserSessionIdentity(
			chrome.storage.session,
			chrome.runtime.id,
			extensionModuleVersion,
			() => `extension:${crypto.randomUUID()}`,
		);
		await persistSnapshot();
		void runLocalToolBridgeLoop();
		void runProvisioningBridgeLoop();
		// Page reconstruction must not block the connection consumer from starting.
		void rebuildCarrierAttentionsFromTabs()
			.then(() => {
				observerRecoveryRearm.startupReady();
			})
			.catch(() => undefined);
	})().catch((error: unknown) => {
		backgroundInitialization = null;
		throw error;
	});
	return backgroundInitialization;
}

const browserReconnect = createBrowserReconnectOwner({
	now: Date.now,
	sleep,
	async runSession(online) {
		await initializeBackgroundRuntime();
		await runBridgeSession(online);
	},
});
let backgroundStart: Promise<void> | null = null;
function startBackgroundRuntime(): Promise<void> {
	if (backgroundStart) return backgroundStart;
	backgroundStart = (async () => {
		// Recreate a missing alarm on every worker activation; do not postpone an
		// existing alarm when startup/install/onAlarm arrive together.
		if (!(await chrome.alarms.get(BROWSER_RECONNECT_ALARM))) {
			await chrome.alarms.create(BROWSER_RECONNECT_ALARM, {
				periodInMinutes: 1,
			});
		}
		await browserReconnect.start();
	})().finally(() => {
		backgroundStart = null;
	});
	return backgroundStart;
}
function requestBackgroundStart(): void {
	void startBackgroundRuntime().catch(() => {
		console.warn("PROFLOW_BROWSER_RECONNECT_START_FAILED");
	});
}

chrome.action.onClicked.addListener(() => {
	void openTaskPage();
});
chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === BROWSER_RECONNECT_ALARM) requestBackgroundStart();
});
chrome.runtime.onInstalled.addListener(requestBackgroundStart);
chrome.runtime.onStartup.addListener(requestBackgroundStart);
requestBackgroundStart();
