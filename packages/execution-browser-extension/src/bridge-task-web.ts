import type { IncomingMessage, ServerResponse } from "node:http";

import {
	type CarrierAttentionView,
	parseCarrierAttentionViews,
} from "./carrier-attention-view.ts";
import type { BridgeCommandBus } from "./bridge-command-bus.ts";
import { BrowserRealityBridgeError } from "./bridge-error.ts";
import {
	cookieValue,
	isRecord,
	readJson,
	send,
	sendText,
	stringField,
} from "./bridge-http.ts";

export interface BrowserRealityBridgeTaskWebOptions {
	html: string;
	script: string;
	invokeTask(
		operation: string,
		input: Record<string, unknown>,
	): Promise<unknown>;
	invokeApproval(
		operation: string,
		input: Record<string, unknown>,
	): Promise<unknown>;
}

export function createBridgeTaskWeb(options: {
	taskWeb?: BrowserRealityBridgeTaskWebOptions;
	now(): Date;
	idFactory(): string;
	commandBus: BridgeCommandBus;
}) {
	const taskBootstrap = new Map<string, number>();
	const taskSessions = new Map<string, number>();
	const taskCookie = "proflow_tasks_session";
	const taskBootstrapTtlMs = 60_000;
	const taskSessionTtlMs = 8 * 60 * 60_000;
	let carrierAttentions: CarrierAttentionView[] = [];

	const prune = () => {
		const current = options.now().getTime();
		for (const [key, expiresAt] of taskBootstrap)
			if (expiresAt <= current) taskBootstrap.delete(key);
		for (const [key, expiresAt] of taskSessions)
			if (expiresAt <= current) taskSessions.delete(key);
	};

	const sessionValid = (request: IncomingMessage) => {
		prune();
		const value = cookieValue(request, taskCookie);
		return value !== undefined && taskSessions.has(value);
	};

	return Object.freeze({
		updateCarrierAttentions(value: unknown): void {
			if (!Array.isArray(value))
				throw new BrowserRealityBridgeError(
					"BRIDGE_INPUT_INVALID",
					"carrier attentions must be an array",
				);
			const parsed = parseCarrierAttentionViews(value);
			if (value.length > 128 || parsed.length !== value.length)
				throw new BrowserRealityBridgeError(
					"BRIDGE_INPUT_INVALID",
					"carrier attentions contain invalid entries",
				);
			carrierAttentions = parsed;
		},
		createBootstrapUrl(endpoint: string): string {
			if (!options.taskWeb)
				throw new BrowserRealityBridgeError(
					"BRIDGE_INPUT_INVALID",
					"Task Web is not configured",
				);
			prune();
			const bootstrap = options.idFactory();
			taskBootstrap.set(
				bootstrap,
				options.now().getTime() + taskBootstrapTtlMs,
			);
			return `${endpoint}/tasks/bootstrap/${encodeURIComponent(bootstrap)}`;
		},
		async route(
			request: IncomingMessage,
			response: ServerResponse,
			url: URL,
			endpoint: string,
		): Promise<boolean> {
			const taskWeb = options.taskWeb;
			if (!taskWeb) return false;
			if (
				request.method === "GET" &&
				url.pathname.startsWith("/tasks/bootstrap/")
			) {
				prune();
				const bootstrap = decodeURIComponent(
					url.pathname.slice("/tasks/bootstrap/".length),
				);
				if (!taskBootstrap.has(bootstrap)) {
					send(response, 401, { error: "TASK_WEB_SESSION_INVALID" });
					return true;
				}
				taskBootstrap.delete(bootstrap);
				const sessionId = options.idFactory();
				taskSessions.set(sessionId, options.now().getTime() + taskSessionTtlMs);
				response.writeHead(302, {
					location: "/tasks",
					"cache-control": "no-store",
					"set-cookie": `${taskCookie}=${sessionId}; HttpOnly; SameSite=Strict; Path=/tasks; Max-Age=${Math.floor(taskSessionTtlMs / 1000)}`,
				});
				response.end();
				return true;
			}
			if (!url.pathname.startsWith("/tasks")) return false;
			if (!sessionValid(request)) {
				send(response, 401, { error: "TASK_WEB_SESSION_REQUIRED" });
				return true;
			}
			if (request.method === "GET" && url.pathname === "/tasks") {
				sendText(response, 200, "text/html; charset=utf-8", taskWeb.html);
				return true;
			}
			if (request.method === "GET" && url.pathname === "/tasks/app.js") {
				sendText(
					response,
					200,
					"text/javascript; charset=utf-8",
					taskWeb.script,
				);
				return true;
			}
			if (request.method === "GET" && url.pathname === "/tasks/api/status") {
				const status = options.commandBus.status();
				const session = options.commandBus.sessionInfo();
				send(response, 200, {
					ok: true,
					value: {
						taskApplicationConfigured: true,
						approvalApplicationConfigured: true,
						systemObserver: null,
						carrierAttentions,
						browserCarrier: {
							...status,
							moduleVersion: session?.moduleVersion ?? null,
						},
					},
				});
				return true;
			}
			if (
				request.method === "POST" &&
				url.pathname === "/tasks/api/carrier-attention"
			) {
				if (request.headers.origin !== endpoint) {
					send(response, 403, { error: "TASK_WEB_ORIGIN_INVALID" });
					return true;
				}
				const body = await readJson(request);
				if (!isRecord(body))
					throw new BrowserRealityBridgeError(
						"BRIDGE_INPUT_INVALID",
						"carrier attention action must be an object",
					);
				const attentionRef = stringField(body, "attentionRef");
				const action = body.action;
				if (action !== "allowOnce" && action !== "deny")
					throw new BrowserRealityBridgeError(
						"BRIDGE_INPUT_INVALID",
						"carrier attention action is invalid",
					);
				const attention = carrierAttentions.find(
					(candidate) => candidate.attentionRef === attentionRef,
				);
				if (!attention?.actions.includes(action))
					throw new BrowserRealityBridgeError(
						"BRIDGE_INPUT_INVALID",
						"carrier attention reference is stale or denied",
					);
				const value = await options.commandBus.request({
					type: "CARRIER_ATTENTION_ACTION",
					attentionRef,
					action,
				});
				send(response, 200, { ok: true, value });
				return true;
			}
			if (
				request.method === "POST" &&
				(url.pathname === "/tasks/api/task" ||
					url.pathname === "/tasks/api/approval")
			) {
				if (request.headers.origin !== endpoint) {
					send(response, 403, { error: "TASK_WEB_ORIGIN_INVALID" });
					return true;
				}
				const body = await readJson(request);
				if (
					!isRecord(body) ||
					typeof body.operation !== "string" ||
					!isRecord(body.input)
				)
					throw new BrowserRealityBridgeError(
						"BRIDGE_INPUT_INVALID",
						"task web request is invalid",
					);
				const value = url.pathname.endsWith("/task")
					? await taskWeb.invokeTask(body.operation, body.input)
					: await taskWeb.invokeApproval(body.operation, body.input);
				send(response, 200, { ok: true, value });
				return true;
			}
			send(response, 404, { error: "NOT_FOUND" });
			return true;
		},
		clear(): void {
			carrierAttentions = [];
			taskBootstrap.clear();
			taskSessions.clear();
		},
	});
}

export type BridgeTaskWeb = ReturnType<typeof createBridgeTaskWeb>;
