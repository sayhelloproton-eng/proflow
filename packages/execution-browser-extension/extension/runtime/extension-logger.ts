import type { BrowserStructuredLogEntry } from "./application-client.js";

export type OperationEventStatus =
	| "STARTED"
	| "SUCCEEDED"
	| "FAILED"
	| "BLOCKED"
	| "DEFERRED"
	| "UNKNOWN"
	| "CANCELLED";
export type OperationSideEffectState =
	| "NOT_STARTED"
	| "STARTED"
	| "APPLIED"
	| "NOT_APPLIED"
	| "UNKNOWN";
export type OperationCorrelationKind = "EXACT" | "IDENTITY_MATCH" | "ADJACENT";

export type ExtensionOperationEventInput = {
	component: string;
	event: string;
	level?: "DEBUG" | "INFO" | "WARN" | "ERROR";
	status: OperationEventStatus;
	phase?: string;
	correlationKind?: OperationCorrelationKind;
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
	contentInstanceId?: string;
	browserSessionEpoch?: number;
	capability?: string;
	operationId?: string;
	decision?: string;
	reason?: string;
	action?: string;
	errorCode?: string;
	sideEffectState?: OperationSideEffectState;
	durationMs?: number;
};

export type ExtensionOperationEvent = ExtensionOperationEventInput & {
	contract: "proflow.operation-event.v1";
	eventId: string;
	sequenceNo: number;
	timestamp: string;
	source: "browser-extension";
	extensionInstanceId: string;
	moduleVersion: string;
	correlationKind: OperationCorrelationKind;
};

type StoragePort = {
	get(key: string): Promise<Record<string, unknown>>;
	set(value: Record<string, unknown>): Promise<void>;
};

type PersistedState = {
	nextSequence: number;
	events: ExtensionOperationEvent[];
	droppedEvents?: number;
	lastFlushAt?: string;
	lastFlushErrorCode?: string;
};

const stateKey = "proflowOperationEventBufferV1";
const safeCodePattern = /^[A-Z][A-Z0-9_.:-]{0,159}$/;
const safeTokenPattern = /^[A-Za-z0-9_.:@/><-]{1,240}$/;
const failureStatuses = new Set<OperationEventStatus>([
	"FAILED",
	"BLOCKED",
	"UNKNOWN",
	"CANCELLED",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function safeRef(value: unknown, max = 240): string | undefined {
	return typeof value === "string" &&
		value.length > 0 &&
		value.length <= max &&
		safeTokenPattern.test(value)
		? value
		: undefined;
}
function safeCode(value: unknown): string | undefined {
	return typeof value === "string" && safeCodePattern.test(value)
		? value
		: undefined;
}
function safeToken(value: unknown): string | undefined {
	return typeof value === "string" && safeTokenPattern.test(value)
		? value
		: undefined;
}
function sanitizeConversationLocator(value: string): string {
	try {
		const locator = new URL(value);
		if (!["http:", "https:"].includes(locator.protocol))
			return "[REDACTED_INVALID_LOCATOR]";
		locator.username = "";
		locator.password = "";
		locator.search = "";
		locator.hash = "";
		return locator.toString();
	} catch {
		return "[REDACTED_INVALID_LOCATOR]";
	}
}
function normalizeStoredEvent(value: unknown): ExtensionOperationEvent | null {
	if (!isRecord(value)) return null;
	if (
		value.contract !== "proflow.operation-event.v1" ||
 Number.isNaN(Date.parse(String(value.timestamp))) ||
 (value.sideEffectState !== undefined && !["NOT_STARTED","STARTED","APPLIED","NOT_APPLIED","UNKNOWN"].includes(String(value.sideEffectState))) ||
 (value.level !== undefined && !["DEBUG","INFO","WARN","ERROR"].includes(String(value.level))) ||
 Object.entries(value).some(([key,item]) => new Set(["sequenceNo","runNo","attemptNo","tabId","browserSessionEpoch","durationMs"]).has(key) ? typeof item !== "number" || !Number.isFinite(item) || item < 0 || (key !== "durationMs" && !Number.isSafeInteger(item)) : typeof item !== "string") ||
		value.source !== "browser-extension" ||
		typeof value.eventId !== "string" ||
		!Number.isInteger(value.sequenceNo) ||
		typeof value.timestamp !== "string" ||
		typeof value.component !== "string" ||
		typeof value.event !== "string" ||
		typeof value.status !== "string" ||
		typeof value.extensionInstanceId !== "string" ||
		typeof value.moduleVersion !== "string" ||
		JSON.stringify(value).length > 16_384 ||
		![
			"STARTED",
			"SUCCEEDED",
			"FAILED",
			"BLOCKED",
			"DEFERRED",
			"UNKNOWN",
			"CANCELLED",
		].includes(String(value.status)) ||
		!["EXACT", "IDENTITY_MATCH", "ADJACENT"].includes(
			String(value.correlationKind),
		) ||
		Object.entries(value).some(
			([key, item]) =>
				typeof item === "string" &&
				key !== "conversationLocator" &&
				key !== "timestamp" &&
				!safeToken(item),
		)
	)
		return null;
	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) =>
				new Set([
					"contract",
					"eventId",
					"sequenceNo",
					"timestamp",
					"source",
					"extensionInstanceId",
					"moduleVersion",
					"component",
					"event",
					"level",
					"status",
					"phase",
					"correlationKind",
					"correlationId",
					"taskId",
					"nodeId",
					"runNo",
					"agentPackageRef",
					"roleRef",
					"workerRef",
					"executionRef",
					"messageRef",
					"artifactRef",
					"evidenceRef",
					"conversationLocator",
					"operationRef",
					"attemptNo",
					"tabId",
					"contentInstanceId",
					"browserSessionEpoch",
					"capability",
					"operationId",
					"decision",
					"reason",
					"action",
					"errorCode",
					"sideEffectState",
					"durationMs",
				]).has(key),
			)
			.map(([key, item]) => [
				key,
				key === "conversationLocator" && typeof item === "string"
					? sanitizeConversationLocator(item)
					: item,
			]),
	) as ExtensionOperationEvent;
}
function normalizeErrorCode(error: unknown, fallback: string): string {
	const value =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: undefined;
	return safeCode(value) ?? fallback;
}

export function createExtensionLogger(options: {
	storage: StoragePort;
	getExtensionInstanceId(): string;
	moduleVersion: string;
	remoteWrite(entry: BrowserStructuredLogEntry): Promise<void>;
	limit?: number;
	now?: () => Date;
	idFactory?: () => string;
}) {
	const limit = Math.max(100, Math.min(2_000, options.limit ?? 1_000));
	const now = options.now ?? (() => new Date());
	const idFactory = options.idFactory ?? (() => crypto.randomUUID());
	let state: PersistedState = { nextSequence: 1, events: [] };
	let loaded = false;
	let loadFlight: Promise<void> | null = null;
	let stateTail = Promise.resolve();
	let flushFlight: Promise<void> | null = null;
	let pendingEmits = 0;

	const load = (): Promise<void> => {
		if (loaded) return Promise.resolve();
		if (loadFlight) return loadFlight;
		loadFlight = (async () => {
			try {
				const stored = await options.storage.get(stateKey);
				const raw = stored[stateKey];
				if (isRecord(raw)) {
					const events = Array.isArray(raw.events)
						? raw.events
								.flatMap((item) => {
									const event = normalizeStoredEvent(item);
									return event ? [event] : [];
								})
								.slice(-limit)
						: [];
					const maxSequence = events.reduce(
						(max, event) => Math.max(max, event.sequenceNo),
						0,
					);
					state = {
						droppedEvents: (Number.isSafeInteger(raw.droppedEvents) ? Number(raw.droppedEvents) : 0) + (Array.isArray(raw.events) ? raw.events.length - events.length : 0),
						nextSequence:
							Number.isInteger(raw.nextSequence) &&
							Number(raw.nextSequence) > maxSequence
								? Number(raw.nextSequence)
								: maxSequence + 1,
						events,
						...(typeof raw.lastFlushAt === "string"
							? { lastFlushAt: raw.lastFlushAt }
							: {}),
						...(safeCode(raw.lastFlushErrorCode)
							? { lastFlushErrorCode: String(raw.lastFlushErrorCode) }
							: {}),
					};
				}
			} catch {
				state.lastFlushErrorCode = "LOG_STORAGE_UNAVAILABLE";
			} finally {
				loaded = true;
			}
		})();
		return loadFlight;
	};
	const persist = async () => {
		try {
			await options.storage.set({ [stateKey]: structuredClone(state) });
		} catch {
			state.lastFlushErrorCode = "LOG_STORAGE_UNAVAILABLE";
		}
	};
	const serialize = <T>(work: () => Promise<T>): Promise<T> => {
		const run = stateTail.then(work, work);
		stateTail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	};

	const makeEvent = (
		input: ExtensionOperationEventInput,
	): ExtensionOperationEvent => {
		const sequenceNo = state.nextSequence;
		state.nextSequence += 1;
		const correlationId = safeRef(input.correlationId);
		const conversationLocator = input.conversationLocator
			? sanitizeConversationLocator(input.conversationLocator)
			: undefined;
		return {
			contract: "proflow.operation-event.v1",
			eventId: `browser-event:${idFactory()}`,
			sequenceNo,
			timestamp: now().toISOString(),
			source: "browser-extension",
			extensionInstanceId: options.getExtensionInstanceId(),
			moduleVersion: options.moduleVersion,
			component: safeToken(input.component) ?? "browser-extension",
			event: safeCode(input.event) ?? "BROWSER_EVENT_INVALID",
			level: input.level ?? "INFO",
			status: input.status,
			correlationKind:
				input.correlationKind ?? (correlationId || input.operationRef ? "EXACT" : "ADJACENT"),
			...(safeToken(input.phase) ? { phase: input.phase } : {}),
			...(correlationId ? { correlationId } : {}),
			...(safeRef(input.taskId) ? { taskId: input.taskId } : {}),
			...(safeRef(input.nodeId) ? { nodeId: input.nodeId } : {}),
			...(Number.isInteger(input.runNo) && Number(input.runNo) >= 0
				? { runNo: Number(input.runNo) }
				: {}),
			...(safeRef(input.agentPackageRef)
				? { agentPackageRef: input.agentPackageRef }
				: {}),
			...(safeRef(input.roleRef) ? { roleRef: input.roleRef } : {}),
			...(safeRef(input.workerRef) ? { workerRef: input.workerRef } : {}),
			...(safeRef(input.executionRef)
				? { executionRef: input.executionRef }
				: {}),
			...(safeRef(input.messageRef) ? { messageRef: input.messageRef } : {}),
			...(safeRef(input.artifactRef) ? { artifactRef: input.artifactRef } : {}),
			...(safeRef(input.evidenceRef) ? { evidenceRef: input.evidenceRef } : {}),
			...(conversationLocator ? { conversationLocator } : {}),
			...(safeRef(input.operationRef)
				? { operationRef: input.operationRef }
				: {}),
			...(Number.isInteger(input.attemptNo) && Number(input.attemptNo) >= 0
				? { attemptNo: Number(input.attemptNo) }
				: {}),
			...(Number.isInteger(input.tabId) && Number(input.tabId) >= 0
				? { tabId: Number(input.tabId) }
				: {}),
			...(safeRef(input.contentInstanceId)
				? { contentInstanceId: input.contentInstanceId }
				: {}),
			...(Number.isInteger(input.browserSessionEpoch) &&
			Number(input.browserSessionEpoch) >= 0
				? { browserSessionEpoch: Number(input.browserSessionEpoch) }
				: {}),
			...(safeToken(input.capability) ? { capability: input.capability } : {}),
			...(safeToken(input.operationId)
				? { operationId: input.operationId }
				: {}),
			...(safeCode(input.decision) ? { decision: input.decision } : {}),
			...(safeCode(input.reason) ? { reason: input.reason } : {}),
			...(safeToken(input.action) ? { action: input.action } : {}),
			...(safeCode(input.errorCode) ? { errorCode: input.errorCode } : {}),
			...(input.sideEffectState
				? { sideEffectState: input.sideEffectState }
				: {}),
			...(typeof input.durationMs === "number" &&
			Number.isFinite(input.durationMs) &&
			input.durationMs >= 0
				? { durationMs: input.durationMs }
				: {}),
		};
	};

	const remoteProjection = (
		event: ExtensionOperationEvent,
	): BrowserStructuredLogEntry => ({
		...event,
		level: event.level ?? "INFO",
		operation: event.decision
			? `${event.event}:${event.decision}`
			: event.event,
	});

	const flush = (): Promise<void> => {
		if (flushFlight) return flushFlight;
		let drained = false;
		flushFlight = (async () => {
			await load();
			while (true) {
				const next = await serialize(async () => state.events[0] ?? null);
				if (!next) {
					drained = true;
					return;
				}
				try {
					await options.remoteWrite(remoteProjection(next));
					await serialize(async () => {
						if (state.events[0]?.eventId === next.eventId) state.events.shift();
						state.lastFlushAt = now().toISOString();
						delete state.lastFlushErrorCode;
						await persist();
					});
				} catch (error) {
					await serialize(async () => {
						state.lastFlushErrorCode = normalizeErrorCode(
							error,
							"LOG_SINK_UNAVAILABLE",
						);
						await persist();
					});
					return;
				}
			}
		})()
			.catch(() => {
				state.lastFlushErrorCode = "LOG_SINK_UNAVAILABLE";
			})
			.finally(() => {
				flushFlight = null;
				if (drained && state.events.length) void flush();
			});
		return flushFlight;
	};

	return Object.freeze({
		async emit(input: ExtensionOperationEventInput): Promise<void> {
			if (pendingEmits >= limit) {
				state.droppedEvents = (state.droppedEvents ?? 0) + 1;
				return;
			}
			pendingEmits++;
			try {
				await serialize(async () => {
					await load();
					state.events.push(makeEvent(input));
					while (
						state.events.length > limit ||
						JSON.stringify(state.events).length > 1_000_000 ||
						(state.events[0] &&
							Date.parse(state.events[0].timestamp) <
								now().getTime() - 7 * 86400_000)
					) {
						state.events.shift();
						state.droppedEvents = (state.droppedEvents ?? 0) + 1;
					}
					await persist();
				});
			} finally {
				pendingEmits--;
			}
			void flush();
		},
		flush,
		async snapshot() {
			await load();
			return {
				contract: "proflow.browser-observability-snapshot.v1",
				bufferedEvents: state.events.length,
				droppedEvents: state.droppedEvents ?? 0,
				nextSequence: state.nextSequence,
				lastEvent: state.events.at(-1) ?? null,
				lastFlushAt: state.lastFlushAt ?? null,
				lastFlushErrorCode: state.lastFlushErrorCode ?? null,
			};
		},
	});
}

export type ExtensionLogger = ReturnType<typeof createExtensionLogger>;
