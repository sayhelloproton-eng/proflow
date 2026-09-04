import { randomUUID, timingSafeEqual } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";

import type { ExecuteCapabilityRequest } from "@tomflow/proflow-execution-contracts";
import type { BrowserPageObservation, BrowserRealityPort } from "./index.ts";

type BridgeCommand =
	| { commandId: string; type: "LIST_TABS" }
	| { commandId: string; type: "OPEN"; url: string }
	| { commandId: string; type: "OBSERVE"; tabId: number }
	| {
			commandId: string;
			type: "SUBMIT";
			tabId: number;
			text: string;
			fingerprint: string;
	  }
	| { commandId: string; type: "VERIFY"; tabId: number; fingerprint: string }
	| { commandId: string; type: "SCREENSHOT"; tabId: number }
	| {
			commandId: string;
			type: "PERFORM";
			tabId: number;
			request: ExecuteCapabilityRequest;
	  };
type BridgeCommandInput = BridgeCommand extends infer Command
	? Command extends { commandId: string }
		? Omit<Command, "commandId">
		: never
	: never;

type PendingCommand = {
	command: BridgeCommand;
	stage: "QUEUED" | "DELIVERED";
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
};

export interface BrowserRealityBridgeTaskWebOptions {
	html: string;
	script: string;
	invokeTask(operation: string, input: Record<string, unknown>): Promise<unknown>;
	invokeApproval(operation: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface BrowserRealityBridgeOptions {
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

export class BrowserRealityBridgeError extends Error {
	readonly code:
		| "BRIDGE_AUTH_INVALID"
		| "BRIDGE_INPUT_INVALID"
		| "BRIDGE_OFFLINE"
		| "BRIDGE_COMMAND_TIMEOUT"
		| "BRIDGE_COMMAND_FAILED";
	constructor(code: BrowserRealityBridgeError["code"], message: string) {
		super(message);
		this.name = "BrowserRealityBridgeError";
		this.code = code;
	}
}

const jsonHeaders = {
	"content-type": "application/json; charset=utf-8",
	"cache-control": "no-store",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string {
	const item = value[key];
	if (typeof item !== "string" || item.length === 0)
		throw new BrowserRealityBridgeError(
			"BRIDGE_INPUT_INVALID",
			`${key} must be a non-empty string`,
		);
	return item;
}

function numberField(value: Record<string, unknown>, key: string): number {
	const item = value[key];
	if (typeof item !== "number" || !Number.isFinite(item))
		throw new BrowserRealityBridgeError(
			"BRIDGE_INPUT_INVALID",
			`${key} must be a finite number`,
		);
	return item;
}

function parseObservation(value: unknown): BrowserPageObservation {
	if (!isRecord(value))
		throw new BrowserRealityBridgeError(
			"BRIDGE_INPUT_INVALID",
			"observation must be an object",
		);
	const tabId = value.tabId;
	const windowId = value.windowId;
	const pageState = value.pageState;
	const activityKind = value.activityKind;
	if (!Number.isInteger(tabId) || !Number.isInteger(windowId))
		throw new BrowserRealityBridgeError(
			"BRIDGE_INPUT_INVALID",
			"observation tab and window identity must be integers",
		);
	if (!["IDLE", "BUSY", "BLOCKED", "UNKNOWN"].includes(String(pageState)))
		throw new BrowserRealityBridgeError(
			"BRIDGE_INPUT_INVALID",
			"observation page state is invalid",
		);
	if (
		activityKind !== null &&
		![
			"GENERATING",
			"ACTION_PERMISSION",
			"ACTION_RUNNING",
			"WAITING_HUMAN",
			"WAITING_PEER",
			"RECOVERING",
		].includes(String(activityKind))
	)
		throw new BrowserRealityBridgeError(
			"BRIDGE_INPUT_INVALID",
			"observation activity kind is invalid",
		);
	return {
		tabId: tabId as number,
		windowId: windowId as number,
		url: stringField(value, "url"),
		contentInstanceId: stringField(value, "contentInstanceId"),
		pageState: pageState as BrowserPageObservation["pageState"],
		activityKind: activityKind as BrowserPageObservation["activityKind"],
		observedAt: stringField(value, "observedAt"),
	};
}

function safeEqual(left: string, right: string): boolean {
	const leftBytes = Buffer.from(left);
	const rightBytes = Buffer.from(right);
	return (
		leftBytes.length === rightBytes.length &&
		timingSafeEqual(leftBytes, rightBytes)
	);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
	let body = "";
	for await (const chunk of request) {
		body += String(chunk);
		if (body.length > 100_000)
			throw new BrowserRealityBridgeError(
				"BRIDGE_INPUT_INVALID",
				"bridge body exceeds 100000 characters",
			);
	}
	try {
		return body.length === 0 ? {} : JSON.parse(body);
	} catch {
		throw new BrowserRealityBridgeError(
			"BRIDGE_INPUT_INVALID",
			"bridge body is not valid JSON",
		);
	}
}

function send(response: ServerResponse, status: number, value?: unknown): void {
	response.writeHead(status, jsonHeaders);
	response.end(value === undefined ? "" : JSON.stringify(value));
}

function sendText(
	response: ServerResponse,
	status: number,
	contentType: string,
	value: string,
): void {
	response.writeHead(status, {
		"content-type": contentType,
		"cache-control": "no-store",
		"content-security-policy":
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
		"x-content-type-options": "nosniff",
		"referrer-policy": "no-referrer",
	});
	response.end(value);
}

function cookieValue(request: IncomingMessage, name: string): string | undefined {
	for (const part of (request.headers.cookie ?? "").split(";")) {
		const [key, ...rest] = part.trim().split("=");
		if (key === name) return rest.join("=");
	}
	return undefined;
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
	const now = options.now ?? (() => new Date());
	const idFactory = options.idFactory ?? randomUUID;
	const freshnessMs = options.heartbeatFreshnessMs ?? 10_000;
	// Browser commands are Promise-driven. This is only an abnormal hung-command
	// watchdog; normal page load / content observation must not be scheduled by it.
	const commandTimeoutMs = options.commandTimeoutMs ?? 120_000;
	const expectedOrigin = `chrome-extension://${options.extensionId}`;
	const queue: BridgeCommand[] = [];
	const pending = new Map<string, PendingCommand>();
	let session:
		| {
				extensionInstanceId: string;
				lastHeartbeatAt: number;
		  }
		| undefined;
	let lastCommandPollAt: string | null = null;
	let lastCommandDeliveredAt: string | null = null;
	let lastCommandResultAt: string | null = null;
	let lastCommandConsumerAt: number | null = null;
	let closed = false;
	let endpoint = "";
	const taskBootstrap = new Map<string, number>();
	const taskSessions = new Map<string, number>();
	const taskCookie = "proflow_tasks_session";
	const taskBootstrapTtlMs = 60_000;
	const taskSessionTtlMs = 8 * 60 * 60_000;
	const sessionOnline = () =>
		!closed &&
		session !== undefined &&
		now().getTime() - session.lastHeartbeatAt <= freshnessMs;
	const commandConsumerReady = () =>
		sessionOnline() &&
		lastCommandConsumerAt !== null &&
		now().getTime() - lastCommandConsumerAt <= freshnessMs;
	const online = commandConsumerReady;

	const pruneTaskWebState = () => {
		const current = now().getTime();
		for (const [key, expiresAt] of taskBootstrap)
			if (expiresAt <= current) taskBootstrap.delete(key);
		for (const [key, expiresAt] of taskSessions)
			if (expiresAt <= current) taskSessions.delete(key);
	};

	const taskSessionValid = (request: IncomingMessage) => {
		pruneTaskWebState();
		const value = cookieValue(request, taskCookie);
		return value !== undefined && taskSessions.has(value);
	};

	const authenticate = (request: IncomingMessage) => {
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
	const requireExtensionOrigin = (request: IncomingMessage) => {
		if (request.headers.origin !== expectedOrigin)
			throw new BrowserRealityBridgeError(
				"BRIDGE_AUTH_INVALID",
				"bridge extension origin is required",
			);
	};

	const server = createServer(async (request, response) => {
		try {
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			if (options.taskWeb && request.method === "GET" && url.pathname.startsWith("/tasks/bootstrap/")) {
				pruneTaskWebState();
				const bootstrap = decodeURIComponent(url.pathname.slice("/tasks/bootstrap/".length));
				if (!taskBootstrap.has(bootstrap)) {
					send(response, 401, { error: "TASK_WEB_SESSION_INVALID" });
					return;
				}
				taskBootstrap.delete(bootstrap);
				const sessionId = idFactory();
				taskSessions.set(sessionId, now().getTime() + taskSessionTtlMs);
				response.writeHead(302, {
					location: "/tasks",
					"cache-control": "no-store",
					"set-cookie": `${taskCookie}=${sessionId}; HttpOnly; SameSite=Strict; Path=/tasks; Max-Age=${Math.floor(taskSessionTtlMs / 1000)}`,
				});
				response.end();
				return;
			}
			if (options.taskWeb && url.pathname.startsWith("/tasks")) {
				if (!taskSessionValid(request)) {
					send(response, 401, { error: "TASK_WEB_SESSION_REQUIRED" });
					return;
				}
				if (request.method === "GET" && url.pathname === "/tasks") {
					sendText(response, 200, "text/html; charset=utf-8", options.taskWeb.html);
					return;
				}
				if (request.method === "GET" && url.pathname === "/tasks/app.js") {
					sendText(response, 200, "text/javascript; charset=utf-8", options.taskWeb.script);
					return;
				}
				if (request.method === "GET" && url.pathname === "/tasks/api/status") {
					send(response, 200, {
						ok: true,
						value: {
							taskApplicationConfigured: true,
							approvalApplicationConfigured: true,
							systemObserver: null,
							browserCarrier: {
								online: commandConsumerReady(),
								sessionOnline: sessionOnline(),
								commandConsumerReady: commandConsumerReady(),
								extensionInstanceId: session?.extensionInstanceId ?? null,
								queuedCommands: queue.length,
								pendingCommands: pending.size,
								lastCommandPollAt,
								lastCommandDeliveredAt,
								lastCommandResultAt,
							},
						},
					});
					return;
				}
				if (request.method === "POST" && (url.pathname === "/tasks/api/task" || url.pathname === "/tasks/api/approval")) {
					if (request.headers.origin !== endpoint) {
						send(response, 403, { error: "TASK_WEB_ORIGIN_INVALID" });
						return;
					}
					const body = await readJson(request);
					if (!isRecord(body) || typeof body.operation !== "string" || !isRecord(body.input))
						throw new BrowserRealityBridgeError("BRIDGE_INPUT_INVALID", "task web request is invalid");
					const value = url.pathname.endsWith("/task")
						? await options.taskWeb.invokeTask(body.operation, body.input)
						: await options.taskWeb.invokeApproval(body.operation, body.input);
					send(response, 200, { ok: true, value });
					return;
				}
				send(response, 404, { error: "NOT_FOUND" });
				return;
			}

			response.setHeader("access-control-allow-origin", expectedOrigin);
			response.setHeader("vary", "origin");
			if (request.method === "OPTIONS") {
				response.setHeader("access-control-allow-headers", "authorization, content-type");
				response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
				response.writeHead(204);
				response.end();
				return;
			}
			authenticate(request);
			if (options.taskWeb && request.method === "POST" && url.pathname === "/v1/tasks/session") {
				pruneTaskWebState();
				const bootstrap = idFactory();
				taskBootstrap.set(bootstrap, now().getTime() + taskBootstrapTtlMs);
				send(response, 200, { url: `${endpoint}/tasks/bootstrap/${encodeURIComponent(bootstrap)}` });
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
				const extensionInstanceId = stringField(body, "extensionInstanceId");
				if (session?.extensionInstanceId !== extensionInstanceId) {
					lastCommandPollAt = null;
					lastCommandDeliveredAt = null;
					lastCommandResultAt = null;
					lastCommandConsumerAt = null;
				}
				session = {
					extensionInstanceId,
					lastHeartbeatAt: now().getTime(),
				};
				send(response, 200, { accepted: true });
				return;
			}
			if (request.method === "GET" && url.pathname === "/v1/session/status") {
				send(response, 200, {
					online: commandConsumerReady(),
					sessionOnline: sessionOnline(),
					commandConsumerReady: commandConsumerReady(),
					extensionInstanceId: session?.extensionInstanceId ?? null,
				});
				return;
			}
			if (!session)
				throw new BrowserRealityBridgeError(
					"BRIDGE_OFFLINE",
					"extension session has not completed hello",
				);
			if (
				url.searchParams.get("extensionInstanceId") !==
				session.extensionInstanceId
			)
				throw new BrowserRealityBridgeError(
					"BRIDGE_AUTH_INVALID",
					"stale extension session",
				);
			if (
				request.method === "POST" &&
				url.pathname === "/v1/session/heartbeat"
			) {
				session.lastHeartbeatAt = now().getTime();
				send(response, 200, { accepted: true });
				return;
			}
			if (request.method === "GET" && url.pathname === "/v1/commands/next") {
				const stamp = now();
				session.lastHeartbeatAt = stamp.getTime();
				lastCommandConsumerAt = stamp.getTime();
				lastCommandPollAt = stamp.toISOString();
				const command = queue.shift();
				if (command) {
					const tracked = pending.get(command.commandId);
					if (tracked) tracked.stage = "DELIVERED";
					lastCommandDeliveredAt = lastCommandPollAt;
				}
				send(response, command ? 200 : 204, command);
				return;
			}
			if (request.method === "POST" && url.pathname === "/v1/commands/result") {
				const body = await readJson(request);
				if (!isRecord(body))
					throw new BrowserRealityBridgeError(
						"BRIDGE_INPUT_INVALID",
						"command result must be an object",
					);
				const commandId = stringField(body, "commandId");
				const command = pending.get(commandId);
				if (!command)
					throw new BrowserRealityBridgeError(
						"BRIDGE_INPUT_INVALID",
						"command result is stale or unknown",
					);
				pending.delete(commandId);
				clearTimeout(command.timer);
				const resultStamp = now();
				session.lastHeartbeatAt = resultStamp.getTime();
				lastCommandConsumerAt = resultStamp.getTime();
				lastCommandResultAt = resultStamp.toISOString();
				if (body.ok === true) command.resolve(body.value);
				else
					command.reject(
						new BrowserRealityBridgeError(
							"BRIDGE_COMMAND_FAILED",
							typeof body.error === "string"
								? body.error
								: "extension command failed",
						),
					);
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

	const requestCommand = (command: BridgeCommandInput) => {
		if (!online())
			return Promise.reject(
				new BrowserRealityBridgeError(
					"BRIDGE_OFFLINE",
					"extension command consumer is not ready",
				),
			);
		const commandId = `browser-command:${idFactory()}`;
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				const tracked = pending.get(commandId);
				if (tracked?.stage === "QUEUED") {
					const index = queue.findIndex((item) => item.commandId === commandId);
					if (index >= 0) queue.splice(index, 1);
				}
				pending.delete(commandId);
				reject(
					new BrowserRealityBridgeError(
						"BRIDGE_COMMAND_TIMEOUT",
						"extension command result timed out",
					),
				);
			}, commandTimeoutMs);
			const materialized = { ...command, commandId } as BridgeCommand;
			pending.set(commandId, {
				command: materialized,
				stage: "QUEUED",
				resolve,
				reject,
				timer,
			});
			queue.push(materialized);
		});
	};

	const browser: BrowserRealityPort = {
		async listTabs() {
			const value = await requestCommand({ type: "LIST_TABS" });
			if (!Array.isArray(value))
				throw new BrowserRealityBridgeError(
					"BRIDGE_INPUT_INVALID",
					"LIST_TABS result must be an array",
				);
			return value.map(parseObservation);
		},
		async open(url: string) {
			return parseObservation(await requestCommand({ type: "OPEN", url }));
		},
		async observe(tabId: number) {
			return parseObservation(await requestCommand({ type: "OBSERVE", tabId }));
		},
		async submit(tabId: number, text: string, fingerprint: string) {
			return parseObservation(
				await requestCommand({ type: "SUBMIT", tabId, text, fingerprint }),
			);
		},
		async hasMessage(tabId: number, fingerprint: string) {
			const value = await requestCommand({
				type: "VERIFY",
				tabId,
				fingerprint,
			});
			if (!isRecord(value) || typeof value.verified !== "boolean")
				throw new BrowserRealityBridgeError(
					"BRIDGE_INPUT_INVALID",
					"VERIFY result is invalid",
				);
			return value.verified;
		},
		async screenshot(tabId: number) {
			const value = await requestCommand({ type: "SCREENSHOT", tabId });
			if (!isRecord(value))
				throw new BrowserRealityBridgeError(
					"BRIDGE_INPUT_INVALID",
					"SCREENSHOT result is invalid",
				);
			return {
				evidenceRef: stringField(value, "evidenceRef"),
				dataUrl: stringField(value, "dataUrl"),
				mimeType: stringField(value, "mimeType"),
				sizeBytes: numberField(value, "sizeBytes"),
				hash: stringField(value, "hash"),
			};
		},
		async perform(request, tabId) {
			return parseObservation(
				await requestCommand({ type: "PERFORM", tabId, request }),
			);
		},
	};

	return Object.freeze({
		endpoint,
		browser,
		status() {
			return {
				online: online(),
				sessionOnline: sessionOnline(),
				commandConsumerReady: commandConsumerReady(),
				extensionInstanceId: session?.extensionInstanceId ?? null,
				queuedCommands: queue.length,
				pendingCommands: pending.size,
				lastCommandPollAt,
				lastCommandDeliveredAt,
				lastCommandResultAt,
			};
		},
		async close() {
			closed = true;
			for (const item of pending.values()) {
				clearTimeout(item.timer);
				item.reject(
					new BrowserRealityBridgeError(
						"BRIDGE_OFFLINE",
						"bridge server closed",
					),
				);
			}
			pending.clear();
			taskBootstrap.clear();
			taskSessions.clear();
			queue.length = 0;
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		},
	});
}
