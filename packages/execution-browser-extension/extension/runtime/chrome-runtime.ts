import type {
	ActionPermissionFacts,
	PermissionSemanticAction,
} from "../../src/carrier-permission.js";

export type PageState = "IDLE" | "BUSY" | "BLOCKED" | "UNKNOWN";
export type ActivityKind =
	| "GENERATING"
	| "ACTION_PERMISSION"
	| "ACTION_RUNNING"
	| "WAITING_HUMAN"
	| "WAITING_PEER"
	| "RECOVERING"
	| null;

export type ContentObservation = {
	tabId: number;
	windowId: number;
	url: string;
	contentInstanceId: string;
	pageState: PageState;
	activityKind: ActivityKind;
	blockerFacts?: ActionPermissionFacts;
	observedAt: string;
};

export type RuntimeMessage = {
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

export type ContentSnapshotRequest = { type: "PROFLOW_PAGE_SNAPSHOT_REQUEST" };
export type ContentCommand = {
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

export type ChromeTab = {
	id?: number;
	windowId?: number;
	url?: string;
	status?: "loading" | "complete";
};

export type ChromeRuntime = {
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
		query(query: { url?: string; currentWindow?: boolean }): Promise<ChromeTab[]>;
		get(tabId: number): Promise<ChromeTab>;
		create(create: { url: string; active: boolean }): Promise<ChromeTab>;
		reload(tabId: number): Promise<void>;
		update(
			tabId: number,
			update: { url?: string; active?: boolean },
		): Promise<ChromeTab>;
		sendMessage(tabId: number, message: unknown): Promise<unknown>;
		captureVisibleTab(
			windowId: number,
			options: { format: "png" },
		): Promise<string>;
	};
};
