import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { connect } from "node:tls";

import { z } from "zod";

export type DevTunnelState = "STOPPED" | "RUNNING" | "UNKNOWN";

export type DevTunnelLoginStatus = "LOGGED_IN" | "NOT_LOGGED_IN" | "UNKNOWN";

export interface DevTunnelObservation {
	state: DevTunnelState;
	login: DevTunnelLoginStatus;
	publicBaseUrl?: string;
}

export interface CommandResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

export type CommandRunner = (
	command: string,
	args: string[],
	options?: { timeoutMs?: number; interactive?: boolean },
) => Promise<CommandResult>;

export type DevTunnelHostState = "STOPPED" | "RUNNING" | "UNKNOWN";

export type DevTunnelInspection =
	| { state: "EXISTS"; hostState: DevTunnelHostState }
	| { state: "MISSING" | "UNKNOWN"; hostState: "UNKNOWN" };

export interface DevTunnelAutomation {
	ensureLogin(): Promise<"LOGGED_IN">;
	inspectTunnel(tunnelId: string): Promise<DevTunnelInspection>;
	createTunnel(tunnelId: string): Promise<string>;
	ensurePort(
		tunnelId: string,
		port: number,
	): Promise<"REUSED" | "CREATED" | "UPDATED">;
	discoverPublicBaseUrl(tunnelId: string, port: number): Promise<string>;
}

export interface DevTunnelRuntime {
	readonly command: string;
	status(): Promise<DevTunnelObservation>;
	loginStatus(): Promise<DevTunnelLoginStatus>;
	publicBaseUrl(): string | undefined;
	start(): Promise<DevTunnelObservation>;
	stop(): Promise<DevTunnelObservation>;
	restart(): Promise<DevTunnelObservation>;
}

const LOGIN_ARGS = ["user", "show", "--json"];
const LOGIN_TIMEOUT_MS = 30_000;
const REMOTE_COMMAND_TIMEOUT_MS = 30_000;
const REMOTE_QUERY_TIMEOUT_MS = 45_000;
const REMOTE_QUERY_RETRY_DELAY_MS = 250;
const START_CONFIRM_MS = 500;

function defaultCommandRunner(
	command: string,
	args: string[],
	options?: { timeoutMs?: number; interactive?: boolean },
): Promise<CommandResult> {
	if (options?.interactive) {
		return new Promise((resolve) => {
			const child = spawn(command, args, {
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				child.kill("SIGTERM");
			}, options.timeoutMs ?? 600_000);
			child.once("error", (error) => {
				clearTimeout(timer);
				resolve({ exitCode: null, stdout, stderr: error.message });
			});
			child.once("exit", (code) => {
				clearTimeout(timer);
				resolve({
					exitCode: timedOut ? null : code,
					stdout,
					stderr: timedOut ? "command timed out" : stderr,
				});
			});
		});
	}
	return new Promise((resolve) => {
		execFile(
			command,
			args,
			{ timeout: options?.timeoutMs ?? 10_000 },
			(error, stdout, stderr) => {
				if (error) {
					const err = error as { code?: unknown; killed?: boolean };
					if (err.killed === true) {
						resolve({
							exitCode: null,
							stdout: String(stdout ?? ""),
							stderr: "command timed out",
						});
						return;
					}
					resolve({
						exitCode: typeof err.code === "number" ? err.code : null,
						stdout: String(stdout ?? ""),
						stderr: String(stderr ?? ""),
					});
					return;
				}
				resolve({
					exitCode: 0,
					stdout: String(stdout ?? ""),
					stderr: String(stderr ?? ""),
				});
			},
		);
	});
}

const loginStatusSchema = z.object({ status: z.string().min(1) }).passthrough();
const tunnelPortSchema = z
	.object({
		portNumber: z.number().int().min(1).max(65_535),
		protocol: z.string().min(1).optional(),
		portForwardingUris: z.array(z.string()).optional(),
		portUri: z.string().optional(),
		clientConnections: z.number().int().min(0).optional(),
	})
	.passthrough();
const tunnelPayloadSchema = z
	.object({
		tunnelId: z.string().min(1),
		endpoints: z.array(z.unknown()).optional(),
		hostConnections: z.number().int().min(0).optional(),
		ports: z.array(tunnelPortSchema).optional(),
	})
	.passthrough();
export type DevTunnelPort = z.infer<typeof tunnelPortSchema>;

function parseTunnel(input: unknown): z.infer<typeof tunnelPayloadSchema> {
	const direct = tunnelPayloadSchema.safeParse(input);
	if (direct.success) return direct.data;
	return z.object({ tunnel: tunnelPayloadSchema }).passthrough().parse(input)
		.tunnel;
}

function sameTunnelIdentity(requested: string, observed: string): boolean {
	if (observed === requested) return true;
	if (requested.includes(".")) return false;
	const prefix = `${requested}.`;
	return (
		observed.startsWith(prefix) && !observed.slice(prefix.length).includes(".")
	);
}

function parseJson(text: string, label: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new Error(`${label} returned malformed JSON`);
	}
}

function parsePorts(input: unknown): DevTunnelPort[] {
	if (Array.isArray(input)) return z.array(tunnelPortSchema).parse(input);
	if (typeof input === "object" && input !== null) {
		const warning = Reflect.get(input, "warning");
		if (typeof warning === "string" && /\bno ports found\b/i.test(warning))
			return [];
		const ports = Reflect.get(input, "ports");
		if (Array.isArray(ports)) return z.array(tunnelPortSchema).parse(ports);
		const tunnel = Reflect.get(input, "tunnel");
		if (typeof tunnel === "object" && tunnel !== null) {
			const tunnelPorts = Reflect.get(tunnel, "ports");
			if (Array.isArray(tunnelPorts))
				return z.array(tunnelPortSchema).parse(tunnelPorts);
		}
		const port = Reflect.get(input, "port");
		if (port !== undefined) return [tunnelPortSchema.parse(port)];
		const one = tunnelPortSchema.safeParse(input);
		if (one.success) return [one.data];
	}
	throw new Error("devtunnel port JSON does not contain a valid port list");
}

export function parseDevTunnelLoginStatus(
	input: unknown,
): DevTunnelLoginStatus {
	const parsed = loginStatusSchema.safeParse(input);
	if (!parsed.success) return "UNKNOWN";
	const status = parsed.data.status.trim().toLowerCase();
	if (
		/(expired|not logged|login required|sign[ -]?in required|not authenticated)/.test(
			status,
		)
	)
		return "NOT_LOGGED_IN";
	if (/(logged in|authenticated)/.test(status)) return "LOGGED_IN";
	return "UNKNOWN";
}

export function discoverPublicBaseUrl(input: unknown, port: number): string {
	const matching = parsePorts(input).filter((item) => item.portNumber === port);
	if (matching.length !== 1)
		throw new Error(
			"devtunnel JSON does not identify exactly one current Gateway port",
		);
	const current = matching[0];
	const uris = [
		...(current?.portUri ? [current.portUri] : []),
		...(current?.portForwardingUris ?? []),
	];
	const httpsUris = uris.flatMap((raw) => {
		try {
			const url = new URL(raw);
			return url.protocol === "https:" &&
				(url.port === "" || url.port === "443")
				? [url.href]
				: [];
		} catch {
			return [];
		}
	});
	if (httpsUris.length === 0)
		throw new Error("current Gateway port has no valid HTTPS forwarding URI");
	return httpsUris[0] as string;
}

function commandText(result: CommandResult): string {
	return `${result.stdout}\n${result.stderr}`;
}

function assertCommandSucceeded(result: CommandResult, label: string): void {
	if (result.exitCode !== 0)
		throw new Error(
			`${label} failed${result.exitCode === null ? " or timed out" : ""}`,
		);
}

export function createDevTunnelAutomation(input?: {
	command?: string;
	runCommand?: CommandRunner;
}): DevTunnelAutomation {
	const command = input?.command ?? "devtunnel";
	const run = input?.runCommand ?? defaultCommandRunner;
	const runRemoteQuery = async (
		args: string[],
		retryTimeout = true,
	): Promise<CommandResult> => {
		let result = await run(command, args, {
			timeoutMs: REMOTE_QUERY_TIMEOUT_MS,
		});
		if (
			!retryTimeout ||
			result.exitCode !== null ||
			!/timed out/i.test(commandText(result))
		)
			return result;
		await new Promise((resolve) =>
			setTimeout(resolve, REMOTE_QUERY_RETRY_DELAY_MS),
		);
		result = await run(command, args, { timeoutMs: REMOTE_QUERY_TIMEOUT_MS });
		return result;
	};
	const loginStatus = async (): Promise<DevTunnelLoginStatus> => {
		let result: CommandResult;
		try {
			result = await run(command, ["user", "show", "--json"], {
				timeoutMs: LOGIN_TIMEOUT_MS,
			});
		} catch {
			return "UNKNOWN";
		}
		if (result.exitCode === null) return "UNKNOWN";
		try {
			return parseDevTunnelLoginStatus(
				parseJson(result.stdout, "devtunnel user show --json"),
			);
		} catch {
			return "UNKNOWN";
		}
	};
	return {
		async ensureLogin() {
			const before = await loginStatus();
			if (before === "LOGGED_IN") return before;
			if (before === "UNKNOWN")
				throw new Error("Dev Tunnel login status is UNKNOWN");
			const login = await run(
				command,
				["user", "login", "--github", "--use-browser-auth"],
				{ timeoutMs: 600_000, interactive: true },
			);
			assertCommandSucceeded(login, "GitHub browser authentication");
			const after = await loginStatus();
			if (after !== "LOGGED_IN")
				throw new Error(
					"Dev Tunnel login was not confirmed after authentication",
				);
			return after;
		},
		async inspectTunnel(tunnelId) {
			const result = await runRemoteQuery(["show", tunnelId, "--json"]);
			if (result.exitCode !== 0) {
				return /not found|does not exist|could not be found/i.test(
					commandText(result),
				)
					? { state: "MISSING", hostState: "UNKNOWN" }
					: { state: "UNKNOWN", hostState: "UNKNOWN" };
			}
			try {
				const tunnel = parseTunnel(
					parseJson(result.stdout, "devtunnel show --json"),
				);
				if (!sameTunnelIdentity(tunnelId, tunnel.tunnelId))
					return { state: "UNKNOWN", hostState: "UNKNOWN" };
				const hostState =
					tunnel.hostConnections !== undefined
						? tunnel.hostConnections > 0
							? ("RUNNING" as const)
							: ("STOPPED" as const)
						: tunnel.endpoints === undefined
							? ("UNKNOWN" as const)
							: tunnel.endpoints.length === 0
								? ("STOPPED" as const)
								: ("RUNNING" as const);
				return { state: "EXISTS", hostState };
			} catch {
				return { state: "UNKNOWN", hostState: "UNKNOWN" };
			}
		},
		async createTunnel(tunnelId) {
			const result = await run(
				command,
				["create", tunnelId, "--allow-anonymous", "--json"],
				{ timeoutMs: REMOTE_COMMAND_TIMEOUT_MS },
			);
			assertCommandSucceeded(result, "devtunnel create --json");
			const tunnel = parseTunnel(
				parseJson(result.stdout, "devtunnel create --json"),
			);
			if (!sameTunnelIdentity(tunnelId, tunnel.tunnelId))
				throw new Error("devtunnel create returned an unexpected tunnelId");
			return tunnelId;
		},
		async ensurePort(tunnelId, port) {
			const listed = await runRemoteQuery(["port", "list", tunnelId, "--json"]);
			assertCommandSucceeded(listed, "devtunnel port list --json");
			const existing = parsePorts(
				parseJson(listed.stdout, "devtunnel port list --json"),
			).find((item) => item.portNumber === port);
			if (existing?.protocol?.toLowerCase() === "http") return "REUSED";
			if (existing) {
				const removed = await run(
					command,
					["port", "delete", tunnelId, "--port-number", String(port), "--json"],
					{ timeoutMs: REMOTE_COMMAND_TIMEOUT_MS },
				);
				assertCommandSucceeded(removed, "devtunnel port delete --json");
			}
			const mutation = await run(
				command,
				[
					"port",
					"create",
					tunnelId,
					"--port-number",
					String(port),
					"--protocol",
					"http",
					"--json",
				],
				{ timeoutMs: REMOTE_COMMAND_TIMEOUT_MS },
			);
			assertCommandSucceeded(mutation, "devtunnel port create --json");
			const confirmed = parsePorts(
				parseJson(mutation.stdout, "devtunnel port create --json"),
			)[0];
			if (
				confirmed === undefined ||
				confirmed.portNumber !== port ||
				confirmed.protocol?.toLowerCase() !== "http"
			)
				throw new Error(
					"Dev Tunnel port mutation did not confirm the Gateway port",
				);
			return existing ? "UPDATED" : "CREATED";
		},
		async discoverPublicBaseUrl(tunnelId, port) {
			let lastError: unknown;
			for (let attempt = 0; attempt < 3; attempt += 1) {
				const shown = await runRemoteQuery(["show", tunnelId, "--json"], false);
				assertCommandSucceeded(shown, "devtunnel show --json");
				try {
					return discoverPublicBaseUrl(
						parseJson(shown.stdout, "devtunnel show --json"),
						port,
					);
				} catch (error) {
					lastError = error;
					if (attempt < 2)
						await new Promise((resolve) => setTimeout(resolve, 250));
				}
			}
			throw lastError instanceof Error
				? lastError
				: new Error("publicBaseUrl discovery failed");
		},
	};
}

export async function verifyProvisionedPublicBaseUrl(
	publicBaseUrl: string,
	timeoutMs = 10_000,
): Promise<void> {
	const url = new URL(publicBaseUrl);
	const port = url.port === "" ? 443 : Number(url.port);
	if (url.protocol !== "https:" || port !== 443)
		throw new Error("publicBaseUrl must use HTTPS on port 443");
	const protocol = await probeTlsProtocol(url.hostname, port, timeoutMs);
	if (protocol === undefined || !tlsProtocolAtLeast(protocol, "TLSv1.2"))
		throw new Error("publicBaseUrl did not negotiate TLS 1.2 or newer");
	try {
		await fetch(url, {
			method: "GET",
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch {
		throw new Error("publicBaseUrl is not reachable over HTTPS");
	}
}

interface DevTunnelProcessRecord {
	contract: "proflow.dev-tunnel-process.v1";
	pid: number;
	command: string;
	tunnelId: string;
	startedAt: string;
}

async function readProcessRecord(
	file: string | undefined,
): Promise<DevTunnelProcessRecord | undefined> {
	if (!file) return undefined;
	try {
		const raw = JSON.parse(
			await readFile(file, "utf8"),
		) as Partial<DevTunnelProcessRecord>;
		if (
			raw.contract !== "proflow.dev-tunnel-process.v1" ||
			typeof raw.pid !== "number" ||
			!Number.isInteger(raw.pid) ||
			raw.pid <= 0 ||
			typeof raw.command !== "string" ||
			raw.command.length === 0 ||
			typeof raw.tunnelId !== "string" ||
			raw.tunnelId.length === 0 ||
			typeof raw.startedAt !== "string" ||
			Number.isNaN(Date.parse(raw.startedAt))
		)
			return undefined;
		return raw as DevTunnelProcessRecord;
	} catch {
		return undefined;
	}
}

async function writeProcessRecord(
	file: string,
	record: DevTunnelProcessRecord,
): Promise<void> {
	await mkdir(dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await rename(temporary, file);
}

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function processCommandLine(pid: number): Promise<string | undefined> {
	return new Promise((resolve) => {
		const command = process.platform === "win32" ? "powershell.exe" : "ps";
		const args =
			process.platform === "win32"
				? [
						"-NoProfile",
						"-Command",
						`(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
					]
				: ["-p", String(pid), "-o", "command="];
		execFile(command, args, { timeout: 2_000 }, (error, stdout) => {
			resolve(error ? undefined : String(stdout));
		});
	});
}

async function processRecordIsOwned(
	record: DevTunnelProcessRecord,
	command: string,
	tunnelId: string,
): Promise<boolean> {
	if (
		record.command !== command ||
		record.tunnelId !== tunnelId ||
		!processAlive(record.pid)
	)
		return false;
	const commandLine = await processCommandLine(record.pid);
	return (
		commandLine?.includes(command) === true && commandLine.includes(tunnelId)
	);
}

async function waitForProcessExit(
	pid: number,
	timeoutMs = 2_000,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!processAlive(pid)) return true;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return !processAlive(pid);
}

export function createDevTunnelRuntime(input: {
	command?: string;
	tunnelId?: string;
	publicBaseUrl?: string;
	runCommand?: CommandRunner;
	processStateFile?: string;
	loginVerified?: boolean;
}): DevTunnelRuntime {
	const command = input.command ?? "devtunnel";
	const tunnelId = input.tunnelId;
	const publicBaseUrl = input.publicBaseUrl;
	const processStateFile = input.processStateFile;
	const run = input.runCommand ?? defaultCommandRunner;
	let child: ChildProcess | undefined;

	const observeLogin = async (): Promise<DevTunnelLoginStatus> => {
		let result: CommandResult;
		try {
			result = await run(command, LOGIN_ARGS, { timeoutMs: LOGIN_TIMEOUT_MS });
		} catch {
			return "UNKNOWN";
		}
		if (result.exitCode === null) return "UNKNOWN";
		try {
			return parseDevTunnelLoginStatus(
				parseJson(result.stdout, "devtunnel user show --json"),
			);
		} catch {
			return "UNKNOWN";
		}
	};

	const observation = (
		state: DevTunnelState,
		login: DevTunnelLoginStatus = "UNKNOWN",
	): DevTunnelObservation => ({
		state,
		login,
		...(publicBaseUrl === undefined ? {} : { publicBaseUrl }),
	});

	const ownedPersistedPid = async (): Promise<number | undefined> => {
		if (!processStateFile || !tunnelId) return undefined;
		const record = await readProcessRecord(processStateFile);
		if (!record) return undefined;
		if (await processRecordIsOwned(record, command, tunnelId))
			return record.pid;
		await rm(processStateFile, { force: true });
		return undefined;
	};

	return {
		command,
		async status() {
			if (await ownedPersistedPid()) return observation("RUNNING");
			if (child?.pid && processAlive(child.pid)) return observation("RUNNING");
			return observation("UNKNOWN");
		},
		loginStatus: () => observeLogin(),
		publicBaseUrl: () => publicBaseUrl,
		async start() {
			const login = input.loginVerified ? "LOGGED_IN" : await observeLogin();
			if (login !== "LOGGED_IN") return observation("UNKNOWN", login);
			if (tunnelId === undefined) {
				throw new TypeError(
					"tunnelId is required to host the configured persistent tunnel",
				);
			}
			if (await ownedPersistedPid()) return observation("RUNNING", login);
			if (child?.pid && processAlive(child.pid))
				return observation("RUNNING", login);

			const spawned = spawn(command, ["host", tunnelId], {
				stdio: "ignore",
				detached: true,
			});
			const confirmed = await new Promise<"RUNNING" | "FAILED">((resolve) => {
				let settled = false;
				const fail = () => {
					if (settled) return;
					settled = true;
					resolve("FAILED");
				};
				spawned.once("error", fail);
				spawned.once("exit", fail);
				setTimeout(() => {
					if (settled) return;
					settled = true;
					resolve("RUNNING");
				}, START_CONFIRM_MS);
			});
			if (confirmed === "FAILED" || spawned.pid === undefined) {
				throw new Error("devtunnel host process failed to start");
			}

			child = spawned;
			spawned.once("exit", () => {
				if (child === spawned) child = undefined;
				if (processStateFile) void rm(processStateFile, { force: true });
			});
			if (processStateFile) {
				try {
					await writeProcessRecord(processStateFile, {
						contract: "proflow.dev-tunnel-process.v1",
						pid: spawned.pid,
						command,
						tunnelId,
						startedAt: new Date().toISOString(),
					});
				} catch (error) {
					spawned.kill();
					child = undefined;
					throw error;
				}
			}
			spawned.unref();
			return observation("RUNNING", login);
		},
		async stop() {
			const persistedPid = await ownedPersistedPid();
			const pid = persistedPid ?? child?.pid;
			if (!pid || !processAlive(pid)) {
				if (processStateFile) await rm(processStateFile, { force: true });
				child = undefined;
				return observation("STOPPED");
			}
			try {
				process.kill(pid, "SIGTERM");
			} catch {
				return observation("UNKNOWN");
			}
			if (!(await waitForProcessExit(pid))) return observation("UNKNOWN");
			if (processStateFile) await rm(processStateFile, { force: true });
			child = undefined;
			return observation("STOPPED");
		},
		async restart() {
			const stopped = await this.stop();
			if (stopped.state !== "STOPPED") return stopped;
			return this.start();
		},
	};
}

export interface IngressCheck {
	id: string;
	status: "PASS" | "FAIL" | "WARN" | "SKIP";
	message: string;
}

export interface PublicIngressVerification {
	reachable: boolean;
	ok: boolean;
	checks: IngressCheck[];
}

export interface ErrorSemanticsProof {
	rateLimit429Verified: boolean;
	server5xxVerified: boolean;
	message: string;
}

export interface FileRelayProof {
	verified: boolean;
	message: string;
}

export interface PublicIngressVerifyOptions {
	verifyErrorSemantics?: () => Promise<ErrorSemanticsProof>;
	verifyFileRelay?: () => Promise<FileRelayProof>;
	timeoutMs?: number;
}

const TLS_PROTOCOL_RANK: Record<string, number> = {
	TLSv1: 10,
	"TLSv1.1": 11,
	"TLSv1.2": 12,
	"TLSv1.3": 13,
};

function tlsProtocolAtLeast(protocol: string, minimum: string): boolean {
	return (
		(TLS_PROTOCOL_RANK[protocol] ?? 0) >= (TLS_PROTOCOL_RANK[minimum] ?? 0)
	);
}

export function probeTlsProtocol(
	host: string,
	port: number,
	timeoutMs: number,
): Promise<string | undefined> {
	return new Promise((resolve) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (protocol: string | undefined) => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearTimeout(timer);
			socket.destroy();
			resolve(protocol);
		};
		const socket = connect(
			{ host, port, servername: host, rejectUnauthorized: true },
			() => finish(socket.getProtocol() ?? undefined),
		);
		timer = setTimeout(() => finish(undefined), timeoutMs);
		socket.once("error", () => finish(undefined));
	});
}

export async function readResponseChars(
	response: Response,
	ceiling: number,
): Promise<number | undefined> {
	const body = response.body;
	if (body === null) return 0;
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let chars = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				chars += decoder.decode().length;
				break;
			}
			chars += decoder.decode(value, { stream: true }).length;
			if (chars >= ceiling) {
				await reader.cancel();
				break;
			}
		}
		return chars;
	} catch {
		return undefined;
	}
}

export async function verifyPublicIngress(
	publicBaseUrl: string,
	options?: PublicIngressVerifyOptions,
): Promise<PublicIngressVerification> {
	const timeoutMs = options?.timeoutMs ?? 45_000;
	const checks: IngressCheck[] = [];

	let url: URL;
	try {
		url = new URL(publicBaseUrl);
	} catch {
		return {
			reachable: false,
			ok: false,
			checks: [
				{
					id: "public-https-url",
					status: "FAIL",
					message: `publicBaseUrl is not a valid URL: ${publicBaseUrl}`,
				},
			],
		};
	}

	const isHttps = url.protocol === "https:";
	const port = url.port === "" ? 443 : Number(url.port);
	const isPort443 = port === 443;
	checks.push({
		id: "public-https-port-443",
		status: isHttps && isPort443 ? "PASS" : "FAIL",
		message:
			isHttps && isPort443
				? "public ingress is public HTTPS on port 443"
				: `public ingress must be HTTPS on port 443 (got ${url.protocol}// port ${port})`,
	});

	if (!isHttps) {
		return { reachable: false, ok: false, checks };
	}

	const tlsProtocol = await probeTlsProtocol(url.hostname, port, timeoutMs);
	const tlsOk =
		tlsProtocol !== undefined && tlsProtocolAtLeast(tlsProtocol, "TLSv1.2");
	checks.push({
		id: "tls-version",
		status: tlsProtocol === undefined ? "FAIL" : tlsOk ? "PASS" : "FAIL",
		message:
			tlsProtocol === undefined
				? "could not negotiate a TLS connection to the public ingress within the timeout"
				: tlsOk
					? `TLS handshake negotiated ${tlsProtocol} (>= TLSv1.2)`
					: `TLS handshake negotiated ${tlsProtocol} (< TLSv1.2)`,
	});

	let statusCode = 0;
	let responseChars = 0;
	let roundTripMs: number | undefined;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const startedAt = Date.now();
	try {
		const response = await fetch(url, {
			method: "GET",
			signal: controller.signal,
		});
		statusCode = response.status;
		const chars = await readResponseChars(response, 100_000);
		if (chars === undefined) {
			roundTripMs = undefined;
		} else {
			responseChars = chars;
			roundTripMs = Date.now() - startedAt;
		}
	} catch {
		roundTripMs = undefined;
	} finally {
		clearTimeout(timer);
	}

	const httpReachable = roundTripMs !== undefined && statusCode > 0;

	checks.push({
		id: "round-trip-ceiling",
		status:
			httpReachable && roundTripMs !== undefined && roundTripMs <= timeoutMs
				? "PASS"
				: "FAIL",
		message:
			httpReachable && roundTripMs !== undefined
				? `probe round-trip completed in ${roundTripMs}ms (ceiling ${timeoutMs}ms)`
				: "public ingress did not respond within the round-trip ceiling",
	});

	const sizeOk = responseChars < 100_000;
	checks.push({
		id: "request-response-size",
		status: !httpReachable ? "FAIL" : sizeOk ? "PASS" : "FAIL",
		message: !httpReachable
			? "could not measure the probe response size"
			: sizeOk
				? `probe response is ${responseChars} chars (< 100,000)`
				: `probe response is ${responseChars} chars (>= 100,000)`,
	});

	// File relay is a frozen hard contract; a missing real proof is a FAIL, never SKIP.
	if (options?.verifyFileRelay === undefined) {
		checks.push({
			id: "file-relay-reachable",
			status: "FAIL",
			message:
				"file relay proof is not injected; relay reachability is unverified",
		});
	} else {
		const proof = await options.verifyFileRelay();
		checks.push({
			id: "file-relay-reachable",
			status: proof.verified ? "PASS" : "FAIL",
			message: proof.message,
		});
	}

	// Real 429/5xx semantics are a frozen hard contract; missing proof is a FAIL.
	if (options?.verifyErrorSemantics === undefined) {
		checks.push(
			{
				id: "real-status-429",
				status: "FAIL",
				message:
					"429 proof is not injected; rate-limit semantics are unverified",
			},
			{
				id: "real-status-5xx",
				status: "FAIL",
				message:
					"5xx proof is not injected; server-error semantics are unverified",
			},
		);
	} else {
		const proof = await options.verifyErrorSemantics();
		checks.push(
			{
				id: "real-status-429",
				status: proof.rateLimit429Verified ? "PASS" : "FAIL",
				message: proof.rateLimit429Verified
					? "429 rate-limit semantics verified"
					: "429 rate-limit semantics unverified",
			},
			{
				id: "real-status-5xx",
				status: proof.server5xxVerified ? "PASS" : "FAIL",
				message: proof.server5xxVerified
					? "5xx server-error semantics verified"
					: "5xx server-error semantics unverified",
			},
		);
	}

	const reachable = httpReachable;
	const ok = checks.every((check) => check.status === "PASS");
	return { reachable, ok, checks };
}
