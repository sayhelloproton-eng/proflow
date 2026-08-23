import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";

export type CustomGptProvisioningCommandInput = {
	type: "PROVISION_CUSTOM_GPT" | "FINALIZE_CUSTOM_GPT_AUTH";
	request: Record<string, unknown>;
};

type CustomGptProvisioningCommand = CustomGptProvisioningCommandInput & {
	commandId: string;
};

type PendingCommand = {
	command: CustomGptProvisioningCommand;
	stage: "QUEUED" | "DELIVERED";
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
};

export type ProvisioningRelayFileInput = {
	name: string;
	path: string;
	mime: string;
};

export type ProvisioningRelayFileDescriptor = {
	fileId: string;
	name: string;
	mime: string;
	sizeBytes: number;
	sha256: string;
	url: string;
};

type ProvisioningRelayFile = ProvisioningRelayFileDescriptor & { path: string };

export interface CustomGptProvisioningBridgeOptions {
	token: string;
	extensionId: string;
	host?: "127.0.0.1";
	port?: number;
	heartbeatFreshnessMs?: number;
	commandTimeoutMs?: number;
	now?: () => Date;
	idFactory?: () => string;
}

export class CustomGptProvisioningBridgeError extends Error {
	readonly code:
		| "PROVISIONING_AUTH_INVALID"
		| "PROVISIONING_INPUT_INVALID"
		| "PROVISIONING_OFFLINE"
		| "PROVISIONING_COMMAND_TIMEOUT"
		| "PROVISIONING_COMMAND_FAILED";
	constructor(code: CustomGptProvisioningBridgeError["code"], message: string) {
		super(message);
		this.name = "CustomGptProvisioningBridgeError";
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
	if (typeof item !== "string" || item.length === 0) {
		throw new CustomGptProvisioningBridgeError(
			"PROVISIONING_INPUT_INVALID",
			`${key} must be a non-empty string`,
		);
	}
	return item;
}

function sha256(bytes: Uint8Array): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function safeRelayName(value: string): boolean {
	return (
		value.length > 0 &&
		value.length <= 255 &&
		!value.includes("/") &&
		!value.includes("\\") &&
		!value.includes("\0")
	);
}

function safeMime(value: string): boolean {
	return /^[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[ a-z0-9=._+-]+)?$/i.test(value);
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
		if (body.length > 100_000) {
			throw new CustomGptProvisioningBridgeError(
				"PROVISIONING_INPUT_INVALID",
				"provisioning bridge body exceeds 100000 characters",
			);
		}
	}
	try {
		return body.length === 0 ? {} : JSON.parse(body);
	} catch {
		throw new CustomGptProvisioningBridgeError(
			"PROVISIONING_INPUT_INVALID",
			"provisioning bridge body is not valid JSON",
		);
	}
}

function send(response: ServerResponse, status: number, value?: unknown): void {
	response.writeHead(status, jsonHeaders);
	response.end(value === undefined ? "" : JSON.stringify(value));
}

export async function createCustomGptProvisioningBridgeServer(
	options: CustomGptProvisioningBridgeOptions,
) {
	if (options.token.length < 32) {
		throw new TypeError(
			"provisioning bridge token must contain at least 32 characters",
		);
	}
	if (!/^[a-z]{32}$/.test(options.extensionId)) {
		throw new TypeError(
			"extensionId must be a canonical Chromium extension id",
		);
	}
	const now = options.now ?? (() => new Date());
	const idFactory = options.idFactory ?? randomUUID;
	const freshnessMs = options.heartbeatFreshnessMs ?? 10_000;
	const commandTimeoutMs = options.commandTimeoutMs ?? 180_000;
	const expectedOrigin = `chrome-extension://${options.extensionId}`;
	const queue: CustomGptProvisioningCommand[] = [];
	const pending = new Map<string, PendingCommand>();
	const relayFiles = new Map<string, ProvisioningRelayFile>();
	let session:
		| { extensionInstanceId: string; lastHeartbeatAt: number }
		| undefined;
	let closed = false;

	const authenticate = (request: IncomingMessage) => {
		const authorization = request.headers.authorization;
		const origin = request.headers.origin;
		if (
			!authorization?.startsWith("Bearer ") ||
			!safeEqual(authorization.slice(7), options.token) ||
			origin !== expectedOrigin
		) {
			throw new CustomGptProvisioningBridgeError(
				"PROVISIONING_AUTH_INVALID",
				"provisioning bridge authentication failed",
			);
		}
	};

	const assertSession = (url: URL) => {
		if (!session) {
			throw new CustomGptProvisioningBridgeError(
				"PROVISIONING_OFFLINE",
				"provisioning session has not completed hello",
			);
		}
		if (
			url.searchParams.get("extensionInstanceId") !==
			session.extensionInstanceId
		) {
			throw new CustomGptProvisioningBridgeError(
				"PROVISIONING_AUTH_INVALID",
				"stale provisioning extension session",
			);
		}
	};

	const server = createServer(async (request, response) => {
		try {
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			if (
				request.method === "GET" &&
				url.pathname.startsWith("/v1/provisioning/files/")
			) {
				response.setHeader(
					"access-control-allow-origin",
					"https://chatgpt.com",
				);
				response.setHeader("vary", "origin");
				if (request.headers.origin !== "https://chatgpt.com")
					throw new CustomGptProvisioningBridgeError(
						"PROVISIONING_AUTH_INVALID",
						"provisioning file relay origin is invalid",
					);
				if (!session || now().getTime() - session.lastHeartbeatAt > freshnessMs)
					throw new CustomGptProvisioningBridgeError(
						"PROVISIONING_OFFLINE",
						"provisioning extension heartbeat is not fresh",
					);
				const fileId = decodeURIComponent(
					url.pathname.slice("/v1/provisioning/files/".length),
				);
				const relay = relayFiles.get(fileId);
				if (!relay) {
					send(response, 404, { error: "NOT_FOUND" });
					return;
				}
				relayFiles.delete(fileId);
				const bytes = await readFile(relay.path);
				if (bytes.length !== relay.sizeBytes || sha256(bytes) !== relay.sha256)
					throw new CustomGptProvisioningBridgeError(
						"PROVISIONING_INPUT_INVALID",
						"registered provisioning file changed before relay",
					);
				response.writeHead(200, {
					"access-control-allow-origin": "https://chatgpt.com",
					vary: "origin",
					"content-type": relay.mime,
					"content-length": String(bytes.length),
					"cache-control": "no-store",
					"content-disposition": `attachment; filename="${relay.name.replace(/["\r\n]/g, "_")}"`,
				});
				response.end(bytes);
				return;
			}
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
				request.method === "POST" &&
				url.pathname === "/v1/provisioning/session/hello"
			) {
				const body = await readJson(request);
				if (
					!isRecord(body) ||
					stringField(body, "extensionId") !== options.extensionId
				) {
					throw new CustomGptProvisioningBridgeError(
						"PROVISIONING_AUTH_INVALID",
						"provisioning extension identity mismatch",
					);
				}
				session = {
					extensionInstanceId: stringField(body, "extensionInstanceId"),
					lastHeartbeatAt: now().getTime(),
				};
				send(response, 200, { accepted: true });
				return;
			}
			assertSession(url);
			if (
				request.method === "POST" &&
				url.pathname === "/v1/provisioning/session/heartbeat"
			) {
				if (session) session.lastHeartbeatAt = now().getTime();
				send(response, 200, { accepted: true });
				return;
			}
			if (
				request.method === "GET" &&
				url.pathname === "/v1/provisioning/commands/next"
			) {
				if (session) session.lastHeartbeatAt = now().getTime();
				const command = queue.shift();
				if (command) {
					const tracked = pending.get(command.commandId);
					if (tracked) tracked.stage = "DELIVERED";
				}
				send(response, command ? 200 : 204, command);
				return;
			}
			if (
				request.method === "POST" &&
				url.pathname === "/v1/provisioning/commands/result"
			) {
				const body = await readJson(request);
				if (!isRecord(body)) {
					throw new CustomGptProvisioningBridgeError(
						"PROVISIONING_INPUT_INVALID",
						"provisioning command result must be an object",
					);
				}
				const commandId = stringField(body, "commandId");
				const tracked = pending.get(commandId);
				if (!tracked) {
					throw new CustomGptProvisioningBridgeError(
						"PROVISIONING_INPUT_INVALID",
						"provisioning command result is stale or unknown",
					);
				}
				pending.delete(commandId);
				clearTimeout(tracked.timer);
				if (body.ok === true) tracked.resolve(body.value);
				else {
					tracked.reject(
						new CustomGptProvisioningBridgeError(
							"PROVISIONING_COMMAND_FAILED",
							typeof body.error === "string"
								? body.error
								: "provisioning extension command failed",
						),
					);
				}
				send(response, 200, { accepted: true });
				return;
			}
			send(response, 404, { error: "NOT_FOUND" });
		} catch (error) {
			const bridgeError =
				error instanceof CustomGptProvisioningBridgeError
					? error
					: new CustomGptProvisioningBridgeError(
							"PROVISIONING_INPUT_INVALID",
							error instanceof Error
								? error.message
								: "provisioning request failed",
						);
			send(
				response,
				bridgeError.code === "PROVISIONING_AUTH_INVALID" ? 401 : 400,
				{ error: bridgeError.code },
			);
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
		throw new Error("provisioning bridge address missing");
	const endpoint = `http://127.0.0.1:${address.port}`;

	const online = () =>
		!closed &&
		session !== undefined &&
		now().getTime() - session.lastHeartbeatAt <= freshnessMs;

	const requestProvisioning = (input: CustomGptProvisioningCommandInput) => {
		if (
			!new Set(["PROVISION_CUSTOM_GPT", "FINALIZE_CUSTOM_GPT_AUTH"]).has(
				input.type,
			) ||
			!isRecord(input.request)
		) {
			return Promise.reject(
				new CustomGptProvisioningBridgeError(
					"PROVISIONING_INPUT_INVALID",
					"unsupported provisioning command",
				),
			);
		}
		if (!online()) {
			return Promise.reject(
				new CustomGptProvisioningBridgeError(
					"PROVISIONING_OFFLINE",
					"provisioning extension heartbeat is not fresh",
				),
			);
		}
		const commandId = `provisioning-command:${idFactory()}`;
		const command: CustomGptProvisioningCommand = { ...input, commandId };
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				const tracked = pending.get(commandId);
				if (tracked?.stage === "QUEUED") {
					const index = queue.findIndex((item) => item.commandId === commandId);
					if (index >= 0) queue.splice(index, 1);
				}
				pending.delete(commandId);
				reject(
					new CustomGptProvisioningBridgeError(
						"PROVISIONING_COMMAND_TIMEOUT",
						"provisioning extension command result timed out",
					),
				);
			}, commandTimeoutMs);
			pending.set(commandId, {
				command,
				stage: "QUEUED",
				resolve,
				reject,
				timer,
			});
			queue.push(command);
		});
	};

	const registerFiles = async (
		files: readonly ProvisioningRelayFileInput[],
	): Promise<ProvisioningRelayFileDescriptor[]> => {
		if (!online())
			throw new CustomGptProvisioningBridgeError(
				"PROVISIONING_OFFLINE",
				"provisioning extension heartbeat is not fresh",
			);
		if (!Array.isArray(files) || files.length === 0 || files.length > 64)
			throw new CustomGptProvisioningBridgeError(
				"PROVISIONING_INPUT_INVALID",
				"provisioning relay file list is invalid",
			);
		const descriptors: ProvisioningRelayFileDescriptor[] = [];
		for (const file of files) {
			if (
				!safeRelayName(file.name) ||
				!safeMime(file.mime) ||
				file.path.length === 0
			)
				throw new CustomGptProvisioningBridgeError(
					"PROVISIONING_INPUT_INVALID",
					"provisioning relay file metadata is invalid",
				);
			const bytes = await readFile(file.path);
			const fileId = `file:${idFactory()}`;
			const descriptor: ProvisioningRelayFileDescriptor = {
				fileId,
				name: file.name,
				mime: file.mime,
				sizeBytes: bytes.length,
				sha256: sha256(bytes),
				url: `${endpoint}/v1/provisioning/files/${encodeURIComponent(fileId)}`,
			};
			relayFiles.set(fileId, { ...descriptor, path: file.path });
			descriptors.push(descriptor);
		}
		return descriptors;
	};

	return Object.freeze({
		endpoint,
		provisioning: Object.freeze({
			request: requestProvisioning,
			registerFiles,
		}),
		status() {
			return {
				online: online(),
				extensionInstanceId: session?.extensionInstanceId ?? null,
				queuedCommands: queue.length,
				pendingCommands: pending.size,
				relayFiles: relayFiles.size,
			};
		},
		async close() {
			closed = true;
			for (const item of pending.values()) {
				clearTimeout(item.timer);
				item.reject(
					new CustomGptProvisioningBridgeError(
						"PROVISIONING_OFFLINE",
						"provisioning bridge server closed",
					),
				);
			}
			pending.clear();
			queue.length = 0;
			relayFiles.clear();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		},
	});
}
