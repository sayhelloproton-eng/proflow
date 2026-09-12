import type {
	BrowserActivityKind,
	BrowserPageObservation,
	BrowserPageState,
	BrowserRealityPort,
} from "./browser-reality.ts";

export type ExecutionLaneState = {
	roleRef: string;
	workerRef: string;
	tabId: number;
	pageState: BrowserPageState;
	activityKind: BrowserActivityKind;
	currentExecutionRef: string | null;
	continuationRef: string | null;
	lastProgressAt: string;
};

export function createBrowserSessionState(options: {
	browser: Pick<BrowserRealityPort, "listTabs" | "observe" | "screenshot">;
	extensionInstanceId: string;
	now(): Date;
	parseCarrierIdentity(raw: string): { roleRef: string; workerRef: string | null };
}) {
	const sessions = new Map<number, BrowserPageObservation>();
	const lanes = new Map<string, ExecutionLaneState>();
	const registerContentSession = (observation: BrowserPageObservation) => {
		const identity = options.parseCarrierIdentity(observation.url);
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
				const identity = options.parseCarrierIdentity(tab.url);
				if (identity.roleRef === roleRef && identity.workerRef === workerRef) {
					return tab;
				}
			} catch {
				/* unrelated tab */
			}
		}
		return null;
	};

	return Object.freeze({
		registerContentSession,
		matchingTab,
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
			const identity = options.parseCarrierIdentity(observed.url);
			if (identity.workerRef) {
				const key = `${identity.roleRef}:${identity.workerRef}`;
				const lane = lanes.get(key);
				if (lane)
					lanes.set(key, {
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
				extensionInstanceId: options.extensionInstanceId,
				observedAt: options.now().toISOString(),
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
	});
}

export type BrowserSessionState = ReturnType<typeof createBrowserSessionState>;
