import { timingSafeEqual } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";

export interface BrowserExtensionPairingOptions {
	token: string;
	host?: "127.0.0.1";
	port?: number;
	pairingTimeoutMs?: number;
}

export type BrowserExtensionPairingResult = {
	extensionId: string;
	extensionInstanceId: string;
};

type PairingIdentity = BrowserExtensionPairingResult;
type PairingWaiter = {
	resolve(value: BrowserExtensionPairingResult): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
};

const jsonHeaders = {
	"content-type": "application/json; charset=utf-8",
	"cache-control": "no-store",
};

function safeEqual(left: string, right: string): boolean {
	const leftBytes = Buffer.from(left);
	const rightBytes = Buffer.from(right);
	return (
		leftBytes.length === rightBytes.length &&
		timingSafeEqual(leftBytes, rightBytes)
	);
}

function send(response: ServerResponse, status: number, value?: unknown): void {
	response.writeHead(status, jsonHeaders);
	response.end(value === undefined ? "" : JSON.stringify(value));
}

async function readJson(
	request: IncomingMessage,
): Promise<Record<string, unknown>> {
	let body = "";
	for await (const chunk of request) {
		body += String(chunk);
		if (body.length > 10_000) throw new Error("PAIRING_INPUT_INVALID");
	}
	const parsed = body.length === 0 ? {} : (JSON.parse(body) as unknown);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("PAIRING_INPUT_INVALID");
	}
	return parsed as Record<string, unknown>;
}

function text(value: unknown): string {
	if (typeof value !== "string" || value.length === 0)
		throw new Error("PAIRING_INPUT_INVALID");
	return value;
}

function extensionIdentity(request: IncomingMessage): string | undefined {
	const origin = request.headers.origin;
	if (origin === undefined) return undefined;
	const match = /^chrome-extension:\/\/([a-z]{32})$/.exec(origin);
	if (!match) throw new Error("PAIRING_AUTH_INVALID");
	return match[1] as string;
}

function authenticate(request: IncomingMessage, token: string): void {
	const authorization = request.headers.authorization;
	if (
		!authorization?.startsWith("Bearer ") ||
		!safeEqual(authorization.slice(7), token)
	) {
		throw new Error("PAIRING_AUTH_INVALID");
	}
}

export async function createBrowserExtensionPairingServer(
	options: BrowserExtensionPairingOptions,
) {
	if (options.token.length < 32) {
		throw new TypeError("pairing token must contain at least 32 characters");
	}
	const timeoutMs = options.pairingTimeoutMs ?? 120_000;
	let identity: PairingIdentity | undefined;
	let paired: PairingIdentity | undefined;
	let closed = false;
	const waiters = new Set<PairingWaiter>();

	const resolveWaiters = (value: PairingIdentity) => {
		for (const waiter of waiters) {
			clearTimeout(waiter.timer);
			waiter.resolve(value);
		}
		waiters.clear();
	};

	const rejectWaiters = (error: Error) => {
		for (const waiter of waiters) {
			clearTimeout(waiter.timer);
			waiter.reject(error);
		}
		waiters.clear();
	};

	const server = createServer(async (request, response) => {
		try {
			const originId = extensionIdentity(request);
			if (originId) {
				response.setHeader(
					"access-control-allow-origin",
					`chrome-extension://${originId}`,
				);
				response.setHeader("vary", "origin");
			}
			if (request.method === "OPTIONS") {
				if (!originId) throw new Error("PAIRING_AUTH_INVALID");
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

			authenticate(request, options.token);
			const url = new URL(request.url ?? "/", "http://127.0.0.1");

			if (request.method === "POST" && url.pathname === "/v1/session/hello") {
				const body = await readJson(request);
				const extensionId = text(body.extensionId);
				const extensionInstanceId = text(body.extensionInstanceId);
				if (!originId || extensionId !== originId)
					throw new Error("PAIRING_AUTH_INVALID");
				if (identity && identity.extensionId !== extensionId) {
					throw new Error("PAIRING_AUTH_INVALID");
				}
				identity = { extensionId, extensionInstanceId };
				send(response, 200, { accepted: true });
				return;
			}

			if (
				!identity ||
				(originId !== undefined && originId !== identity.extensionId)
			) {
				throw new Error("PAIRING_AUTH_INVALID");
			}
			if (
				url.searchParams.get("extensionInstanceId") !==
				identity.extensionInstanceId
			) {
				throw new Error("PAIRING_AUTH_INVALID");
			}

			if (
				request.method === "POST" &&
				url.pathname === "/v1/session/heartbeat"
			) {
				paired = { ...identity };
				resolveWaiters(paired);
				send(response, 200, { accepted: true });
				return;
			}

			if (request.method === "GET" && url.pathname === "/v1/commands/next") {
				send(response, 204);
				return;
			}

			send(response, 404, { error: "NOT_FOUND" });
		} catch (error) {
			const code =
				error instanceof Error ? error.message : "PAIRING_INPUT_INVALID";
			const status = code === "PAIRING_AUTH_INVALID" ? 401 : 400;
			send(response, status, { error: code });
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
		throw new Error("pairing address missing");
	const endpoint = `http://127.0.0.1:${address.port}`;

	return Object.freeze({
		endpoint,
		status() {
			return {
				paired: paired !== undefined,
				extensionId: identity?.extensionId ?? null,
				extensionInstanceId: identity?.extensionInstanceId ?? null,
			};
		},
		waitForPairing() {
			if (paired) return Promise.resolve({ ...paired });
			if (closed) return Promise.reject(new Error("PAIRING_CLOSED"));
			return new Promise<BrowserExtensionPairingResult>((resolve, reject) => {
				const waiter: PairingWaiter = {
					resolve,
					reject,
					timer: setTimeout(() => {
						waiters.delete(waiter);
						reject(new Error("PAIRING_TIMEOUT"));
					}, timeoutMs),
				};
				waiters.add(waiter);
			});
		},

		async close() {
			if (closed) return;
			closed = true;
			rejectWaiters(new Error("PAIRING_CLOSED"));
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
				server.closeAllConnections();
			});
		},
	});
}
