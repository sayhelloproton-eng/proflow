type BridgeConfig = { endpoint: string; token: string };
type ProvisioningOperation =
	| "PROVISION_CUSTOM_GPT"
	| "FINALIZE_CUSTOM_GPT_AUTH";
type ProvisioningBridgeCommand = {
	commandId: string;
	type: ProvisioningOperation;
	request: Record<string, unknown>;
};
type Tab = {
	id?: number;
	url?: string;
	status?: "loading" | "complete";
};

export type ProvisioningCommandOutcome = {
	commandId: string;
	operationId: ProvisioningOperation;
	status: "SUCCEEDED" | "FAILED" | "UNKNOWN";
	sideEffectState: "APPLIED" | "NOT_APPLIED" | "UNKNOWN";
	attemptNo: number;
	durationMs: number;
	errorCode?: string;
};

class ProvisioningCommandError extends Error {
	readonly code: string;
	readonly sideEffectState: "NOT_APPLIED" | "UNKNOWN";
	readonly attemptNo: number;
	constructor(
		code: string,
		sideEffectState: "NOT_APPLIED" | "UNKNOWN",
		attemptNo: number,
		cause?: unknown,
	) {
		super(code, cause === undefined ? undefined : { cause });
		this.name = "ProvisioningCommandError";
		this.code = code;
		this.sideEffectState = sideEffectState;
		this.attemptNo = attemptNo;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, name: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`${name}_INVALID`);
	return value;
}
function missingReceiver(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.includes("Could not establish connection") ||
		message.includes("Receiving end does not exist")
	);
}
function errorCode(error: unknown, fallback: string): string {
	const value =
		error instanceof ProvisioningCommandError
			? error.code
			: error instanceof Error
				? error.message
				: error;
	return typeof value === "string" && /^[A-Z][A-Z0-9_.:-]{0,159}$/.test(value)
		? value
		: fallback;
}
function isEditorUrl(url: string | undefined): boolean {
	return (
		url === "https://chatgpt.com/gpts/editor" ||
		Boolean(url?.startsWith("https://chatgpt.com/gpts/editor/"))
	);
}

export function createProvisioningLane(options: {
	config(): Promise<BridgeConfig | null>;
	getExtensionInstanceId(): string;
	extensionId: string;
	fetchBridge(
		config: BridgeConfig,
		path: string,
		init?: RequestInit,
	): Promise<Response>;
	sleep(milliseconds: number): Promise<void>;
	openTab(url: string): Promise<Tab>;
	getTab(tabId: number): Promise<Tab>;
	reloadTab(tabId: number): Promise<void>;
	sendTabMessage(tabId: number, message: unknown): Promise<unknown>;
	onSessionState?(input: {
		state: "ONLINE" | "OFFLINE";
		errorCode?: string;
	}): void;
	onCommandSettled?(outcome: ProvisioningCommandOutcome): void;
}) {
	let started = false;
	let sessionOnline = false;
	let lastFailureCode = "";

	const contentCommand = async (
		tabId: number,
		operation: ProvisioningOperation,
		request: Record<string, unknown>,
	): Promise<{ value: unknown; attemptNo: number }> => {
		let receiverReloaded = false;
		for (let attempt = 0; attempt < 60; attempt += 1) {
			let response: unknown;
			try {
				response = await options.sendTabMessage(tabId, {
					type: "PROFLOW_PROVISIONING_COMMAND",
					operation,
					request,
				});
			} catch (error) {
				if (!missingReceiver(error))
					throw new ProvisioningCommandError(
						"PROVISIONING_EFFECT_UNKNOWN",
						"UNKNOWN",
						attempt + 1,
						error,
					);
				if (!receiverReloaded) {
					try {
						const tab = await options.getTab(tabId);
						if (tab.status === "complete" && isEditorUrl(tab.url)) {
							await options.reloadTab(tabId);
							receiverReloaded = true;
						}
					} catch {}
				}
				if (attempt === 59)
					throw new ProvisioningCommandError(
						"PROVISIONING_RECEIVER_MISSING",
						"NOT_APPLIED",
						attempt + 1,
						error,
					);
				await options.sleep(250);
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
					await options.sleep(250);
					continue;
				}
				const notApplied =
					detail === "PROVISIONING_SURFACE_NOT_READY" ||
					detail === "GPT_EDITOR_CONFIGURE_SURFACE_NOT_READY";
				throw new ProvisioningCommandError(
					errorCode(detail, "PROVISIONING_CONTENT_FAILED"),
					notApplied ? "NOT_APPLIED" : "UNKNOWN",
					attempt + 1,
				);
			}
			return { value: response.value, attemptNo: attempt + 1 };
		}
		throw new ProvisioningCommandError(
			"PROVISIONING_CONTENT_TIMEOUT",
			"NOT_APPLIED",
			60,
		);
	};

	const execute = async (
		command: ProvisioningBridgeCommand,
	): Promise<{ value: unknown; attemptNo: number }> => {
		if (!isRecord(command.request))
			throw new ProvisioningCommandError(
				"PROVISIONING_COMMAND_INVALID",
				"NOT_APPLIED",
				0,
			);
		let editorUrl = "https://chatgpt.com/gpts/editor";
		if (command.type === "FINALIZE_CUSTOM_GPT_AUTH") {
			const carrierUrl = new URL(
				text(command.request.carrierUrl, "CARRIER_URL"),
			);
			const match = /^\/g\/(g-[A-Za-z0-9_-]+)$/.exec(carrierUrl.pathname);
			if (
				carrierUrl.origin !== "https://chatgpt.com" ||
				carrierUrl.username !== "" ||
				carrierUrl.password !== "" ||
				carrierUrl.search !== "" ||
				carrierUrl.hash !== "" ||
				!match?.[1]
			)
				throw new ProvisioningCommandError(
					"PROVISIONING_CARRIER_URL_INVALID",
					"NOT_APPLIED",
					0,
				);
			editorUrl = `https://chatgpt.com/gpts/editor/${match[1]}`;
		}
		const tab = await options.openTab(editorUrl);
		if (!Number.isInteger(tab.id))
			throw new ProvisioningCommandError("TAB_ID_INVALID", "NOT_APPLIED", 0);
		return contentCommand(tab.id as number, command.type, command.request);
	};

	return Object.freeze({
		async start(): Promise<void> {
			if (started) return;
			started = true;
			while (true) {
				const config = await options.config();
				if (!config) {
					await options.sleep(1_000);
					continue;
				}
				const query = `?extensionInstanceId=${encodeURIComponent(options.getExtensionInstanceId())}`;
				try {
					const hello = await options.fetchBridge(
						config,
						"/v1/provisioning/session/hello",
						{
							method: "POST",
							body: JSON.stringify({
								extensionId: options.extensionId,
								extensionInstanceId: options.getExtensionInstanceId(),
							}),
						},
					);
					if (!hello.ok) throw new Error("PROVISIONING_BRIDGE_HELLO_REJECTED");
					sessionOnline = true;
					lastFailureCode = "";
					options.onSessionState?.({ state: "ONLINE" });
					let lastHeartbeatAt = 0;
					while (true) {
						if (Date.now() - lastHeartbeatAt >= 5_000) {
							const heartbeat = await options.fetchBridge(
								config,
								`/v1/provisioning/session/heartbeat${query}`,
								{ method: "POST", body: "{}" },
							);
							if (!heartbeat.ok)
								throw new Error("PROVISIONING_BRIDGE_HEARTBEAT_REJECTED");
							lastHeartbeatAt = Date.now();
						}
						const response = await options.fetchBridge(
							config,
							`/v1/provisioning/commands/next${query}`,
						);
						if (response.status === 204) {
							await options.sleep(250);
							continue;
						}
						if (!response.ok)
							throw new Error("PROVISIONING_BRIDGE_POLL_REJECTED");
						const command =
							(await response.json()) as ProvisioningBridgeCommand;
						const commandStarted = performance.now();
						const commandHeartbeat = setInterval(() => {
							void options
								.fetchBridge(
									config,
									`/v1/provisioning/session/heartbeat${query}`,
									{ method: "POST", body: "{}" },
								)
								.catch(() => undefined);
						}, 2_000);
						let result: Record<string, unknown>;
						let outcome: Omit<ProvisioningCommandOutcome, "durationMs">;
						try {
							const executed = await execute(command);
							result = {
								commandId: command.commandId,
								ok: true,
								value: executed.value,
							};
							outcome = {
								commandId: command.commandId,
								operationId: command.type,
								status: "SUCCEEDED",
								sideEffectState: "APPLIED",
								attemptNo: executed.attemptNo,
							};
						} catch (error) {
							const code = errorCode(
								error,
								"PROVISIONING_EXTENSION_COMMAND_FAILED",
							);
							const sideEffectState =
								error instanceof ProvisioningCommandError
									? error.sideEffectState
									: "UNKNOWN";
							const attemptNo =
								error instanceof ProvisioningCommandError ? error.attemptNo : 0;
							result = {
								commandId: command.commandId,
								ok: false,
								error: code,
							};
							outcome = {
								commandId: command.commandId,
								operationId: command.type,
								status: sideEffectState === "UNKNOWN" ? "UNKNOWN" : "FAILED",
								sideEffectState,
								attemptNo,
								errorCode: code,
							};
						} finally {
							clearInterval(commandHeartbeat);
						}
						let reported: Response | undefined;
						try {
							reported = await options.fetchBridge(
								config,
								`/v1/provisioning/commands/result${query}`,
								{ method: "POST", body: JSON.stringify(result) },
							);
						} finally {
							try {
								options.onCommandSettled?.({
									...outcome,
									...(!reported?.ok
										? {
												status: "UNKNOWN" as const,
												errorCode: "PROVISIONING_BRIDGE_RESULT_REJECTED",
											}
										: {}),
									durationMs: performance.now() - commandStarted,
								});
							} catch {}
						}
						if (!reported.ok)
							throw new Error("PROVISIONING_BRIDGE_RESULT_REJECTED");
					}
				} catch (error) {
					const code = errorCode(error, "PROVISIONING_SESSION_FAILED");
					if (sessionOnline || code !== lastFailureCode)
						options.onSessionState?.({ state: "OFFLINE", errorCode: code });
					sessionOnline = false;
					lastFailureCode = code;
					await options.sleep(1_000);
				}
			}
		},
	});
}
