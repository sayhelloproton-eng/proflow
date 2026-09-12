import { createBrowserOpenObservationGate } from "../../src/carrier-identity.js";
import type { ActionPermissionFacts } from "../../src/carrier-permission.js";
import { recoverMissingContentReceiver } from "../../src/content-session-recovery.js";
import { boundedRecoveryObservation } from "../../src/recovery-trigger.js";
import type {
	ChromeRuntime,
	ChromeTab,
	ContentCommand,
	ContentObservation,
} from "./chrome-runtime.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rawPermissionFingerprint(value: unknown): string | null {
	if (!isRecord(value) || !isRecord(value.blockerFacts)) return null;
	return typeof value.blockerFacts.fingerprint === "string"
		? value.blockerFacts.fingerprint
		: null;
}

function parsePermissionFacts(value: unknown): ActionPermissionFacts | undefined {
	if (!isRecord(value) || value.kind !== "ACTION_PERMISSION") return undefined;
	const actions = value.actions;
	if (
		(value.targetHost !== null && typeof value.targetHost !== "string") ||
		typeof value.operationId !== "string" ||
		(value.taskId !== null && typeof value.taskId !== "string") ||
		!Array.isArray(actions) ||
		actions.some(
			(action) =>
				action !== "allowAlways" &&
				action !== "allow" &&
				action !== "allowOnce" &&
				action !== "deny",
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

export function createPageRealityController(options: {
	tabs: ChromeRuntime["tabs"];
	sleep(milliseconds: number): Promise<void>;
	injectContentScript?(tabId: number): Promise<void>;
	recoverySnapshotTimeoutMs?: number;
}) {
	const sessions = new Map<number, ContentObservation>();
	const openGate = createBrowserOpenObservationGate();
	const recoverySnapshotTimeoutMs = options.recoverySnapshotTimeoutMs ?? 1_000;

	const current = (tabId: number): ContentObservation => {
		const observed = sessions.get(tabId);
		if (!observed) throw new Error("CONTENT_SESSION_NOT_READY");
		return observed;
	};

	const waitForObservation = async (
		tabId: number,
		predicate: (value: ContentObservation) => boolean = () => true,
	): Promise<ContentObservation> => {
		for (let attempt = 0; attempt < 60; attempt += 1) {
			const observed = sessions.get(tabId);
			if (observed && predicate(observed)) return observed;
			await options.sleep(250);
		}
		throw new Error("CONTENT_SESSION_TIMEOUT");
	};

	const contentCommand = async (
		tabId: number,
		command: Omit<ContentCommand, "type" | "contentInstanceId" | "expectedUrl">,
	): Promise<unknown> => {
		const observed = current(tabId);
		const response = await options.tabs.sendMessage(tabId, {
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
	};

	const parseSnapshotObservation = (
		value: unknown,
		tab: ChromeTab,
	): ContentObservation | null => {
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
	};

	const snapshotTab = async (tab: ChromeTab): Promise<ContentObservation | null> => {
		if (tab.id === undefined || tab.windowId === undefined) return null;
		const request = () =>
			boundedRecoveryObservation(
				() =>
					options.tabs.sendMessage(tab.id as number, {
						type: "PROFLOW_PAGE_SNAPSHOT_REQUEST",
					}),
				recoverySnapshotTimeoutMs,
			);
		const response = options.injectContentScript
			? await recoverMissingContentReceiver({
					observe: request,
					inject: () => options.injectContentScript?.(tab.id as number) ?? Promise.resolve(),
				})
			: await request();
		if (!isRecord(response) || response.ok !== true) return null;
		return parseSnapshotObservation(response.value, tab);
	};

	const waitForPermissionReleased = async (
		tabId: number,
		fingerprint: string,
	): Promise<boolean> => {
		for (let attempt = 0; attempt < 40; attempt += 1) {
			const observed = sessions.get(tabId);
			if (observed && observed.blockerFacts?.fingerprint !== fingerprint)
				return true;
			try {
				const value = await contentCommand(tabId, { operation: "observe" });
				if (rawPermissionFingerprint(value) !== fingerprint) return true;
			} catch {}
			await options.sleep(250);
		}
		return false;
	};

	const waitForSubmittedMessage = async (
		tabId: number,
		fingerprint: string,
	): Promise<ContentObservation> => {
		for (let attempt = 0; attempt < 60; attempt += 1) {
			try {
				const value = await contentCommand(tabId, {
					operation: "verify",
					fingerprint,
				});
				if (isRecord(value) && value.verified === true) return current(tabId);
			} catch {}
			await options.sleep(250);
		}
		throw new Error("MESSAGE_SUBMIT_REALITY_UNCONFIRMED");
	};

	return Object.freeze({
		record(observed: ContentObservation): ContentObservation | undefined {
			const previous = sessions.get(observed.tabId);
			sessions.set(observed.tabId, observed);
			openGate.recordReceipt(observed);
			return previous;
		},
		current,
		sessions: () => [...sessions.values()],
		waitForObservation,
		contentCommand,
		parseSnapshotObservation,
		waitForPermissionReleased,
		waitForSubmittedMessage,
		async recoverObservations(): Promise<ContentObservation[]> {
			const tabs = await options.tabs.query({ url: "https://chatgpt.com/g/*" });
			const snapshots = await Promise.all(tabs.map(snapshotTab));
			return snapshots.filter(
				(value): value is ContentObservation => value !== null,
			);
		},
		async listObservedTabs(): Promise<ContentObservation[]> {
			const tabs = await options.tabs.query({ url: "https://chatgpt.com/g/*" });
			return tabs.flatMap((tab) => {
				const observed = tab.id === undefined ? undefined : sessions.get(tab.id);
				return observed ? [observed] : [];
			});
		},
		async open(url: string): Promise<ContentObservation> {
			const parsed = new URL(url);
			if (parsed.protocol !== "https:" || parsed.hostname !== "chatgpt.com")
				throw new Error("URL_SCOPE_DENIED");
			const boundary = openGate.beginOpen(url);
			const tab = await options.tabs.create({ url, active: true });
			if (!Number.isInteger(tab.id)) throw new Error("TAB_ID_INVALID");
			return waitForObservation(tab.id as number, () =>
				openGate.accepts(tab.id as number, boundary),
			);
		},
		async observe(tabId: number): Promise<ContentObservation> {
			const value = await contentCommand(tabId, { operation: "observe" });
			const observed = parseSnapshotObservation(value, await options.tabs.get(tabId));
			if (!observed) throw new Error("CONTENT_OBSERVATION_INVALID");
			return observed;
		},
		async navigate(tabId: number, url: string): Promise<ContentObservation> {
			const parsed = new URL(url);
			if (parsed.protocol !== "https:" || parsed.hostname !== "chatgpt.com")
				throw new Error("URL_SCOPE_DENIED");
			const before = sessions.get(tabId)?.contentInstanceId;
			await options.tabs.update(tabId, { url });
			return waitForObservation(
				tabId,
				(value) => before === undefined || value.contentInstanceId !== before,
			);
		},
		async screenshot(tabId: number) {
			const observed = current(tabId);
			await options.tabs.update(tabId, { active: true });
			const dataUrl = await options.tabs.captureVisibleTab(observed.windowId, {
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
		},
	});
}

export type PageRealityController = ReturnType<typeof createPageRealityController>;
