import { readFile, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	type BrowserRealityBridgeOptions,
	createBrowserRealityBridgeClient,
	createBrowserRealityBridgeServer,
} from "./bridge.ts";
import {
	type BrowserVisionPort,
	createExecutionBrowserExtension,
} from "./index.ts";

export type LocalApplicationConfig = {
	endpoint: string;
	token: string;
};

function packageRoot(): string {
	const candidate = dirname(dirname(fileURLToPath(import.meta.url)));
	return basename(candidate) === "dist" ? dirname(candidate) : candidate;
}

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

async function invokeOwnerApplication(
	config: LocalApplicationConfig,
	surface: "observer" | "task" | "approval",
	operation: string,
	input: Record<string, unknown>,
): Promise<unknown> {
	const response = await fetch(`${config.endpoint}/application/${surface}`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${config.token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ operation, input }),
		signal: AbortSignal.timeout(5_000),
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

function composeExecutor(
	browser: Parameters<typeof createExecutionBrowserExtension>[0]["browser"],
	platformHost: () => Promise<LocalApplicationConfig>,
	vision?: BrowserVisionPort,
) {
	return createExecutionBrowserExtension({
		browser,
		...(vision ? { vision } : {}),
		task: {
			async getWorkerBinding(taskId, roleRef) {
				return (await invokeOwnerApplication(
					await platformHost(),
					"observer",
					"browser.binding",
					{ taskId, roleRef },
				)) as {
					workerRef: string;
					conversationLocator: string | null;
				} | null;
			},
			async bindWorker(binding) {
				await invokeOwnerApplication(
					await platformHost(),
					"observer",
					"browser.bindWorker",
					binding,
				);
			},
		},
		agent: {
			async getPendingMessage(messageRef) {
				return (await invokeOwnerApplication(
					await platformHost(),
					"observer",
					"collaboration.getPending",
					{ messageRef },
				)) as Awaited<
					ReturnType<
						Parameters<
							typeof createExecutionBrowserExtension
						>[0]["agent"]["getPendingMessage"]
					>
				>;
			},
			async reportPhysicalDelivery(messageRef, evidenceRef, executionRef) {
				await invokeOwnerApplication(
					await platformHost(),
					"observer",
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
}

/** The Extension deployment owns this listener; owner applications resolve per request. */
export async function createBrowserBridgeLifecycle(options: {
	bridge: BrowserRealityBridgeOptions;
	platformHost: (
		surface: "task" | "approval",
	) => Promise<LocalApplicationConfig>;
}) {
	const root = packageRoot();
	const [html, script] = await Promise.all([
		readFile(resolve(root, "extension/tasks.html"), "utf8"),
		readFile(resolve(root, "dist/extension/tasks.js"), "utf8"),
	]);
	return createBrowserRealityBridgeServer({
		...options.bridge,
		resolveApplicationConfig: async () => ({
			task: applicationConfig(await options.platformHost("task")),
			approval: applicationConfig(await options.platformHost("approval")),
		}),
		taskWeb: {
			html: html.replace("../dist/extension/tasks.js", "/tasks/app.js"),
			script,
			invokeTask: async (operation, input) =>
				invokeOwnerApplication(
					applicationConfig(await options.platformHost("task")),
					"task",
					operation,
					input,
				),
			invokeApproval: async (operation, input) =>
				invokeOwnerApplication(
					applicationConfig(await options.platformHost("approval")),
					"approval",
					operation,
					input,
				),
		},
	});
}

/** Execution Runtime is a non-owning Browser-lane client; close never closes the listener. */
export async function createBrowserExecutorClientComposition(options: {
	configPath: string;
	platformHost: () => Promise<LocalApplicationConfig>;
	vision?: BrowserVisionPort;
}) {
	const raw = record(
		JSON.parse(await readFile(options.configPath, "utf8")),
		"browser client config",
	);
	const endpoint = nonEmpty(raw.endpoint, "endpoint");
	const client = createBrowserRealityBridgeClient({
		endpoint,
		token: await readSecret(
			nonEmpty(raw.tokenFile, "tokenFile"),
			"browser executor credential",
		),
	});
	return Object.freeze({
		browserExecutor: composeExecutor(
			client.browser,
			async () => applicationConfig(await options.platformHost()),
			options.vision,
		),
		bridgeEndpoint: endpoint,
		bridgeStatus: client.status,
		refreshStatus: client.refreshStatus,
		close: client.close,
	});
}
