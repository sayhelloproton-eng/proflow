import {
	createCollaborationCarrierApplication,
	createSystemObserver,
	createTaskObserver,
	type SystemObserverReasonRequest,
	type SystemObserverReasonResult,
	type SystemObserverView,
	type TaskDriveProjection,
	type TaskObserverDiagnosticAssessment,
} from "../src/index.js";

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
		| "PROFLOW_TASK_APPLICATION";
	observation?: Omit<ContentObservation, "tabId" | "windowId">;
	operation?: string;
	input?: Record<string, unknown>;
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
type ChromeTab = { id?: number; windowId?: number; url?: string };
type ChromeRuntime = {
	runtime: {
		id: string;
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
		session: { set(value: Record<string, unknown>): Promise<void> };
		local: {
			get(key: string): Promise<Record<string, unknown>>;
			set(value: Record<string, unknown>): Promise<void>;
		};
	};
	sidePanel: {
		setPanelBehavior(options: {
			openPanelOnActionClick: boolean;
		}): Promise<void>;
	};
	tabs: {
		query(query: { url?: string }): Promise<ChromeTab[]>;
		create(create: { url: string; active: boolean }): Promise<ChromeTab>;
		update(
			tabId: number,
			update: { url?: string; active?: boolean },
		): Promise<ChromeTab>;
		sendMessage(tabId: number, message: ContentCommand): Promise<unknown>;
		captureVisibleTab(
			windowId: number,
			options: { format: "png" },
		): Promise<string>;
	};
};
declare const chrome: ChromeRuntime;

const extensionInstanceId = `extension:${crypto.randomUUID()}`;
const sessions = new Map<number, ContentObservation>();

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

async function bridgeConfig(): Promise<BridgeConfig | null> {
	const stored = await chrome.storage.local.get("proflowRuntimeBridge");
	return parseConfig(stored.proflowRuntimeBridge);
}

async function taskApplicationConfig(): Promise<BridgeConfig | null> {
	const stored = await chrome.storage.local.get("proflowTaskApplication");
	return parseConfig(stored.proflowTaskApplication);
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

async function invokeObserverApplication(
	operation: string,
	input: Record<string, unknown>,
): Promise<unknown> {
	const config = await taskApplicationConfig();
	if (!config) throw new Error("OBSERVER_APPLICATION_NOT_CONFIGURED");
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
	return body;
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
			})) as TaskObserverDiagnosticAssessment;
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
		})) as SystemObserverReasonResult;
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
function runObserverRecovery() {
	if (observerRecoveryInFlight) return observerRecoveryInFlight;
	observerRecoveryInFlight = (async () => {
		await collaborationCarrier.recoverPending(50).catch(() => undefined);
		const listed = await invokeTaskApplication("task.list", {});
		if (isRecord(listed) && Array.isArray(listed.tasks)) {
			for (const candidate of listed.tasks.slice(0, 100)) {
				if (!isRecord(candidate) || typeof candidate.taskId !== "string")
					continue;
				if (
					candidate.status === "SUCCEEDED" ||
					candidate.status === "TERMINATED"
				)
					continue;
				await taskObserver.drive(candidate.taskId).catch(() => undefined);
			}
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
		try {
			await contentCommand(tabId, {
				operation: "submit",
				value: text(command.text, "TEXT"),
				fingerprint: text(command.fingerprint, "FINGERPRINT"),
			});
		} catch (error) {
			const replacement = await waitForObservation(
				tabId,
				(value) => value.contentInstanceId !== before.contentInstanceId,
			).catch(() => null);
			if (!replacement) throw error;
		}
		return waitForObservation(tabId);
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
		const digest = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(dataUrl),
		);
		const hex = [...new Uint8Array(digest)]
			.map((value) => value.toString(16).padStart(2, "0"))
			.join("");
		return { evidenceRef: `screenshot:sha256:${hex}` };
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

async function bridgeFetch(
	config: BridgeConfig,
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	return fetch(`${config.endpoint}${path}`, {
		...init,
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
		const config = await bridgeConfig();
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
			let lastHeartbeatAt = 0;
			while (true) {
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
		sessions.set(sender.tab.id, observed);
		void persistSnapshot();
		if (observed.pageState === "IDLE") void runObserverRecovery();
		sendResponse({ accepted: true, extensionInstanceId });
		return;
	}
	if (message.type === "PROFLOW_SIDE_PANEL_SNAPSHOT") {
		void taskApplicationConfig().then((application) =>
			sendResponse({
				extensionInstanceId,
				observedAt: new Date().toISOString(),
				sessions: [...sessions.values()],
				taskApplicationConfigured: application !== null,
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

chrome.runtime.onInstalled.addListener(() => {
	void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
	void runBridgeLoop();
	void runObserverRecovery();
});
chrome.runtime.onStartup.addListener(() => {
	sessions.clear();
	void persistSnapshot();
	void runBridgeLoop();
	void runObserverRecovery();
});
void persistSnapshot();
void runBridgeLoop();
void runObserverRecovery();
