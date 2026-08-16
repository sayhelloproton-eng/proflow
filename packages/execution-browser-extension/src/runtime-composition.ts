import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
	type BrowserRealityBridgeOptions,
	createBrowserRealityBridgeServer,
} from "./bridge.ts";
import { createExecutionBrowserExtension } from "./index.ts";

type LocalApplicationConfig = {
	endpoint: string;
	token: string;
};

export type BrowserExecutorCompositionOptions = {
	platformHost: LocalApplicationConfig;
	bridge: BrowserRealityBridgeOptions;
};

export type BrowserExecutorCompositionFileConfig = {
	platformHost: { endpoint: string; tokenFile: string };
	bridge: {
		extensionId: string;
		tokenFile: string;
		host?: string;
		port?: number;
	};
};

function record(value: unknown, name: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new TypeError(`${name} must be an object`);
	return value as Record<string, unknown>;
}

function nonEmpty(value: unknown, name: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError(`${name} must be a non-empty string`);
	return value;
}

async function readSecret(path: string, name: string): Promise<string> {
	const info = await stat(path);
	if (process.platform !== "win32" && (info.mode & 0o077) !== 0)
		throw new TypeError(`${name} permissions must be owner-only`);
	const value = (await readFile(path, "utf8")).trim();
	if (value.length < 32)
		throw new TypeError(`${name} must contain at least 32 characters`);
	return value;
}

export async function loadBrowserExecutorCompositionConfig(
	path: string,
): Promise<BrowserExecutorCompositionOptions> {
	const absolute = resolve(path);
	const root = dirname(absolute);
	const raw = record(
		JSON.parse(await readFile(absolute, "utf8")),
		"browser executor composition config",
	);
	const platformHost = record(raw.platformHost, "platformHost");
	const bridge = record(raw.bridge, "bridge");
	return {
		platformHost: {
			endpoint: nonEmpty(platformHost.endpoint, "platformHost.endpoint"),
			token: await readSecret(
				resolve(
					root,
					nonEmpty(platformHost.tokenFile, "platformHost.tokenFile"),
				),
				"platformHost token",
			),
		},
		bridge: {
			extensionId: nonEmpty(bridge.extensionId, "bridge.extensionId"),
			token: await readSecret(
				resolve(root, nonEmpty(bridge.tokenFile, "bridge.tokenFile")),
				"bridge token",
			),
			...(bridge.host === "127.0.0.1" ? { host: bridge.host } : {}),
			...(bridge.port !== undefined ? { port: Number(bridge.port) } : {}),
		},
	};
}

function applicationConfig(
	input: LocalApplicationConfig,
): LocalApplicationConfig {
	const endpoint = new URL(input.endpoint);
	if (
		endpoint.protocol !== "http:" ||
		!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(
			endpoint.hostname,
		) ||
		endpoint.pathname !== "/" ||
		endpoint.search !== "" ||
		endpoint.hash !== ""
	)
		throw new TypeError("platformHost endpoint must be loopback HTTP root");
	if (input.token.length < 32)
		throw new TypeError(
			"platformHost token must contain at least 32 characters",
		);
	return { endpoint: input.endpoint.replace(/\/$/, ""), token: input.token };
}

async function invokeApplication(
	config: LocalApplicationConfig,
	operation: string,
	input: Record<string, unknown>,
): Promise<unknown> {
	const response = await fetch(`${config.endpoint}/application/observer`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${config.token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ operation, input }),
	});
	const text = await response.text();
	const body = text.length ? (JSON.parse(text) as unknown) : undefined;
	if (!response.ok)
		throw new Error(
			typeof body === "object" &&
				body !== null &&
				typeof Reflect.get(body, "error") === "string"
				? String(Reflect.get(body, "error"))
				: "BROWSER_OWNER_TRANSPORT_FAILED",
		);
	return body;
}

/**
 * Node-side Browser Executor composition. This deliberately does NOT create an
 * Execution Runtime process. The single formal execution-runtime binary owns
 * Execution truth and must inject `browserExecutor` from this composition.
 */
export async function createBrowserExecutorComposition(
	options: BrowserExecutorCompositionOptions,
) {
	const platformHost = applicationConfig(options.platformHost);
	const bridge = await createBrowserRealityBridgeServer(options.bridge);
	try {
		const browserExecutor = createExecutionBrowserExtension({
			browser: bridge.browser,
			task: {
				async getWorkerBinding(taskId, roleRef) {
					return (await invokeApplication(platformHost, "browser.binding", {
						taskId,
						roleRef,
					})) as {
						workerRef: string;
						conversationLocator: string | null;
					} | null;
				},
				async bindWorker(binding) {
					await invokeApplication(platformHost, "browser.bindWorker", binding);
				},
			},
			agent: {
				async getPendingMessage(messageRef) {
					return (await invokeApplication(
						platformHost,
						"collaboration.getPending",
						{
							messageRef,
						},
					)) as Awaited<
						ReturnType<
							Parameters<
								typeof createExecutionBrowserExtension
							>[0]["agent"]["getPendingMessage"]
						>
					>;
				},
				async reportPhysicalDelivery(messageRef, evidenceRef, executionRef) {
					await invokeApplication(
						platformHost,
						"collaboration.reportDelivery",
						{
							messageRef,
							outcome: "DELIVERED",
							evidenceRef,
							executionRef,
						},
					);
				},
			},
		});
		return Object.freeze({
			browserExecutor,
			bridgeEndpoint: bridge.endpoint,
			bridgeStatus: bridge.status,
			close: bridge.close,
		});
	} catch (error) {
		await bridge.close();
		throw error;
	}
}
