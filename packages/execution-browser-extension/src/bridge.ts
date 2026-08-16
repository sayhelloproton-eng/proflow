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

export interface BrowserRealityBridgeOptions {
	token: string;
	extensionId: string;
	host?: "127.0.0.1";
	port?: number;
	heartbeatFreshnessMs?: number;
	commandTimeoutMs?: number;
	now?: () => Date;
	idFactory?: () => string;
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
	const commandTimeoutMs = options.commandTimeoutMs ?? 15_000;
	const expectedOrigin = `chrome-extension://${options.extensionId}`;
	const queue: BridgeCommand[] = [];
	const pending = new Map<string, PendingCommand>();
	let session:
		| {
				extensionInstanceId: string;
				lastHeartbeatAt: number;
		  }
		| undefined;
	let closed = false;

	const authenticate = (request: IncomingMessage) => {
		const authorization = request.headers.authorization;
		const origin = request.headers.origin;
		if (
			!authorization?.startsWith("Bearer ") ||
			!safeEqual(authorization.slice(7), options.token) ||
			origin !== expectedOrigin
		)
			throw new BrowserRealityBridgeError(
				"BRIDGE_AUTH_INVALID",
				"bridge authentication failed",
			);
	};

	const server = createServer(async (request, response) => {
		try {
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
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			if (request.method === "POST" && url.pathname === "/v1/session/hello") {
				const body = await readJson(request);
				if (
					!isRecord(body) ||
					stringField(body, "extensionId") !== options.extensionId
				)
					throw new BrowserRealityBridgeError(
						"BRIDGE_AUTH_INVALID",
						"extension identity mismatch",
					);
				session = {
					extensionInstanceId: stringField(body, "extensionInstanceId"),
					lastHeartbeatAt: now().getTime(),
				};
				send(response, 200, { accepted: true });
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
				session.lastHeartbeatAt = now().getTime();
				const command = queue.shift();
				if (command) {
					const tracked = pending.get(command.commandId);
					if (tracked) tracked.stage = "DELIVERED";
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
	const endpoint = `http://127.0.0.1:${address.port}`;

	const online = () =>
		!closed &&
		session !== undefined &&
		now().getTime() - session.lastHeartbeatAt <= freshnessMs;

	const requestCommand = (command: BridgeCommandInput) => {
		if (!online())
			return Promise.reject(
				new BrowserRealityBridgeError(
					"BRIDGE_OFFLINE",
					"extension heartbeat is not fresh",
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
				extensionInstanceId: session?.extensionInstanceId ?? null,
				queuedCommands: queue.length,
				pendingCommands: pending.size,
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
			queue.length = 0;
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		},
	});
}
