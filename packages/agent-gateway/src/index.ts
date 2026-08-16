import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { isIP } from "node:net";
import { z } from "zod";

const MAX_ACTION_CHARS = 100_000;
const MAX_INPUT_FILES = 10;
const MAX_FILE_BYTES = 10_000_000;
const RELAY_TTL_MS = 300_000;
export interface ExternalFileMaterializationInput {
	name: string;
	provenanceRef: string;
	declaredMimeType: string;
	sourceUrl: string;
}

export type GatewayOwnerPorts = {
	authenticateBearer(credential: string): Promise<string>;
	route(
		operationId: string,
		authenticatedRoleRef: string,
		input: unknown,
		context?: {
			signal: AbortSignal;
			fileMaterializationInputs?: readonly ExternalFileMaterializationInput[];
		},
	): Promise<unknown>;
	lookupResult?(
		operationId: string,
		authenticatedRoleRef: string,
		input: unknown,
	): Promise<unknown>;
	readiness(): Promise<Record<string, boolean>>;
};
export type GatewayOptions = {
	owners: GatewayOwnerPorts;
	relayBaseUrl: string;
	host?: string;
	port?: number;
	now?: () => number;
	actionTimeoutMs?: number;
};
export class AgentGatewayError extends Error {
	readonly code: string;
	constructor(code: string, message = code) {
		super(`${code}: ${message}`);
		this.code = code;
	}
}
const fileInputSchema = z
	.object({
		name: z.string().min(1),
		id: z.string().min(1),
		mime_type: z.string().min(1),
		download_link: z.url(),
	})
	.strict();
const actionSchema = z
	.object({
		operationId: z.string().min(1),
		body: z.record(z.string(), z.unknown()).default({}),
		uncertain: z.boolean().optional(),
	})
	.strict();
type FileInput = z.infer<typeof fileInputSchema>;
type RelayArtifact = {
	artifactRef: string;
	name: string;
	mimeType: string;
	bytes: Buffer;
};
type RelayEntry = RelayArtifact & { expiresAt: number };
function safeFilename(name: string): boolean {
	return (
		name.length > 0 &&
		name !== "." &&
		name !== ".." &&
		!/[\\/]/.test(name) &&
		![...name].some((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code < 32 || code === 127;
		}) &&
		!name.includes("..")
	);
}
function privateIpv4(host: string): boolean {
	const parts = host.split(".").map(Number);
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part)))
		return false;
	return (
		parts[0] === 0 ||
		parts[0] === 10 ||
		parts[0] === 127 ||
		(parts[0] === 100 && (parts[1] ?? 0) >= 64 && (parts[1] ?? 0) <= 127) ||
		(parts[0] === 169 && parts[1] === 254) ||
		(parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) ||
		(parts[0] === 192 && parts[1] === 168) ||
		(parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
		(parts[0] ?? 0) >= 224
	);
}
export async function createAgentGateway(options: GatewayOptions) {
	const now = options.now ?? Date.now;
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? 0;
	let server: Server | undefined;
	let lifecycle: "STOPPED" | "RUNNING" | "DRAINING" = "STOPPED";
	let inFlight = 0;
	const relays = new Map<string, RelayEntry>();
	const assertSafeRemoteUrl = (raw: string): URL => {
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			throw new AgentGatewayError("OPENAI_FILE_INPUT_INVALID");
		}
		const hostname = url.hostname.toLowerCase();
		if (
			url.protocol !== "https:" ||
			hostname === "localhost" ||
			hostname === "metadata.google.internal" ||
			privateIpv4(hostname) ||
			(isIP(hostname) === 6 &&
				(hostname === "::1" ||
					hostname.startsWith("fe80:") ||
					hostname.startsWith("fc") ||
					hostname.startsWith("fd")))
		)
			throw new AgentGatewayError("OPENAI_FILE_INPUT_INVALID");
		return url;
	};
	const normalizeFileInputs = (raw: unknown): FileInput[] => {
		const list = z.array(fileInputSchema).parse(raw);
		if (list.length > MAX_INPUT_FILES)
			throw new AgentGatewayError("OPENAI_FILE_COUNT_EXCEEDED");
		for (const item of list) {
			if (!safeFilename(item.name))
				throw new AgentGatewayError("OPENAI_FILE_INPUT_INVALID");
			assertSafeRemoteUrl(item.download_link);
		}
		return list;
	};
	const createRelay = (artifact: RelayArtifact) => {
		if (!safeFilename(artifact.name))
			throw new AgentGatewayError("OPENAI_FILE_INPUT_INVALID");
		if (/^(image|video)\//.test(artifact.mimeType))
			throw new AgentGatewayError("OPENAI_FILE_RESPONSE_UNSUPPORTED_MEDIA");
		if (artifact.bytes.length > MAX_FILE_BYTES)
			throw new AgentGatewayError("OPENAI_FILE_RESPONSE_TOO_LARGE");
		const token = randomBytes(32).toString("base64url");
		relays.set(token, { ...artifact, expiresAt: now() + RELAY_TTL_MS });
		const url = new URL(encodeURIComponent(token), options.relayBaseUrl);
		return {
			token,
			url: url.href,
		};
	};
	const readRelay = async (
		token: string,
		method: string,
		artifactRef?: string,
	) => {
		const relay = relays.get(token);
		if (!relay || relay.expiresAt < now())
			throw new AgentGatewayError("OPENAI_FILE_RELAY_EXPIRED");
		if (
			method !== "GET" ||
			(artifactRef !== undefined && relay.artifactRef !== artifactRef)
		)
			throw new AgentGatewayError("OPENAI_FILE_RELAY_SCOPE_INVALID");
		return {
			body: relay.bytes,
			headers: {
				"content-type": relay.mimeType,
				"content-disposition": `attachment; filename="${relay.name}"`,
			},
		};
	};
	const serializeFileResponse = (raw: RelayArtifact[]) => {
		const artifacts = z
			.array(
				z.object({
					artifactRef: z.string().min(1),
					name: z.string().min(1),
					mimeType: z.string().min(1),
					bytes: z.instanceof(Buffer),
				}),
			)
			.parse(raw);
		if (artifacts.length > MAX_INPUT_FILES)
			throw new AgentGatewayError("OPENAI_FILE_COUNT_EXCEEDED");
		for (const artifact of artifacts) {
			if (!safeFilename(artifact.name))
				throw new AgentGatewayError("OPENAI_FILE_INPUT_INVALID");
			if (/^(image|video)\//.test(artifact.mimeType))
				throw new AgentGatewayError("OPENAI_FILE_RESPONSE_UNSUPPORTED_MEDIA");
			if (artifact.bytes.length > MAX_FILE_BYTES)
				throw new AgentGatewayError("OPENAI_FILE_RESPONSE_TOO_LARGE");
		}
		const items: Array<Record<string, string>> = artifacts.map((artifact) => ({
			kind: "inline",
			name: artifact.name,
			mime_type: artifact.mimeType,
			content: artifact.bytes.toString("base64"),
		}));
		for (let index = artifacts.length - 1; index >= 0; index -= 1) {
			const candidate = { openaiFileResponse: items };
			if (JSON.stringify(candidate).length < MAX_ACTION_CHARS) return candidate;
			const artifact = artifacts[index];
			if (!artifact) continue;
			const relay = createRelay(artifact);
			items[index] = {
				kind: "url",
				name: artifact.name,
				mime_type: artifact.mimeType,
				download_link: relay.url,
			};
		}
		const candidate = { openaiFileResponse: items };
		if (JSON.stringify(candidate).length >= MAX_ACTION_CHARS)
			throw new AgentGatewayError("OPENAI_ACTION_RESPONSE_BUDGET_EXCEEDED");
		return candidate;
	};
	const readiness = async () => {
		const checks = await options.owners.readiness();
		// Intrinsic Gateway capabilities are verified here rather than trusting the
		// owner to report them: ingress is the real accepting/bound socket state, and
		// relay requires a valid HTTPS base URL that an external client can fetch.
		let relayReady = false;
		try {
			relayReady = new URL(options.relayBaseUrl).protocol === "https:";
		} catch {
			relayReady = false;
		}
		const merged = {
			...checks,
			ingress: lifecycle === "RUNNING" && server !== undefined,
			relay: relayReady && checks.relay !== false,
		};
		return {
			status: Object.values(merged).every(Boolean)
				? ("READY" as const)
				: ("NOT_READY" as const),
			checks: merged,
		};
	};
	const handler = async (
		request: import("node:http").IncomingMessage,
		response: import("node:http").ServerResponse,
	) => {
		inFlight += 1;
		try {
			const url = new URL(request.url ?? "/", `http://${host}`);
			if (request.method === "GET" && url.pathname === "/health") {
				response.setHeader("content-type", "application/json; charset=utf-8");
				response.setHeader("cache-control", "no-store");
				response.end(JSON.stringify({ status: "UP" }));
				return;
			}
			if (request.method === "GET" && url.pathname === "/ready") {
				const state = await readiness();
				response.statusCode = state.status === "READY" ? 200 : 503;
				response.setHeader("content-type", "application/json; charset=utf-8");
				response.setHeader("cache-control", "no-store");
				response.end(JSON.stringify(state));
				return;
			}
			if (url.pathname.startsWith("/relay/")) {
				if (request.method !== "GET" || url.search !== "") {
					response.statusCode = 404;
					response.end();
					return;
				}
				try {
					const relay = await readRelay(
						decodeURIComponent(url.pathname.slice("/relay/".length)),
						request.method,
					);
					response.setHeader("cache-control", "private, no-store");
					response.setHeader("x-content-type-options", "nosniff");
					for (const [name, value] of Object.entries(relay.headers))
						response.setHeader(name, value);
					response.end(relay.body);
				} catch {
					response.statusCode = 404;
					response.end();
				}
				return;
			}
			response.setHeader("content-type", "application/json; charset=utf-8");
			const authorization = request.headers.authorization;
			if (!authorization?.startsWith("Bearer ")) {
				response.statusCode = 401;
				response.end(JSON.stringify({ error: "AUTHENTICATION_FAILED" }));
				return;
			}
			let authenticatedRoleRef: string;
			try {
				authenticatedRoleRef = await options.owners.authenticateBearer(
					authorization.slice("Bearer ".length),
				);
			} catch {
				response.statusCode = 401;
				response.end(JSON.stringify({ error: "AUTHENTICATION_FAILED" }));
				return;
			}
			let action: z.infer<typeof actionSchema>;
			if (request.method === "GET" && url.pathname.startsWith("/actions/")) {
				action = {
					operationId: decodeURIComponent(
						url.pathname.slice("/actions/".length),
					),
					body: Object.fromEntries(url.searchParams),
				};
			} else if (
				request.method === "POST" &&
				(url.pathname === "/actions" || url.pathname.startsWith("/actions/"))
			) {
				const chunks: Buffer[] = [];
				let chars = 0;
				for await (const chunk of request) {
					const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
					chars += buffer.toString("utf8").length;
					if (chars >= MAX_ACTION_CHARS) {
						response.statusCode = 413;
						response.end(
							JSON.stringify({
								error: "OPENAI_ACTION_REQUEST_BUDGET_EXCEEDED",
							}),
						);
						return;
					}
					chunks.push(buffer);
				}
				const parsedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				action = actionSchema.parse(
					url.pathname === "/actions"
						? parsedBody
						: {
								operationId: decodeURIComponent(
									url.pathname.slice("/actions/".length),
								),
								body: parsedBody,
							},
				);
			} else {
				response.statusCode = 404;
				response.end(JSON.stringify({ error: "NOT_FOUND" }));
				return;
			}
			const {
				roleRef: _untrustedRoleRef,
				openaiFileIdRefs: rawFileInputs,
				...canonicalBody
			} = action.body;
			const fileMaterializationInputs =
				rawFileInputs === undefined
					? undefined
					: normalizeFileInputs(rawFileInputs).map((file) => ({
							name: file.name,
							provenanceRef: file.id,
							declaredMimeType: file.mime_type,
							sourceUrl: file.download_link,
						}));
			if (fileMaterializationInputs !== undefined) {
				if (action.operationId !== "putTaskDocument")
					throw new AgentGatewayError(
						"OPENAI_FILE_INPUT_UNSUPPORTED_OPERATION",
					);
				if (fileMaterializationInputs.length !== 1)
					throw new AgentGatewayError("OPENAI_FILE_COUNT_EXCEEDED");
				if (
					typeof canonicalBody.content === "string" &&
					canonicalBody.content.length > 0
				)
					throw new AgentGatewayError("OPENAI_FILE_INPUT_CONFLICT");
			}
			const actionSignal = AbortSignal.timeout(
				options.actionTimeoutMs ?? 45_000,
			);
			const operation =
				action.uncertain && options.owners.lookupResult
					? options.owners.lookupResult(
							action.operationId,
							authenticatedRoleRef,
							canonicalBody,
						)
					: options.owners.route(
							action.operationId,
							authenticatedRoleRef,
							canonicalBody,
							{
								signal: actionSignal,
								...(fileMaterializationInputs === undefined
									? {}
									: { fileMaterializationInputs }),
							},
						);
			const output = await Promise.race([
				operation,
				new Promise<never>((_resolve, reject) =>
					actionSignal.addEventListener(
						"abort",
						() =>
							reject(
								Object.assign(new AgentGatewayError("OPENAI_ACTION_TIMEOUT"), {
									httpStatus: 504,
								}),
							),
						{ once: true },
					),
				),
			]);
			const serialized = JSON.stringify(output);
			if (serialized.length >= MAX_ACTION_CHARS) {
				response.statusCode = 500;
				response.end(
					JSON.stringify({ error: "OPENAI_ACTION_RESPONSE_BUDGET_EXCEEDED" }),
				);
				return;
			}
			response.end(serialized);
		} catch (error) {
			if (error instanceof z.ZodError || error instanceof SyntaxError) {
				response.statusCode = 400;
				response.end(JSON.stringify({ error: "INVALID_REQUEST" }));
				return;
			}
			const requestedStatus =
				error && typeof error === "object" && "httpStatus" in error
					? Number(error.httpStatus)
					: 500;
			response.statusCode =
				Number.isInteger(requestedStatus) &&
				requestedStatus >= 400 &&
				requestedStatus <= 599
					? requestedStatus
					: 500;
			response.end(
				JSON.stringify({
					error:
						error instanceof AgentGatewayError ? error.code : "GATEWAY_FAILURE",
				}),
			);
		} finally {
			inFlight -= 1;
		}
	};
	const start = async () => {
		if (server) throw new AgentGatewayError("SERVICE_ALREADY_RUNNING");
		server = createServer(
			(request, response) => void handler(request, response),
		);
		await new Promise<void>((resolve, reject) => {
			server?.once("error", reject);
			server?.listen(port, host, resolve);
		});
		const address = server.address();
		if (!address || typeof address === "string")
			throw new AgentGatewayError("SERVICE_START_FAILED");
		lifecycle = "RUNNING";
		return { host, port: address.port };
	};
	const stop = async () => {
		const active = server;
		server = undefined;
		if (!active) return;
		lifecycle = "DRAINING";
		await new Promise<void>((resolve, reject) =>
			active.close((error) => (error ? reject(error) : resolve())),
		);
		lifecycle = "STOPPED";
	};
	const restart = async () => {
		await stop();
		return start();
	};
	return Object.freeze({
		start,
		stop,
		restart,
		readiness,
		status: () => ({
			process: lifecycle,
			liveness: lifecycle === "STOPPED" ? ("DOWN" as const) : ("UP" as const),
			accepting: lifecycle === "RUNNING",
			inFlight,
		}),
		assertSafeRemoteUrl,
		normalizeFileInputs,
		createRelay,
		readRelay,
		serializeFileResponse,
		businessPersistence: Object.freeze([]),
	});
}
