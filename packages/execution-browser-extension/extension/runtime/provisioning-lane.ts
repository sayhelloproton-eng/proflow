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
}) {
	let started = false;

	const contentCommand = async (
		tabId: number,
		operation: ProvisioningOperation,
		request: Record<string, unknown>,
	): Promise<unknown> => {
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
				if (!receiverReloaded && missingReceiver(error)) {
					try {
						const tab = await options.getTab(tabId);
						if (tab.status === "complete" && isEditorUrl(tab.url)) {
							await options.reloadTab(tabId);
							receiverReloaded = true;
						}
					} catch {}
				}
				if (attempt === 59) throw error;
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
				throw new Error(detail);
			}
			return response.value;
		}
		throw new Error("PROVISIONING_CONTENT_TIMEOUT");
	};

	const execute = async (command: ProvisioningBridgeCommand): Promise<unknown> => {
		if (!isRecord(command.request))
			throw new Error("PROVISIONING_COMMAND_INVALID");
		let editorUrl = "https://chatgpt.com/gpts/editor";
		if (command.type === "FINALIZE_CUSTOM_GPT_AUTH") {
			const carrierUrl = new URL(text(command.request.carrierUrl, "CARRIER_URL"));
			const match = /^\/g\/(g-[A-Za-z0-9_-]+)$/.exec(carrierUrl.pathname);
			if (
				carrierUrl.origin !== "https://chatgpt.com" ||
				carrierUrl.username !== "" ||
				carrierUrl.password !== "" ||
				carrierUrl.search !== "" ||
				carrierUrl.hash !== "" ||
				!match?.[1]
			)
				throw new Error("PROVISIONING_CARRIER_URL_INVALID");
			editorUrl = `https://chatgpt.com/gpts/editor/${match[1]}`;
		}
		const tab = await options.openTab(editorUrl);
		if (!Number.isInteger(tab.id)) throw new Error("TAB_ID_INVALID");
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
					if (!hello.ok)
						throw new Error("PROVISIONING_BRIDGE_HELLO_REJECTED");
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
						const command = (await response.json()) as ProvisioningBridgeCommand;
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
						try {
							result = {
								commandId: command.commandId,
								ok: true,
								value: await execute(command),
							};
						} catch (error) {
							result = {
								commandId: command.commandId,
								ok: false,
								error:
									error instanceof Error
										? error.message
										: "PROVISIONING_EXTENSION_COMMAND_FAILED",
							};
						} finally {
							clearInterval(commandHeartbeat);
						}
						const reported = await options.fetchBridge(
							config,
							`/v1/provisioning/commands/result${query}`,
							{ method: "POST", body: JSON.stringify(result) },
						);
						if (!reported.ok)
							throw new Error("PROVISIONING_BRIDGE_RESULT_REJECTED");
					}
				} catch {
					await options.sleep(1_000);
				}
			}
		},
	});
}
