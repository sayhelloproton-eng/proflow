type BridgeConfig = { endpoint: string; token: string };

function errorCode(error: unknown, fallback: string): string {
	const value = error instanceof Error ? error.message : error;
	return typeof value === "string" && /^[A-Z][A-Z0-9_.:-]{0,159}$/.test(value)
		? value
		: fallback;
}

export function createLocalToolLane(options: {
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
	createNotification(
		id: string,
		input: { title: string; message: string; iconUrl: string },
	): Promise<void>;
	setBadgeText(text: string): Promise<void>;
	setTitle(title: string): Promise<void>;
	onSessionState?(input: { state: "ONLINE" | "OFFLINE"; errorCode?: string }): void;
}) {
	let started = false;
	let sessionOnline = false;
	let lastFailureCode = "";

	const showNotices = async (command: Record<string, unknown>) => {
		const notices = command.notices;
		if (!Array.isArray(notices)) return;
		const rendered = notices.filter(
			(item): item is string => typeof item === "string" && item.length > 0,
		);
		const message = rendered.join("\n").slice(0, 3_500);
		if (!message) return;
		try {
			await options.createNotification(
				`proflow-local-tool:${crypto.randomUUID()}`,
				{
					title: "ProFlow Workspace notice",
					message,
					iconUrl:
						"data:image/svg+xml;charset=utf-8," +
						encodeURIComponent(
							'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#111827"/><path d="M16 34h32M32 18v32" stroke="white" stroke-width="6" stroke-linecap="round"/></svg>',
						),
				},
			);
		} catch (error) {
			console.warn("PROFLOW_LOCAL_TOOL_NOTICE_FALLBACK", {
				commandId: command.commandId,
				noticeCount: rendered.length,
				errorCode: errorCode(error, "LOCAL_TOOL_NOTICE_FAILED"),
			});
			await Promise.allSettled([
				options.setBadgeText("!"),
				options.setTitle(`ProFlow Workspace notice: ${message.slice(0, 400)}`),
			]);
		}
	};

	return Object.freeze({
		async start(): Promise<void> {
			if (started) return;
			started = true;
			while (true) {
				const config = await options.config().catch(() => null);
				if (!config) {
					await options.sleep(1_000);
					continue;
				}
				const query = `?extensionInstanceId=${encodeURIComponent(options.getExtensionInstanceId())}`;
				try {
					const hello = await options.fetchBridge(
						config,
						"/v1/local-tools/session/hello",
						{
							method: "POST",
							body: JSON.stringify({
								extensionId: options.extensionId,
								extensionInstanceId: options.getExtensionInstanceId(),
								moduleVersion: options.moduleVersion,
							}),
						},
					);
					if (!hello.ok)
						throw new Error("LOCAL_TOOL_BRIDGE_HELLO_REJECTED");
					sessionOnline = true;
					lastFailureCode = "";
					options.onSessionState?.({ state: "ONLINE" });
					let lastHeartbeatAt = Date.now();
					while (true) {
						if (Date.now() - lastHeartbeatAt >= 5_000) {
							const heartbeat = await options.fetchBridge(
								config,
								`/v1/local-tools/session/heartbeat${query}`,
								{ method: "POST", body: "{}" },
							);
							if (!heartbeat.ok)
								throw new Error("LOCAL_TOOL_BRIDGE_HEARTBEAT_REJECTED");
							lastHeartbeatAt = Date.now();
						}
						const response = await options.fetchBridge(
							config,
							`/v1/local-tools/commands/next${query}`,
						);
						if (response.status === 204) {
							await options.sleep(250);
							continue;
						}
						if (!response.ok)
							throw new Error("LOCAL_TOOL_BRIDGE_POLL_REJECTED");
						const command = (await response.json()) as unknown;
						if (
							typeof command !== "object" ||
							command === null ||
							Array.isArray(command)
						)
							throw new Error("LOCAL_TOOL_COMMAND_INVALID");
						const record = command as Record<string, unknown>;
						const { commandId, generation, commandDigest } = record;
						if (
							typeof commandId !== "string" ||
							typeof generation !== "string" ||
							typeof commandDigest !== "string"
						)
							throw new Error("LOCAL_TOOL_COMMAND_INVALID");
						await showNotices(record).catch(() => undefined);
						const accepted = await options.fetchBridge(
							config,
							`/v1/local-tools/commands/execute${query}`,
							{
								method: "POST",
								body: JSON.stringify({ commandId, generation, commandDigest }),
							},
						);
						if (accepted.status !== 202)
							throw new Error("LOCAL_TOOL_BRIDGE_EXECUTE_REJECTED");
					}
				} catch (error) {
					const code = errorCode(error, "LOCAL_TOOL_SESSION_FAILED");
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
