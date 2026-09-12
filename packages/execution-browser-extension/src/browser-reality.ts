import type { ExecuteCapabilityRequest } from "@tomflow/proflow-execution-contracts";

export type BrowserPageState = "IDLE" | "BUSY" | "BLOCKED" | "UNKNOWN";
export type BrowserActivityKind =
	| "GENERATING"
	| "ACTION_PERMISSION"
	| "ACTION_RUNNING"
	| "WAITING_HUMAN"
	| "WAITING_PEER"
	| "RECOVERING"
	| null;

export interface BrowserPageObservation {
	tabId: number;
	windowId: number;
	url: string;
	contentInstanceId: string;
	pageState: BrowserPageState;
	activityKind: BrowserActivityKind;
	observedAt: string;
}

export interface BrowserWakeGuardInput {
	taskId: string;
	roleRef: string;
	workerRef: string;
	conversationLocator: string;
}

export interface BrowserRealityPort {
	listTabs(): Promise<BrowserPageObservation[]>;
	open(url: string): Promise<BrowserPageObservation>;
	observe(tabId: number): Promise<BrowserPageObservation>;
	guardWake?(input: BrowserWakeGuardInput): Promise<boolean>;
	submit(
		tabId: number,
		text: string,
		fingerprint: string,
		wakeGuard?: BrowserWakeGuardInput,
	): Promise<BrowserPageObservation>;
	hasMessage(tabId: number, fingerprint: string): Promise<boolean>;
	screenshot(tabId: number): Promise<{
		evidenceRef: string;
		dataUrl: string;
		mimeType: string;
		sizeBytes: number;
		hash: string;
	}>;
	perform?(
		request: ExecuteCapabilityRequest,
		tabId: number,
	): Promise<BrowserPageObservation>;
}
