import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { createBrowserPort } from "./bridge-protocol.ts";
import { createBridgeCommandBus } from "./bridge-command-bus.ts";
import { createBridgeExecutorRouter } from "./bridge-executor-router.ts";
import { BrowserRealityBridgeError } from "./bridge-error.ts";
import { isRecord, readJson, safeEqual, send, stringField } from "./bridge-http.ts";
import {
	createBridgeTaskWeb,
	type BrowserRealityBridgeTaskWebOptions,
} from "./bridge-task-web.ts";

export { createBrowserRealityBridgeClient } from "./bridge-client.ts";
export { BrowserRealityBridgeError } from "./bridge-error.ts";
export type { BrowserRealityBridgeTaskWebOptions } from "./bridge-task-web.ts";

export interface BrowserRealityBridgeOptions {
	executorToken?: string;
	resolveApplicationConfig?: () => Promise<{
		task: { endpoint: string; token: string };
		approval: { endpoint: string; token: string };
	}>;
	token: string;
	extensionId: string;
	host?: "127.0.0.1";
	port?: number;
	heartbeatFreshnessMs?: number;
	commandTimeoutMs?: number;
	now?: () => Date;
	idFactory?: () => string;
	taskWeb?: BrowserRealityBridgeTaskWebOptions;
}

export async function createBrowserRealityBridgeServer(
	options: BrowserRealityBridgeOptions,
) {
	if (options.token.length < 32)
		throw new TypeError("bridge token must contain at least 32 characters");
	if (!/^[a-z]{32}$/.test(options.extensionId))
		throw new TypeError(
			"extensionId must be a canonical Chromium extension id",
		);
	if (
		options.executorToken !== undefined &&
		(options.executorToken.length < 32 || options.executorToken === options.token)
	)
		throw new TypeError(
			"executor credential must be separate and at least 32 characters",
		);

	const now = options.now ?? (() => new Date());
	const idFactory = options.idFactory ?? randomUUID;
	const expectedOrigin = `chrome-extension://${options.extensionId}`;
	let endpoint = "";

	const commandBus = createBridgeCommandBus({
		now,
		idFactory,
		freshnessMs: options.heartbeatFreshnessMs ?? 10_000,
		commandTimeoutMs: options.commandTimeoutMs ?? 120_000,
	});
	const taskWeb = createBridgeTaskWeb({
		...(options.taskWeb ? { taskWeb: options.taskWeb } : {}),
		now,
		idFactory,
		commandBus,
	});
	const executor = createBridgeExecutorRouter({
		...(options.executorToken ? { executorToken: options.executorToken } : {}),
		commandBus,
	});

	const authenticate = (request: import("node:http").IncomingMessage) => {
		const authorization = request.headers.authorization;
		const origin = request.headers.origin;
		if (
			!authorization?.startsWith("Bearer ") ||
			!safeEqual(authorization.slice(7), options.token) ||
			(origin !== undefined && origin !== expectedOrigin)
		)
			throw new BrowserRealityBridgeError(
				"BRIDGE_AUTH_INVALID",
				"bridge authentication failed",
			);
	};
	const requireExtensionOrigin = (
		request: import("node:http").IncomingMessage,
	) => {
		if (request.headers.origin !== expectedOrigin)
			throw new BrowserRealityBridgeError(
				"BRIDGE_AUTH_INVALID",
				"bridge extension origin is required",
			);
	};

	const server = createServer(async (request, response) => {
		try {
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			if (await executor.route(request, response, url)) return;
			if (await taskWeb.route(request, response, url, endpoint)) return;

			response.setHeader("access-control-allow-origin", expectedOrigin);
			response.setHeader("vary", "origin");
			if (request.method === "OPTIONS") {
				response.setHeader(
					"access-control-allow-headers",
					"authorization, content-type",
				);
				response.setHeader(
					"access-control-allow-methods",
					"GET, POST, OPTIONS",
				);
				response.writeHead(204);
				response.end();
				return;
			}

			authenticate(request);
			if (
				request.method === "GET" &&
				url.pathname === "/v1/applications/config" &&
				options.resolveApplicationConfig
			) {
				requireExtensionOrigin(request);
				send(response, 200, await options.resolveApplicationConfig());
				return;
			}
			if (
				options.taskWeb &&
				request.method === "POST" &&
				url.pathname === "/v1/tasks/session"
			) {
				send(response, 200, { url: taskWeb.createBootstrapUrl(endpoint) });
				return;
			}
			if (request.method === "POST" && url.pathname === "/v1/session/hello") {
				requireExtensionOrigin(request);
				const body = await readJson(request);
				if (
					!isRecord(body) ||
					stringField(body, "extensionId") !== options.extensionId
				)
					throw new BrowserRealityBridgeError(
						"BRIDGE_AUTH_INVALID",
						"extension identity mismatch",
					);
				commandBus.hello(
					stringField(body, "extensionInstanceId"),
					stringField(body, "moduleVersion"),
				);
				send(response, 200, { accepted: true });
				return;
			}
			if (request.method === "GET" && url.pathname === "/v1/session/status") {
				const status = commandBus.status();
				const session = commandBus.sessionInfo();
				send(response, 200, {
					online: status.commandConsumerReady,
					sessionOnline: status.sessionOnline,
					commandConsumerReady: status.commandConsumerReady,
					extensionInstanceId: status.extensionInstanceId,
					moduleVersion: session?.moduleVersion ?? null,
				});
				return;
			}

			const extensionInstanceId = url.searchParams.get("extensionInstanceId");
			commandBus.assertInstance(extensionInstanceId);
			if (
				request.method === "POST" &&
				url.pathname === "/v1/session/heartbeat"
			) {
				commandBus.heartbeat(extensionInstanceId);
				send(response, 200, { accepted: true });
				return;
			}
			if (
				request.method === "POST" &&
				url.pathname === "/v1/carrier/attentions"
			) {
				requireExtensionOrigin(request);
				const body = await readJson(request);
				if (!isRecord(body))
					throw new BrowserRealityBridgeError(
						"BRIDGE_INPUT_INVALID",
						"carrier attentions body must be an object",
					);
				taskWeb.updateCarrierAttentions(body.carrierAttentions);
				send(response, 200, { accepted: true });
				return;
			}
			if (request.method === "GET" && url.pathname === "/v1/commands/next") {
				const command = commandBus.poll(extensionInstanceId);
				send(response, command ? 200 : 204, command ?? undefined);
				return;
			}
			if (request.method === "POST" && url.pathname === "/v1/commands/result") {
				commandBus.settle(extensionInstanceId, await readJson(request));
				send(response, 200, { accepted: true });
				return;
			}
			send(response, 404, { error: "NOT_FOUND" });
		} catch (error) {
			const bridgeError =
				error instanceof BrowserRealityBridgeError
					? error
					: new BrowserRealityBridgeError(
							"BRIDGE_INPUT_INVALID",
							error instanceof Error ? error.message : "bridge request failed",
						);
			send(response, bridgeError.code === "BRIDGE_AUTH_INVALID" ? 401 : 400, {
				error: bridgeError.code,
			});
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("bridge address missing");
	endpoint = `http://127.0.0.1:${address.port}`;

	return Object.freeze({
		endpoint,
		browser: createBrowserPort(commandBus.request),
		status: commandBus.status,
		async close() {
			commandBus.close();
			taskWeb.clear();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		},
	});
}
