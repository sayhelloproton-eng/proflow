export type BrowserBridgeCommand = {
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
	wakeGuard?: {
		taskId: string;
		roleRef: string;
		workerRef: string;
		conversationLocator: string;
	};
};

type BridgeConfig = { endpoint: string; token: string };

export type BrowserCommandResult = {
	commandId: string;
	ok: boolean;
	value?: unknown;
	error?: string;
};

function errorCode(error: unknown, fallback: string): string {
	const value = error instanceof Error ? error.message : error;
	return typeof value === "string" && /^[A-Z][A-Z0-9_.:-]{0,159}$/.test(value)
		? value
		: fallback;
}

export function createBrowserSessionLane(options: {
	config(): Promise<BridgeConfig | null>;
	getExtensionInstanceId(): string;
	extensionId: string;
	moduleVersion: string;
	fetchBridge(
		config: BridgeConfig,
		path: string,
		init?: RequestInit,
	): Promise<Response>;
	sleep(milliseconds: number): Promise<void>;
	keepalive(): Promise<void>;
	publishCarrierAttentions(): Promise<void>;
	onSessionEstablished(epoch: number): void;
	onSessionState?(input: {
		state: "ONLINE" | "OFFLINE";
		browserSessionEpoch: number;
		errorCode?: string;
	}): void;
	onCommandSettled?(input: {
		command: BrowserBridgeCommand;
		result: BrowserCommandResult;
		browserSessionEpoch: number;
		reported: boolean;
		durationMs: number;
	}): void;
	executeCommand(command: BrowserBridgeCommand): Promise<unknown>;
}) {
	let epoch = 0;
	return Object.freeze({
		async run(online: () => void): Promise<void> {
			const config = await options.config();
			if (!config) throw new Error("BRIDGE_NOT_CONFIGURED");
			const query = `?extensionInstanceId=${encodeURIComponent(options.getExtensionInstanceId())}`;
			try {
				const hello = await options.fetchBridge(config, "/v1/session/hello", {
					method: "POST",
					body: JSON.stringify({
						extensionId: options.extensionId,
						extensionInstanceId: options.getExtensionInstanceId(),
						moduleVersion: options.moduleVersion,
					}),
				});
				if (!hello.ok) throw new Error("BRIDGE_HELLO_REJECTED");
				epoch += 1;
				options.onSessionState?.({
					state: "ONLINE",
					browserSessionEpoch: epoch,
				});
				options.onSessionEstablished(epoch);
				await options.publishCarrierAttentions();

				let lastHeartbeatAt = Date.now();
				let lastKeepaliveAt = Date.now();
				while (true) {
					if (Date.now() - lastKeepaliveAt >= 20_000) {
						await options.keepalive();
						lastKeepaliveAt = Date.now();
					}
					if (Date.now() - lastHeartbeatAt >= 5_000) {
						const heartbeat = await options.fetchBridge(
							config,
							`/v1/session/heartbeat${query}`,
							{ method: "POST", body: "{}" },
						);
						if (!heartbeat.ok) throw new Error("BRIDGE_HEARTBEAT_REJECTED");
						lastHeartbeatAt = Date.now();
					}
					const response = await options.fetchBridge(
						config,
						`/v1/commands/next${query}`,
					);
					if (response.status === 204) {
						online();
						await options.sleep(250);
						continue;
					}
					if (!response.ok) throw new Error("BRIDGE_POLL_REJECTED");
					online();
					const command = (await response.json()) as BrowserBridgeCommand;
					const started = performance.now();
					let result: BrowserCommandResult;
					try {
						result = {
							commandId: command.commandId,
							ok: true,
							value: await options.executeCommand(command),
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
					let reported: Response | undefined;
					try {
						reported = await options.fetchBridge(
							config,
							`/v1/commands/result${query}`,
							{ method: "POST", body: JSON.stringify(result) },
						);
					} finally {
						try {
							options.onCommandSettled?.({
								command,
								result,
								browserSessionEpoch: epoch,
								reported: reported?.ok ?? false,
								durationMs: performance.now() - started,
							});
						} catch {}
					}

					if (!reported.ok) throw new Error("BRIDGE_RESULT_REJECTED");
				}
			} catch (error) {
				options.onSessionState?.({
					state: "OFFLINE",
					browserSessionEpoch: epoch,
					errorCode: errorCode(error, "BROWSER_SESSION_FAILED"),
				});
				throw error;
			}
		},
	});
}
