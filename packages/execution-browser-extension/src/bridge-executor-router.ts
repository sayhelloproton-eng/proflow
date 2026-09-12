import type { IncomingMessage, ServerResponse } from "node:http";

import type { BridgeCommandBus } from "./bridge-command-bus.ts";
import { BrowserRealityBridgeError } from "./bridge-error.ts";
import { readJson, safeEqual, send } from "./bridge-http.ts";
import { parseExecutorCommand } from "./bridge-protocol.ts";

export function createBridgeExecutorRouter(options: {
	executorToken?: string;
	commandBus: BridgeCommandBus;
}) {
	return Object.freeze({
		async route(
			request: IncomingMessage,
			response: ServerResponse,
			url: URL,
		): Promise<boolean> {
			if (!url.pathname.startsWith("/v1/executor/")) return false;
			if (
				!options.executorToken ||
				!safeEqual(
					request.headers.authorization ?? "",
					`Bearer ${options.executorToken}`,
				)
			)
				throw new BrowserRealityBridgeError(
					"BRIDGE_AUTH_INVALID",
					"executor authentication failed",
				);
			if (
				request.method === "GET" &&
				url.pathname === "/v1/executor/status"
			) {
				send(response, 200, options.commandBus.status());
				return true;
			}
			if (
				request.method === "POST" &&
				url.pathname === "/v1/executor/commands"
			) {
				const command = parseExecutorCommand(await readJson(request));
				send(response, 200, {
					value: await options.commandBus.request(command),
				});
				return true;
			}
			send(response, 404, { error: "NOT_FOUND" });
			return true;
		},
	});
}
