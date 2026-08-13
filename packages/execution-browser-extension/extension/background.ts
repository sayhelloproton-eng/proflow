export {};

type RuntimeMessage = {
	type: "PROFLOW_CONTENT_OBSERVATION" | "PROFLOW_SIDE_PANEL_SNAPSHOT";
	observation?: ContentObservation;
};
type ContentObservation = {
	tabId?: number;
	windowId?: number;
	url: string;
	contentInstanceId: string;
	pageState: "IDLE" | "BUSY" | "BLOCKED" | "UNKNOWN";
	activityKind: string | null;
	observedAt: string;
};
type ChromeRuntime = {
	runtime: {
		onMessage: {
			addListener(
				listener: (
					message: RuntimeMessage,
					sender: { tab?: { id?: number; windowId?: number } },
					sendResponse: (value: unknown) => void,
				) => boolean | undefined,
			): void;
		};
		onStartup: { addListener(listener: () => void): void };
		onInstalled: { addListener(listener: () => void): void };
	};
	storage: { session: { set(value: Record<string, unknown>): Promise<void> } };
	sidePanel: {
		setPanelBehavior(options: {
			openPanelOnActionClick: boolean;
		}): Promise<void>;
	};
};
declare const chrome: ChromeRuntime;

const extensionInstanceId = `extension:${crypto.randomUUID()}`;
const sessions = new Map<number, ContentObservation>();

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (
		message.type === "PROFLOW_CONTENT_OBSERVATION" &&
		message.observation &&
		sender.tab?.id !== undefined
	) {
		const observed: ContentObservation = {
			...message.observation,
			tabId: sender.tab.id,
		};
		if (sender.tab.windowId !== undefined)
			observed.windowId = sender.tab.windowId;
		sessions.set(sender.tab.id, observed);
		void persistSnapshot();
		sendResponse({ accepted: true, extensionInstanceId });
		return;
	}
	if (message.type === "PROFLOW_SIDE_PANEL_SNAPSHOT") {
		sendResponse({
			extensionInstanceId,
			observedAt: new Date().toISOString(),
			sessions: [...sessions.values()],
		});
	}
});

chrome.runtime.onInstalled.addListener(() => {
	void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
chrome.runtime.onStartup.addListener(() => {
	sessions.clear();
	void persistSnapshot();
});
void persistSnapshot();
