import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { isAbsolute, resolve } from "node:path";

export const localToolNames = ["localDev", "repomix", "codeGraph"] as const;
export type LocalToolName = (typeof localToolNames)[number];

export type LocalToolCommandInput = {
	authenticatedRoleRef: string;
	workspaceRoot: string;
	tool: LocalToolName;
	operation: string;
	input: unknown;
	deadlineAt: string;
	notices?: readonly string[];
};

export type LocalToolCommand = LocalToolCommandInput & {
	commandId: string;
	generation: string;
	commandDigest: string;
};

type PendingCommand = {
	command: LocalToolCommand;
	stage: "QUEUED" | "CLAIMED" | "EXECUTING";
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
};

export interface LocalToolBridgeOptions {
	hostToken: string;
	extensionToken: string;
	extensionId: string;
	generation: string;
	workspaceRoot: string;
	host?: "127.0.0.1";
	port?: number;
	heartbeatFreshnessMs?: number;
	commandTimeoutMs?: number;
	maxConcurrentCommands?: number;
	maxPendingCommands?: number;
	now?: () => Date;
	idFactory?: () => string;
	prepare?: (
		command: LocalToolCommandInput,
	) =>
		| Promise<{ notices?: readonly string[] }>
		| { notices?: readonly string[] };
	execute?: (command: LocalToolCommand) => Promise<unknown>;
}

export class LocalToolBridgeError extends Error {
	readonly code:
		| "LOCAL_TOOL_AUTH_INVALID"
		| "LOCAL_TOOL_INPUT_INVALID"
		| "LOCAL_TOOL_OFFLINE"
		| "LOCAL_TOOL_COMMAND_TIMEOUT"
		| "LOCAL_TOOL_RESULT_UNKNOWN"
		| "LOCAL_TOOL_PROVIDER_UNAVAILABLE"
		| "LOCAL_TOOL_SCOPE_DENIED"
		| "LOCAL_TOOL_COMMAND_FAILED";

	constructor(code: LocalToolBridgeError["code"], message: string) {
		super(message);
		this.name = "LocalToolBridgeError";
		this.code = code;
	}
}

const jsonHeaders = {
	"content-type": "application/json; charset=utf-8",
	"cache-control": "no-store",
};
const MAX_BRIDGE_RESULT_CHARS = 90_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown, name: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new LocalToolBridgeError(
			"LOCAL_TOOL_INPUT_INVALID",
			`${name} must be a non-empty string`,
		);
	return value;
}

function safeEqual(left: string, right: string): boolean {
	const leftBytes = Buffer.from(left);
	const rightBytes = Buffer.from(right);
	return (
		leftBytes.length === rightBytes.length &&
		timingSafeEqual(leftBytes, rightBytes)
	);
}

function authenticate(request: IncomingMessage, token: string): void {
	const authorization = request.headers.authorization;
	if (
		!authorization?.startsWith("Bearer ") ||
		!safeEqual(authorization.slice("Bearer ".length), token)
	)
		throw new LocalToolBridgeError(
			"LOCAL_TOOL_AUTH_INVALID",
			"local tool bridge authentication failed",
		);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
	let body = "";
	for await (const chunk of request) {
		body += String(chunk);
		if (body.length > 200_000)
			throw new LocalToolBridgeError(
				"LOCAL_TOOL_INPUT_INVALID",
				"local tool bridge body exceeds 200000 characters",
			);
	}
	try {
		return body.length === 0 ? {} : JSON.parse(body);
	} catch {
		throw new LocalToolBridgeError(
			"LOCAL_TOOL_INPUT_INVALID",
			"local tool bridge body is not valid JSON",
		);
	}
}

function send(response: ServerResponse, status: number, value?: unknown): void {
	response.writeHead(status, jsonHeaders);
	response.end(value === undefined ? "" : JSON.stringify(value));
}

const bridgeErrorCodes = new Set<LocalToolBridgeError["code"]>([
	"LOCAL_TOOL_AUTH_INVALID",
	"LOCAL_TOOL_INPUT_INVALID",
	"LOCAL_TOOL_OFFLINE",
	"LOCAL_TOOL_COMMAND_TIMEOUT",
	"LOCAL_TOOL_RESULT_UNKNOWN",
	"LOCAL_TOOL_PROVIDER_UNAVAILABLE",
	"LOCAL_TOOL_SCOPE_DENIED",
	"LOCAL_TOOL_COMMAND_FAILED",
]);

function potentialEffect(command: Pick<LocalToolCommandInput, "tool" | "operation" | "input">): boolean { if (command.tool !== "localDev") return false; if (command.operation === "mutate" || command.operation === "run") return true; if (command.operation !== "process" || !isRecord(command.input)) return false; return ["start", "input", "stop"].includes(String(command.input.action)); }

function normalizeProviderError(
	command: LocalToolCommand,
	error: unknown,
): LocalToolBridgeError {
	if (error instanceof LocalToolBridgeError) return error;
	const code =
		typeof error === "object" &&
		error !== null &&
		typeof Reflect.get(error, "code") === "string"
			? String(Reflect.get(error, "code"))
			: undefined;
	if (code === "TOOL_PROVIDER_UNAVAILABLE")
		return new LocalToolBridgeError(
			"LOCAL_TOOL_PROVIDER_UNAVAILABLE",
			"local tool provider unavailable",
		);
	if (code === "TOOL_SCOPE_DENIED")
		return new LocalToolBridgeError(
			"LOCAL_TOOL_SCOPE_DENIED",
			"local tool request is outside allowed operation scope",
		);
	if (code === "TOOL_INPUT_INVALID" || code === "TOOL_HANDLE_INVALID")
		return new LocalToolBridgeError(
			"LOCAL_TOOL_INPUT_INVALID",
			"local tool request or handle is invalid",
		);
	if (code === "TOOL_TIMEOUT")
		return new LocalToolBridgeError(
			potentialEffect(command)
				? "LOCAL_TOOL_RESULT_UNKNOWN"
				: "LOCAL_TOOL_COMMAND_TIMEOUT",
			potentialEffect(command)
				? "local tool timed out after the Effect Gate; reality must be observed before replay"
				: "local tool read timed out",
		);
	if (potentialEffect(command))
		return new LocalToolBridgeError(
			"LOCAL_TOOL_RESULT_UNKNOWN",
			"local tool failed after the Effect Gate; effect state is not safely replayable",
		);
	return new LocalToolBridgeError(
		"LOCAL_TOOL_COMMAND_FAILED",
		error instanceof Error ? error.message : "local tool provider failed",
	);
}

function parsedBridgeError(
	value: unknown,
): LocalToolBridgeError["code"] | undefined {
	if (!isRecord(value) || typeof value.error !== "string") return undefined;
	return bridgeErrorCodes.has(value.error as LocalToolBridgeError["code"])
		? (value.error as LocalToolBridgeError["code"])
		: undefined;
}

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => [key, canonical(item)]),
	);
}

function uniqueNotices(values: readonly string[]): string[] {
	return [...new Set(values.filter((value) => value.length > 0))].slice(0, 32);
}

function commandDigest(value: LocalToolCommandInput): string {
	return `sha256:${createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex")}`;
}

function boundedProviderResult(command: LocalToolCommand, value: unknown): unknown {
	const code = potentialEffect(command)
		? "LOCAL_TOOL_RESULT_UNKNOWN"
		: "LOCAL_TOOL_COMMAND_FAILED";
	let serialized: string | undefined;
	try {
		serialized = JSON.stringify(value);
	} catch {
		throw new LocalToolBridgeError(code, "local tool result is not JSON serializable");
	}
	if (serialized === undefined)
		throw new LocalToolBridgeError(code, "local tool result has no JSON representation");
	if (serialized.length > MAX_BRIDGE_RESULT_CHARS)
		throw new LocalToolBridgeError(
			code,
			"local tool result exceeds the bounded Action transport budget; observe effect reality before replay",
		);
	// Freeze the JSON value actually measured, including provider toJSON behavior.
	return JSON.parse(serialized) as unknown;
}

function parseCommandInput(
	value: unknown,
	expectedWorkspaceRoot: string,
): LocalToolCommandInput {
	if (!isRecord(value))
		throw new LocalToolBridgeError(
			"LOCAL_TOOL_INPUT_INVALID",
			"local tool command must be an object",
		);
	const authenticatedRoleRef = nonEmpty(
		value.authenticatedRoleRef,
		"authenticatedRoleRef",
	);
	const rawWorkspaceRoot = nonEmpty(value.workspaceRoot, "workspaceRoot");
	if (
		!isAbsolute(rawWorkspaceRoot) ||
		resolve(rawWorkspaceRoot) !== expectedWorkspaceRoot
	)
		throw new LocalToolBridgeError(
			"LOCAL_TOOL_AUTH_INVALID",
			"workspaceRoot does not match the server-bound Workspace",
		);
	const tool = value.tool;
	if (!localToolNames.includes(tool as LocalToolName))
		throw new LocalToolBridgeError(
			"LOCAL_TOOL_INPUT_INVALID",
			"unsupported local tool",
		);
	const operation = nonEmpty(value.operation, "operation");
	const deadlineAt = nonEmpty(value.deadlineAt, "deadlineAt");
	if (Number.isNaN(Date.parse(deadlineAt)))
		throw new LocalToolBridgeError(
			"LOCAL_TOOL_INPUT_INVALID",
			"deadlineAt must be an ISO timestamp",
		);
	const notices = value.notices;
	if (
		notices !== undefined &&
		(!Array.isArray(notices) ||
			notices.length > 32 ||
			notices.some((item) => typeof item !== "string" || item.length > 1000))
	)
		throw new LocalToolBridgeError(
			"LOCAL_TOOL_INPUT_INVALID",
			"notices must be a bounded string array",
		);
	return {
		authenticatedRoleRef,
		workspaceRoot: resolve(rawWorkspaceRoot),
		tool: tool as LocalToolName,
		operation,
		input: value.input,
		deadlineAt,
		...(notices === undefined ? {} : { notices: notices as string[] }),
	};
}

export async function createLocalToolBridgeServer(
	options: LocalToolBridgeOptions,
) {
	if (
		options.hostToken.length < 32 ||
		options.extensionToken.length < 32 ||
		options.hostToken === options.extensionToken
	)
		throw new TypeError(
			"local tool host and extension credentials must be separate owner-only secrets",
		);
	if (!/^[a-z]{32}$/.test(options.extensionId))
		throw new TypeError(
			"extensionId must be a canonical Chromium extension id",
		);
	if (options.generation.length < 8)
		throw new TypeError("local tool bridge generation must be non-empty");
	if (!isAbsolute(options.workspaceRoot))
		throw new TypeError("local tool bridge workspaceRoot must be absolute");
	const workspaceRoot = resolve(options.workspaceRoot);

	const now = options.now ?? (() => new Date());
	const idFactory = options.idFactory ?? randomUUID;
	const freshnessMs = options.heartbeatFreshnessMs ?? 10_000;
	const commandTimeoutMs = options.commandTimeoutMs ?? 40_000;
	const maxConcurrentCommands = Math.max(1, Math.min(8, options.maxConcurrentCommands ?? 4));
	const maxPendingCommands = Math.max(maxConcurrentCommands, Math.min(256, options.maxPendingCommands ?? 128));
	const expectedOrigin = `chrome-extension://${options.extensionId}`;
	const queue: LocalToolCommand[] = [];
	const pending = new Map<string, PendingCommand>();
	const reservations = new Map<string, "shared" | "exclusive">(); let activeShared = 0; let activeExclusive = false;
	const canReserve = (command: LocalToolCommand) => potentialEffect(command) ? !activeExclusive && activeShared === 0 : !activeExclusive && activeShared < maxConcurrentCommands;
	const reserve = (command: LocalToolCommand) => { const kind = potentialEffect(command) ? "exclusive" : "shared"; if (kind === "exclusive") activeExclusive = true; else activeShared += 1; reservations.set(command.commandId, kind); };
	const releaseReservation = (commandId: string) => { const kind = reservations.get(commandId); if (!kind) return; reservations.delete(commandId); if (kind === "exclusive") activeExclusive = false; else activeShared = Math.max(0, activeShared - 1); };
	let session:
		| {
				extensionInstanceId: string;
				moduleVersion: string;
				lastHeartbeatAt: number;
		  }
		| undefined;
	let lastCommandPollAt: number | undefined;
	let closed = false;

	const sessionOnline = () =>
		!closed &&
		session !== undefined &&
		now().getTime() - session.lastHeartbeatAt <= freshnessMs;
	const consumerReady = () =>
		sessionOnline() &&
		lastCommandPollAt !== undefined &&
		now().getTime() - lastCommandPollAt <= freshnessMs;

	const requireExtension = (
		request: IncomingMessage,
		originPolicy: { allowMissingOrigin?: boolean } = {},
	) => {
		authenticate(request, options.extensionToken);
		const origin = request.headers.origin;
		if (
			origin !== expectedOrigin &&
			!(originPolicy.allowMissingOrigin === true && origin === undefined)
		)
			throw new LocalToolBridgeError(
				"LOCAL_TOOL_AUTH_INVALID",
				"local tool extension origin is required",
			);
	};

	const assertSession = (url: URL) => {
		if (!session)
			throw new LocalToolBridgeError(
				"LOCAL_TOOL_OFFLINE",
				"local tool extension session has not completed hello",
			);
		if (
			url.searchParams.get("extensionInstanceId") !==
			session.extensionInstanceId
		)
			throw new LocalToolBridgeError(
				"LOCAL_TOOL_AUTH_INVALID",
				"stale local tool extension session",
			);
	};

	const failPending = (commandId: string, error: Error) => { const tracked = pending.get(commandId); if (!tracked) return; pending.delete(commandId); releaseReservation(commandId); clearTimeout(tracked.timer); tracked.reject(error); };
	const completePending = (commandId: string, value: unknown) => { const tracked = pending.get(commandId); if (!tracked) return; pending.delete(commandId); releaseReservation(commandId); clearTimeout(tracked.timer); tracked.resolve(value); };

	const enqueue = async (input: LocalToolCommandInput) => { if (!consumerReady()) return Promise.reject(new LocalToolBridgeError("LOCAL_TOOL_OFFLINE", "local tool extension consumer is not ready")); if (pending.size >= maxPendingCommands) return Promise.reject(new LocalToolBridgeError("LOCAL_TOOL_COMMAND_FAILED", "local tool admission capacity is exhausted")); let remaining = Date.parse(input.deadlineAt) - now().getTime(); if (remaining <= 0) return Promise.reject(new LocalToolBridgeError("LOCAL_TOOL_COMMAND_TIMEOUT", "local tool command expired before enqueue")); const prepared = options.prepare ? await options.prepare(input) : undefined; remaining = Date.parse(input.deadlineAt) - now().getTime(); if (remaining <= 0) return Promise.reject(new LocalToolBridgeError("LOCAL_TOOL_COMMAND_TIMEOUT", "local tool command expired during prepare")); const notices = uniqueNotices([...(input.notices ?? []), ...(prepared?.notices ?? [])]); const preparedInput: LocalToolCommandInput = { ...input, ...(notices.length ? { notices } : {}) }; const commandId = `local-tool-command:${idFactory()}`; const command: LocalToolCommand = { ...preparedInput, commandId, generation: options.generation, commandDigest: commandDigest(preparedInput) }; return new Promise<unknown>((resolvePromise, rejectPromise) => { const timer = setTimeout(() => { const tracked = pending.get(commandId); if (!tracked) return; if (tracked.stage === "QUEUED") { const index = queue.findIndex((item) => item.commandId === commandId); if (index >= 0) queue.splice(index, 1); } failPending(commandId, new LocalToolBridgeError(tracked.stage === "EXECUTING" ? "LOCAL_TOOL_RESULT_UNKNOWN" : "LOCAL_TOOL_COMMAND_TIMEOUT", tracked.stage === "EXECUTING" ? "local tool command timed out after effect start" : "local tool command expired before effect start")); }, Math.max(1, Math.min(commandTimeoutMs, remaining))); pending.set(commandId, { command, stage: "QUEUED", resolve: resolvePromise, reject: rejectPromise, timer }); queue.push(command); }); };

	const server = createServer(async (request, response) => {
		try {
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			if (url.pathname === "/v1/local-tools/status") {
				authenticate(request, options.hostToken);
				if (request.method !== "GET") {
					send(response, 405, { error: "METHOD_NOT_ALLOWED" });
					return;
				}
				send(response, 200, {
					online: consumerReady(),
					sessionOnline: sessionOnline(),
					generation: options.generation,
					queuedCommands: queue.length,
					pendingCommands: pending.size,
					executingCommands: activeShared + (activeExclusive ? 1 : 0),
				});
				return;
			}
			if (
				request.method === "POST" &&
				url.pathname === "/v1/local-tools/commands"
			) {
				authenticate(request, options.hostToken);
				const input = parseCommandInput(await readJson(request), workspaceRoot);
				try {
					send(response, 200, { ok: true, value: await enqueue(input) });
				} catch (error) {
					const bridgeError =
						error instanceof LocalToolBridgeError
							? error
							: new LocalToolBridgeError(
									"LOCAL_TOOL_COMMAND_FAILED",
									error instanceof Error ? error.message : "local tool failed",
								);
					send(response, 409, { ok: false, error: bridgeError.code });
				}
				return;
			}

			if (request.method === "OPTIONS") {
				if (request.headers.origin !== expectedOrigin)
					throw new LocalToolBridgeError(
						"LOCAL_TOOL_AUTH_INVALID",
						"local tool extension origin is required",
					);
				response.setHeader("access-control-allow-origin", expectedOrigin);
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
			const allowMissingOrigin =
				request.method === "GET" &&
				url.pathname === "/v1/local-tools/commands/next";
			requireExtension(request, { allowMissingOrigin });
			response.setHeader("access-control-allow-origin", expectedOrigin);
			response.setHeader("vary", "origin");

			if (
				request.method === "POST" &&
				url.pathname === "/v1/local-tools/session/hello"
			) {
				const body = await readJson(request);
				if (
					!isRecord(body) ||
					nonEmpty(body.extensionId, "extensionId") !== options.extensionId
				)
					throw new LocalToolBridgeError(
						"LOCAL_TOOL_AUTH_INVALID",
						"local tool extension identity mismatch",
					);
				const extensionInstanceId = nonEmpty(
					body.extensionInstanceId,
					"extensionInstanceId",
				);
				const moduleVersion = nonEmpty(body.moduleVersion, "moduleVersion");
				if (session?.extensionInstanceId !== extensionInstanceId) {
					lastCommandPollAt = undefined;
				}
				session = {
					extensionInstanceId,
					moduleVersion,
					lastHeartbeatAt: now().getTime(),
				};
				send(response, 200, { accepted: true, generation: options.generation });
				return;
			}

			assertSession(url);
			if (
				request.method === "POST" &&
				url.pathname === "/v1/local-tools/session/heartbeat"
			) {
				if (session) session.lastHeartbeatAt = now().getTime();
				send(response, 200, { accepted: true });
				return;
			}
			if (request.method === "GET" && url.pathname === "/v1/local-tools/commands/next") { const stamp = now().getTime(); if (session) session.lastHeartbeatAt = stamp; lastCommandPollAt = stamp; const next = queue[0]; const command = next && canReserve(next) ? queue.shift() : undefined; if (command) { reserve(command); const tracked = pending.get(command.commandId); if (tracked) tracked.stage = "CLAIMED"; } send(response, command ? 200 : 204, command); return; }
			if (request.method === "POST" && url.pathname === "/v1/local-tools/commands/execute") { const body = await readJson(request); if (!isRecord(body)) throw new LocalToolBridgeError("LOCAL_TOOL_INPUT_INVALID", "local tool execute request must be an object"); const commandId = nonEmpty(body.commandId, "commandId"); const generation = nonEmpty(body.generation, "generation"); const digest = nonEmpty(body.commandDigest, "commandDigest"); if (generation !== options.generation) throw new LocalToolBridgeError("LOCAL_TOOL_AUTH_INVALID", "stale local tool bridge generation"); const tracked = pending.get(commandId); if (!tracked || tracked.stage !== "CLAIMED" || tracked.command.commandDigest !== digest) throw new LocalToolBridgeError("LOCAL_TOOL_INPUT_INVALID", "local tool command is stale, unknown, or already executed"); if (Date.parse(tracked.command.deadlineAt) - now().getTime() <= 0) { failPending(commandId, new LocalToolBridgeError("LOCAL_TOOL_COMMAND_TIMEOUT", "local tool command expired at the Effect Gate")); throw new LocalToolBridgeError("LOCAL_TOOL_COMMAND_TIMEOUT", "local tool command expired at the Effect Gate"); } tracked.stage = "EXECUTING"; send(response, 202, { accepted: true }); void Promise.resolve().then(() => { if (!options.execute) throw new LocalToolBridgeError("LOCAL_TOOL_PROVIDER_UNAVAILABLE", "local tool provider is not wired yet"); return options.execute(tracked.command); }).then((value) => boundedProviderResult(tracked.command, value)).then((value) => completePending(commandId, value)).catch((error) => failPending(commandId, normalizeProviderError(tracked.command, error))); return; }
			send(response, 404, { error: "NOT_FOUND" });
		} catch (error) {
			const bridgeError =
				error instanceof LocalToolBridgeError
					? error
					: new LocalToolBridgeError(
							"LOCAL_TOOL_INPUT_INVALID",
							error instanceof Error
								? error.message
								: "local tool bridge failed",
						);
			send(
				response,
				bridgeError.code === "LOCAL_TOOL_AUTH_INVALID" ? 401 : 400,
				{ error: bridgeError.code },
			);
		}
	});

	await new Promise<void>((resolvePromise, rejectPromise) => {
		server.once("error", rejectPromise);
		server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => {
			server.off("error", rejectPromise);
			resolvePromise();
		});
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("local tool bridge address missing");
	const endpoint = `http://127.0.0.1:${address.port}`;

	return Object.freeze({
		endpoint,
		generation: options.generation,
		status: () => ({
			online: consumerReady(),
			sessionOnline: sessionOnline(),
			generation: options.generation,
			queuedCommands: queue.length,
			pendingCommands: pending.size,
			executingCommands: activeShared + (activeExclusive ? 1 : 0),
		}),
		async close() {
			if (closed) return;
			closed = true;
			queue.length = 0;
			for (const [commandId, tracked] of pending)
				failPending(
					commandId,
					new LocalToolBridgeError(
						tracked.stage === "EXECUTING"
							? "LOCAL_TOOL_RESULT_UNKNOWN"
							: "LOCAL_TOOL_OFFLINE",
						tracked.stage === "EXECUTING"
							? "local tool bridge closed after effect start"
							: "local tool bridge closed before effect start",
					),
				);
			await new Promise<void>((resolvePromise, rejectPromise) => {
				server.close((error) =>
					error ? rejectPromise(error) : resolvePromise(),
				);
				server.closeAllConnections();
			});
		},
	});
}

export function createLocalToolBridgeHostClient(options: {
	endpoint: string;
	token: string;
}) {
	const endpoint = new URL(options.endpoint);
	if (
		endpoint.protocol !== "http:" ||
		endpoint.hostname !== "127.0.0.1" ||
		endpoint.pathname !== "/" ||
		endpoint.search ||
		endpoint.hash ||
		endpoint.username ||
		endpoint.password ||
		options.token.length < 32
	)
		throw new TypeError(
			"local tool bridge client requires loopback HTTP root and host credential",
		);
	return Object.freeze({
		async status() {
			const response = await fetch(
				new URL("/v1/local-tools/status", endpoint),
				{
					headers: { authorization: `Bearer ${options.token}` },
					signal: AbortSignal.timeout(2_000),
				},
			);
			if (!response.ok) throw new Error("LOCAL_TOOL_BRIDGE_STATUS_FAILED");
			return (await response.json()) as unknown;
		},
		async request(input: LocalToolCommandInput) { const remaining = Date.parse(input.deadlineAt) - Date.now(); if (remaining <= 0) throw new LocalToolBridgeError("LOCAL_TOOL_COMMAND_TIMEOUT", "local tool command expired before transport"); let response: Response; try { response = await fetch(new URL("/v1/local-tools/commands", endpoint), { method: "POST", headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(Math.max(1, Math.min(41_000, remaining + 1_000))) }); } catch (error) { if (potentialEffect(input)) throw new LocalToolBridgeError("LOCAL_TOOL_RESULT_UNKNOWN", "local tool transport disconnected after dispatch; observe reality before replay"); const timedOut = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"); throw new LocalToolBridgeError(timedOut ? "LOCAL_TOOL_COMMAND_TIMEOUT" : "LOCAL_TOOL_OFFLINE", timedOut ? "local tool transport timed out" : "local tool bridge transport is unavailable"); } const body = (await response.json()) as unknown; if (!response.ok || !isRecord(body) || body.ok !== true) { const code = parsedBridgeError(body) ?? "LOCAL_TOOL_COMMAND_FAILED"; throw new LocalToolBridgeError(code, code); } return body.value;
		},
	});
}
