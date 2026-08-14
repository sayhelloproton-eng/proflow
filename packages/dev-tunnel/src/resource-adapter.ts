import { type ChildProcess, execFile, spawn } from "node:child_process";
import { connect } from "node:tls";

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
	options?: { timeoutMs?: number },
) => Promise<CommandResult>;

export interface DevTunnelRuntime {
	readonly command: string;
	status(): Promise<DevTunnelObservation>;
	loginStatus(): Promise<DevTunnelLoginStatus>;
	publicBaseUrl(): string | undefined;
	start(): Promise<DevTunnelObservation>;
	stop(): Promise<DevTunnelObservation>;
	restart(): Promise<DevTunnelObservation>;
}

const LOGIN_ARGS = ["user", "show"];
const LOGIN_TIMEOUT_MS = 10_000;
const START_CONFIRM_MS = 500;

function defaultCommandRunner(
	command: string,
	args: string[],
	options?: { timeoutMs?: number },
): Promise<CommandResult> {
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

export function createDevTunnelRuntime(input: {
	command?: string;
	tunnelId?: string;
	publicBaseUrl?: string;
	runCommand?: CommandRunner;
}): DevTunnelRuntime {
	const command = input.command ?? "devtunnel";
	const tunnelId = input.tunnelId;
	const publicBaseUrl = input.publicBaseUrl;
	const run = input.runCommand ?? defaultCommandRunner;
	let child: ChildProcess | undefined;

	const observeLogin = async (): Promise<DevTunnelLoginStatus> => {
		let result: CommandResult;
		try {
			result = await run(command, LOGIN_ARGS, { timeoutMs: LOGIN_TIMEOUT_MS });
		} catch {
			return "UNKNOWN";
		}
		if (result.exitCode === 0) {
			return result.stdout.trim().length > 0 ? "LOGGED_IN" : "NOT_LOGGED_IN";
		}
		return result.exitCode === null ? "UNKNOWN" : "NOT_LOGGED_IN";
	};

	const observe = async (
		state: DevTunnelState,
	): Promise<DevTunnelObservation> => {
		const login = await observeLogin();
		return {
			state,
			login,
			...(publicBaseUrl === undefined ? {} : { publicBaseUrl }),
		};
	};

	return {
		command,
		// A live owned child is RUNNING; without one we cannot prove the
		// external tunnel has stopped, so we report UNKNOWN rather than a
		// deterministic STOPPED.
		status: () => observe(child ? "RUNNING" : "UNKNOWN"),
		loginStatus: () => observeLogin(),
		publicBaseUrl: () => publicBaseUrl,
		async start() {
			const login = await observeLogin();
			if (login !== "LOGGED_IN") return observe("UNKNOWN");
			if (tunnelId === undefined) {
				throw new TypeError(
					"tunnelId is required to host the configured persistent tunnel",
				);
			}
			if (child) return observe("RUNNING");
			child = spawn(command, ["host", tunnelId], { stdio: "ignore" });
			const confirmed = await new Promise<"RUNNING" | "FAILED">((resolve) => {
				let settled = false;
				const fail = () => {
					if (settled) return;
					settled = true;
					child = undefined;
					resolve("FAILED");
				};
				child?.once("error", fail);
				child?.once("exit", fail);
				setTimeout(() => {
					if (settled) return;
					settled = true;
					resolve("RUNNING");
				}, START_CONFIRM_MS);
			});
			if (confirmed === "FAILED") {
				throw new Error("devtunnel host process failed to start");
			}
			return observe("RUNNING");
		},
		async stop() {
			if (child) {
				child.kill();
				child = undefined;
				return observe("STOPPED");
			}
			return observe("UNKNOWN");
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
