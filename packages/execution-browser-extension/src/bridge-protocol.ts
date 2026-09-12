import {
	type ExecuteCapabilityRequest,
	parseExecuteCapabilityRequest,
} from "@tomflow/proflow-execution-contracts";
import type {
	BrowserPageObservation,
	BrowserRealityPort,
	BrowserWakeGuardInput,
} from "./browser-reality.ts";
import { BrowserRealityBridgeError } from "./bridge-error.ts";
import { isRecord, numberField, stringField } from "./bridge-http.ts";

export type BridgeCommand =
	| { commandId: string; type: "LIST_TABS" }
	| { commandId: string; type: "OPEN"; url: string }
	| { commandId: string; type: "OBSERVE"; tabId: number }
	| {
			commandId: string;
			type: "SUBMIT";
			tabId: number;
			text: string;
			fingerprint: string;
			wakeGuard?: BrowserWakeGuardInput;
	  }
	| { commandId: string; type: "VERIFY"; tabId: number; fingerprint: string }
	| { commandId: string; type: "SCREENSHOT"; tabId: number }
	| {
			commandId: string;
			type: "PERFORM";
			tabId: number;
			request: ExecuteCapabilityRequest;
	  }
	| {
			commandId: string;
			type: "CARRIER_ATTENTION_ACTION";
			attentionRef: string;
			action: "allowOnce" | "deny";
	  }
	| {
			commandId: string;
			type: "WAKE_GUARD";
			taskId: string;
			roleRef: string;
			workerRef: string;
			conversationLocator: string;
	  };

export type BridgeCommandInput = BridgeCommand extends infer Command
	? Command extends { commandId: string }
		? Omit<Command, "commandId">
		: never
	: never;

export function parseObservation(value: unknown): BrowserPageObservation {
	if (!isRecord(value))
		throw new BrowserRealityBridgeError(
			"BRIDGE_INPUT_INVALID",
			"observation must be an object",
		);
	const tabId = value.tabId;
	const windowId = value.windowId;
	const pageState = value.pageState;
	const activityKind = value.activityKind;
	if (!Number.isInteger(tabId) || !Number.isInteger(windowId))
		throw new BrowserRealityBridgeError(
			"BRIDGE_INPUT_INVALID",
			"observation tab and window identity must be integers",
		);
	if (!["IDLE", "BUSY", "BLOCKED", "UNKNOWN"].includes(String(pageState)))
		throw new BrowserRealityBridgeError(
			"BRIDGE_INPUT_INVALID",
			"observation page state is invalid",
		);
	if (
		activityKind !== null &&
		![
			"GENERATING",
			"ACTION_PERMISSION",
			"ACTION_RUNNING",
			"WAITING_HUMAN",
			"WAITING_PEER",
			"RECOVERING",
		].includes(String(activityKind))
	)
		throw new BrowserRealityBridgeError(
			"BRIDGE_INPUT_INVALID",
			"observation activity kind is invalid",
		);
	return {
		tabId: tabId as number,
		windowId: windowId as number,
		url: stringField(value, "url"),
		contentInstanceId: stringField(value, "contentInstanceId"),
		pageState: pageState as BrowserPageObservation["pageState"],
		activityKind: activityKind as BrowserPageObservation["activityKind"],
		observedAt: stringField(value, "observedAt"),
	};
}

export function createBrowserPort(
	requestCommand: (command: BridgeCommandInput) => Promise<unknown>,
): BrowserRealityPort {
	return {
		async listTabs() {
			const value = await requestCommand({ type: "LIST_TABS" });
			if (!Array.isArray(value))
				throw new BrowserRealityBridgeError(
					"BRIDGE_INPUT_INVALID",
					"LIST_TABS result must be an array",
				);
			return value.map(parseObservation);
		},
		async open(url) {
			return parseObservation(await requestCommand({ type: "OPEN", url }));
		},
		async observe(tabId) {
			return parseObservation(await requestCommand({ type: "OBSERVE", tabId }));
		},
		async guardWake(input) {
			const value = await requestCommand({ type: "WAKE_GUARD", ...input });
			if (!isRecord(value) || typeof value.allowed !== "boolean")
				throw new BrowserRealityBridgeError(
					"BRIDGE_INPUT_INVALID",
					"WAKE_GUARD result is invalid",
				);
			return value.allowed;
		},
		async submit(tabId, text, fingerprint, wakeGuard) {
			return parseObservation(
				await requestCommand({
					type: "SUBMIT",
					tabId,
					text,
					fingerprint,
					...(wakeGuard ? { wakeGuard } : {}),
				}),
			);
		},
		async hasMessage(tabId, fingerprint) {
			const value = await requestCommand({ type: "VERIFY", tabId, fingerprint });
			if (!isRecord(value) || typeof value.verified !== "boolean")
				throw new BrowserRealityBridgeError(
					"BRIDGE_INPUT_INVALID",
					"VERIFY result is invalid",
				);
			return value.verified;
		},
		async screenshot(tabId) {
			const value = await requestCommand({ type: "SCREENSHOT", tabId });
			if (!isRecord(value))
				throw new BrowserRealityBridgeError(
					"BRIDGE_INPUT_INVALID",
					"SCREENSHOT result is invalid",
				);
			return {
				evidenceRef: stringField(value, "evidenceRef"),
				dataUrl: stringField(value, "dataUrl"),
				mimeType: stringField(value, "mimeType"),
				sizeBytes: numberField(value, "sizeBytes"),
				hash: stringField(value, "hash"),
			};
		},
		async perform(request, tabId) {
			return parseObservation(
				await requestCommand({ type: "PERFORM", tabId, request }),
			);
		},
	};
}

export function parseExecutorCommand(value: unknown): BridgeCommandInput {
	if (!isRecord(value))
		throw new BrowserRealityBridgeError(
			"BRIDGE_INPUT_INVALID",
			"executor command must be an object",
		);
	switch (value.type) {
		case "LIST_TABS":
			return { type: "LIST_TABS" };
		case "OPEN":
			return { type: "OPEN", url: stringField(value, "url") };
		case "OBSERVE":
		case "SCREENSHOT":
			return { type: value.type, tabId: numberField(value, "tabId") };
		case "SUBMIT": {
			const rawWakeGuard = value.wakeGuard;
			let wakeGuard: BrowserWakeGuardInput | undefined;
			if (rawWakeGuard !== undefined) {
				if (!isRecord(rawWakeGuard))
					throw new BrowserRealityBridgeError(
						"BRIDGE_INPUT_INVALID",
						"SUBMIT wakeGuard must be an object",
					);
				wakeGuard = {
					taskId: stringField(rawWakeGuard, "taskId"),
					roleRef: stringField(rawWakeGuard, "roleRef"),
					workerRef: stringField(rawWakeGuard, "workerRef"),
					conversationLocator: stringField(rawWakeGuard, "conversationLocator"),
				};
			}
			return {
				type: "SUBMIT",
				tabId: numberField(value, "tabId"),
				text: stringField(value, "text"),
				fingerprint: stringField(value, "fingerprint"),
				...(wakeGuard ? { wakeGuard } : {}),
			};
		}
		case "VERIFY":
			return {
				type: "VERIFY",
				tabId: numberField(value, "tabId"),
				fingerprint: stringField(value, "fingerprint"),
			};
		case "WAKE_GUARD":
			return {
				type: "WAKE_GUARD",
				taskId: stringField(value, "taskId"),
				roleRef: stringField(value, "roleRef"),
				workerRef: stringField(value, "workerRef"),
				conversationLocator: stringField(value, "conversationLocator"),
			};
		case "PERFORM":
			return {
				type: "PERFORM",
				tabId: numberField(value, "tabId"),
				request: parseExecuteCapabilityRequest(value.request),
			};
		default:
			throw new BrowserRealityBridgeError(
				"BRIDGE_INPUT_INVALID",
				"unsupported executor command",
			);
	}
}
