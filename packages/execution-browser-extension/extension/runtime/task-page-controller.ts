import type { BridgeConfig } from "./application-client.js";
import type { ChromeRuntime } from "./chrome-runtime.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createTaskPageController(options: {
	bridgeConfig(): Promise<BridgeConfig | null>;
	fetchBridge(
		config: BridgeConfig,
		path: string,
		init?: RequestInit,
	): Promise<Response>;
	tabs: ChromeRuntime["tabs"];
	fallbackUrl(): string;
}) {
	return Object.freeze({
		async open(): Promise<void> {
			const bridge = await options.bridgeConfig();
			if (bridge) {
				try {
					const response = await options.fetchBridge(bridge, "/v1/tasks/session", {
						method: "POST",
					});
					const body = (await response.json()) as unknown;
					if (
						response.ok &&
						isRecord(body) &&
						typeof body.url === "string" &&
						body.url.startsWith(`${bridge.endpoint}/tasks/bootstrap/`)
					) {
						const webUrl = `${bridge.endpoint}/tasks`;
						const [existing] = await options.tabs.query({
							url: webUrl,
							currentWindow: true,
						});
						if (existing?.id !== undefined)
							await options.tabs.update(existing.id, {
								url: body.url,
								active: true,
							});
						else await options.tabs.create({ url: body.url, active: true });
						return;
					}
				} catch {}
			}
			const fallbackUrl = options.fallbackUrl();
			const [fallback] = await options.tabs.query({
				url: fallbackUrl,
				currentWindow: true,
			});
			if (fallback?.id !== undefined) {
				await options.tabs.update(fallback.id, { active: true });
				return;
			}
			await options.tabs.create({ url: fallbackUrl, active: true });
		},
	});
}
