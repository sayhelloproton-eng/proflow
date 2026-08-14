import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import {
	access,
	appendFile,
	type FileHandle,
	mkdir,
	open,
	readdir,
	readFile,
	realpath,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { isIP } from "node:net";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";

import type {
	ExecuteCapabilityRequest,
	ExecutionCapabilityResult,
	ExecutionErrorCode,
	ExecutionEvidence,
	ExternalFileMaterializationInput,
	ExternalFileMaterializationResult,
	LocalCapabilityId,
} from "@tomflow/proflow-execution-contracts";

export interface LocalExecutorOptions {
	projectRoot: string;
	artifactRoot: string;
	exactNetworkTargets?: readonly string[];
	baseEnv?: Readonly<Record<string, string>>;
	now?: () => Date;
	idFactory?: () => string;
}

export interface LocalAdmission {
	policy: "ALLOW";
	decisionPath: "deterministic" | "fast" | "reason" | "human";
	approval: "NOT_REQUIRED" | "VALID";
}

export type LocalPrecondition =
	| {
			kind: "file.write";
			capability: "file.write";
			path: string;
			beforeHash?: string;
			expectedAfterHash: string;
	  }
	| {
			kind: "git.commit";
			capability: "git.commit";
			beforeHead: string;
			beforeIndexHash: string;
			message: string;
			paths?: string[];
	  }
	| {
			kind: "install-dependency";
			capability: "project.installDependency";
			packageManager: "pnpm" | "npm" | "yarn";
			packageName: string;
			manifestPackageName?: string;
			receiptFile: string;
			requested: string;
			dev: boolean;
			beforeManifestHash: string;
			beforeLockHash?: string;
			beforeDeclaration?: string;
	  }
	| {
			kind: "process.start";
			capability: "process.start";
			processRef: string;
			mode: "one-shot" | "managed";
			readiness?:
				| { kind: "port"; port: number }
				| { kind: "http"; url: string }
				| { kind: "log"; pattern: string };
	  }
	| {
			kind: "process.stop";
			capability: "process.stop";
			processRef: string;
			pid?: number;
			birthIdentity?: string;
	  }
	| { kind: "opaque"; capability: LocalCapabilityId };

export interface LocalArtifact {
	ref: string;
	path: string;
	bytes: number;
	stream: "stdout" | "stderr" | "report";
}

export interface LocalExecutionResult {
	result: ExecutionCapabilityResult;
	evidence: ExecutionEvidence[];
	artifacts: LocalArtifact[];
	precondition?: LocalPrecondition;
	effectApplied: boolean;
	successful: boolean;
}

export interface LocalExecutorInvocation {
	request: ExecuteCapabilityRequest;
	admission: LocalAdmission;
	signal?: AbortSignal;
	onEffectStarted?: (precondition: LocalPrecondition) => void | Promise<void>;
}

export interface LocalReconciliation {
	state: "APPLIED" | "NOT_APPLIED" | "UNKNOWN";
	evidence: ExecutionEvidence[];
	result?: ExecutionCapabilityResult;
}

export class LocalExecutionError extends Error {
	readonly code: ExecutionErrorCode;
	readonly retryable: boolean;

	constructor(code: ExecutionErrorCode, message: string, retryable = false) {
		super(message);
		this.name = "LocalExecutionError";
		this.code = code;
		this.retryable = retryable;
	}
}

interface ManagedProcessRecord {
	processRef: string;
	pid: number;
	stdoutRef: string;
	stderrRef: string;
	stdoutPath: string;
	stderrPath: string;
	startedAt: string;
	processIdentity: string;
}

interface CapturedProcessResult {
	exitCode: number;
	durationMs: number;
	stdoutSummary: string;
	stderrSummary: string;
	stdout: LocalArtifact;
	stderr: LocalArtifact;
}

const localCapabilities = new Set<string>([
	"file.read",
	"file.write",
	"file.searchText",
	"git.status",
	"git.diff",
	"git.commit",
	"git.push",
	"project.info",
	"project.installDependency",
	"quality.test",
	"quality.build",
	"quality.lint",
	"quality.typecheck",
	"code.findSymbol",
	"code.findReferences",
	"process.start",
	"process.stop",
	"process.status",
	"network.request",
	"shell.run",
]);

const excludedSearchDirectories = new Set([
	".git",
	".proflow",
	"node_modules",
	"dist",
]);
const sensitiveKey =
	/(?:authorization|bearer|api[_-]?key|token|password|cookie|private[_-]?key|secret)/i;
const dangerousCommands = new Set([
	"sudo",
	"su",
	"shutdown",
	"reboot",
	"halt",
	"poweroff",
	"mkfs",
	"fdisk",
	"diskutil",
]);

function sha256(value: string | Uint8Array): string {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function within(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return (
		rel === "" ||
		(rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
	);
}

function redactText(value: string, secrets: readonly string[]): string {
	let redacted = value
		.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
		.replace(
			/((?:authorization|api[_-]?key|token|password|cookie|secret|private[_-]?key)\s*[:=]\s*)[^\s,;]+/gi,
			"$1[REDACTED]",
		);
	for (const secret of secrets) {
		if (secret.length > 0) redacted = redacted.split(secret).join("[REDACTED]");
	}
	return redacted;
}

/**
 * Returns the longest prefix of `text` whose UTF-8 byte length does not exceed
 * `maxBytes`, never splitting a multi-byte code point in half.
 */
function truncateUtf8(text: string, maxBytes: number): string {
	if (maxBytes <= 0) return "";
	if (Buffer.byteLength(text) <= maxBytes) return text;
	let result = "";
	let bytes = 0;
	for (const char of text) {
		const charBytes = Buffer.byteLength(char);
		if (bytes + charBytes > maxBytes) break;
		result += char;
		bytes += charBytes;
	}
	return result;
}

/** Accumulates a UTF-8 byte-bounded summary (not a JS character slice). */
function createByteBoundedSummary(maxBytes: number) {
	let value = "";
	return {
		push(text: string): void {
			const remaining = maxBytes - Buffer.byteLength(value);
			if (remaining <= 0) return;
			value += truncateUtf8(text, remaining);
		},
		value(): string {
			return value;
		},
	};
}

/**
 * Streams redaction across chunk boundaries. A secret split between two chunks
 * is still fully removed because a `maxSecretLength` tail is carried forward.
 */
function createStreamingRedactor(secrets: readonly string[]) {
	const maxSecret = secrets.reduce(
		(max, secret) => Math.max(max, secret.length),
		0,
	);
	let carry = "";
	return {
		push(chunk: string): string {
			if (maxSecret === 0) return redactText(chunk, secrets);
			const combined = redactText(carry + chunk, secrets);
			if (combined.length <= maxSecret) {
				carry = combined;
				return "";
			}
			const emit = combined.slice(0, combined.length - maxSecret);
			carry = combined.slice(combined.length - maxSecret);
			return emit;
		},
		flush(): string {
			const tail = carry;
			carry = "";
			return tail;
		},
		peek(): string {
			return carry;
		},
	};
}

/**
 * Extracts positional secret values from argv (`--token v`, `--token=v`,
 * `--password`, `--api-key`, etc.) so they enter the redaction secret set.
 */
function extractArgvSecrets(args: readonly string[]): string[] {
	const secrets: string[] = [];
	const flagPattern =
		/^--?(?:token|password|api[_-]?key|authorization|bearer|cookie|secret|private[_-]?key)(?:=(.*))?$/i;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === undefined) continue;
		const match = flagPattern.exec(arg);
		if (!match) continue;
		const inline = match[1];
		if (inline !== undefined && inline.length > 0) {
			secrets.push(inline);
			continue;
		}
		const next = args[i + 1];
		if (next !== undefined) {
			secrets.push(next);
			i++;
		}
	}
	return secrets;
}

/**
 * Extracts request-side secrets from headers and body so a response body that
 * echoes them (or a later hop that forwards them) is still redacted at rest.
 */
function extractRequestSecrets(
	headers: Readonly<Record<string, string>> | undefined,
	body: string | undefined,
): string[] {
	const secrets: string[] = [];
	for (const [name, value] of Object.entries(headers ?? {})) {
		if (sensitiveKey.test(name) && value.length > 0) secrets.push(value);
	}
	if (body !== undefined) {
		for (const match of body.matchAll(/Bearer\s+([A-Za-z0-9._~+/-]+=*)/gi)) {
			const token = match[1];
			if (typeof token === "string" && token.length > 0) secrets.push(token);
		}
		for (const match of body.matchAll(
			/((?:authorization|api[_-]?key|token|password|cookie|secret|private[_-]?key)\s*[:=]\s*)([^\s,;"'}]+)/gi,
		)) {
			const value = match[2];
			if (typeof value === "string" && value.length > 0) secrets.push(value);
		}
		for (const match of body.matchAll(
			/("(?:password|token|secret|api[_-]?key|authorization|cookie|private[_-]?key)"\s*:\s*")((?:[^"\\]|\\.)*)(")/gi,
		)) {
			const value = match[2];
			if (typeof value === "string" && value.length > 0) secrets.push(value);
		}
	}
	return secrets;
}

function safeEnvironment(
	base: Readonly<Record<string, string>>,
	requested: Readonly<Record<string, string>> | undefined,
): { env: Record<string, string>; secrets: string[] } {
	for (const key of Object.keys(requested ?? {})) {
		if (key === "PATH" || sensitiveKey.test(key))
			throw new LocalExecutionError(
				"SCOPE_DENIED",
				`requested environment key is outside execution scope: ${key}`,
			);
	}
	const env: Record<string, string> = {};
	for (const key of ["PATH", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE"]) {
		const value = process.env[key];
		if (value !== undefined) env[key] = value;
	}
	for (const [key, value] of Object.entries(base)) env[key] = value;
	for (const [key, value] of Object.entries(requested ?? {})) env[key] = value;
	const secrets = Object.entries(env)
		.filter(([key]) => sensitiveKey.test(key))
		.map(([, value]) => value);
	return { env, secrets };
}

function assertSafeCommand(command: string, args: readonly string[]): void {
	const name = basename(command).toLowerCase();
	if (dangerousCommands.has(name)) {
		throw new LocalExecutionError(
			"POLICY_DENIED",
			`dangerous command denied: ${name}`,
		);
	}
	if (
		["sh", "bash", "zsh", "fish"].includes(name) &&
		args.some((arg) => arg === "-c" || arg === "-lc")
	) {
		throw new LocalExecutionError(
			"POLICY_DENIED",
			"nested command-string shells are not accepted by the argv escape hatch",
		);
	}
	const joined = [command, ...args].join(" ");
	if (/[|;&`]|\$\(|\r|\n/.test(command)) {
		throw new LocalExecutionError(
			"POLICY_DENIED",
			"complex shell syntax is not accepted by the argv escape hatch",
		);
	}
	if (
		/\brm\s+(?:-[A-Za-z]*r[A-Za-z]*f|-rf|-fr)\s+(?:\/|~|\$HOME)\b/.test(joined)
	) {
		throw new LocalExecutionError(
			"POLICY_DENIED",
			"system-wide destructive command denied",
		);
	}
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function killProcessTree(pid: number): Promise<void> {
	try {
		process.kill(-pid, "SIGTERM");
	} catch {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			return;
		}
	}
	await new Promise((resolveWait) => setTimeout(resolveWait, 80));
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			return;
		}
	}
}

async function captureCommand(input: {
	command: string;
	args: readonly string[];
	cwd: string;
	env: Record<string, string>;
	secrets: readonly string[];
	timeoutMs: number;
	maxOutputBytes: number;
	artifactRoot: string;
	id: string;
	signal?: AbortSignal;
}): Promise<CapturedProcessResult> {
	if (input.signal?.aborted)
		throw new LocalExecutionError(
			"CANCELLED",
			"local process cancelled before spawn",
		);
	const stdoutPath = join(input.artifactRoot, `${input.id}.stdout.log`);
	const stderrPath = join(input.artifactRoot, `${input.id}.stderr.log`);
	const stdoutHandle = await open(stdoutPath, "w", 0o600);
	const stderrHandle = await open(stderrPath, "w", 0o600);
	const startedAt = performance.now();
	const child = spawn(input.command, [...input.args], {
		cwd: input.cwd,
		env: input.env,
		stdio: ["ignore", "pipe", "pipe"],
		detached: true,
	});
	let stdoutBytes = 0;
	let stderrBytes = 0;
	const allSecrets = [...input.secrets, ...extractArgvSecrets(input.args)];
	const stdoutRedactor = createStreamingRedactor(allSecrets);
	const stderrRedactor = createStreamingRedactor(allSecrets);
	const stdoutSummary = createByteBoundedSummary(input.maxOutputBytes);
	const stderrSummary = createByteBoundedSummary(input.maxOutputBytes);
	let writeChain = Promise.resolve();
	const capture = (stream: "stdout" | "stderr", chunk: Buffer) => {
		const redactor = stream === "stdout" ? stdoutRedactor : stderrRedactor;
		const text = redactor.push(chunk.toString("utf8"));
		if (text.length === 0) return;
		const bytes = Buffer.byteLength(text);
		if (stream === "stdout") {
			stdoutBytes += bytes;
			stdoutSummary.push(text);
			writeChain = writeChain
				.then(() => stdoutHandle.write(text))
				.then(() => undefined);
		} else {
			stderrBytes += bytes;
			stderrSummary.push(text);
			writeChain = writeChain
				.then(() => stderrHandle.write(text))
				.then(() => undefined);
		}
	};
	child.stdout.on("data", (chunk: Buffer) => capture("stdout", chunk));
	child.stderr.on("data", (chunk: Buffer) => capture("stderr", chunk));
	let timedOut = false;
	let cancelled = false;
	const timer = setTimeout(() => {
		timedOut = true;
		void killProcessTree(child.pid ?? 0);
	}, input.timeoutMs);
	const abort = () => {
		cancelled = true;
		void killProcessTree(child.pid ?? 0);
	};
	input.signal?.addEventListener("abort", abort, { once: true });
	const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
		child.once("error", rejectExit);
		child.once("close", (code) => resolveExit(code ?? 1));
	}).finally(() => {
		clearTimeout(timer);
		input.signal?.removeEventListener("abort", abort);
	});
	await killProcessTree(child.pid ?? 0);
	const stdoutTail = stdoutRedactor.flush();
	const stderrTail = stderrRedactor.flush();
	if (stdoutTail.length > 0) {
		stdoutBytes += Buffer.byteLength(stdoutTail);
		stdoutSummary.push(stdoutTail);
		writeChain = writeChain
			.then(() => stdoutHandle.write(stdoutTail))
			.then(() => undefined);
	}
	if (stderrTail.length > 0) {
		stderrBytes += Buffer.byteLength(stderrTail);
		stderrSummary.push(stderrTail);
		writeChain = writeChain
			.then(() => stderrHandle.write(stderrTail))
			.then(() => undefined);
	}
	await writeChain;
	await stdoutHandle.close();
	await stderrHandle.close();
	if (timedOut)
		throw new LocalExecutionError("TIMEOUT", "local process timed out");
	if (cancelled)
		throw new LocalExecutionError("CANCELLED", "local process cancelled");
	const durationMs = performance.now() - startedAt;
	return {
		exitCode,
		durationMs,
		stdoutSummary: stdoutSummary.value(),
		stderrSummary: stderrSummary.value(),
		stdout: {
			ref: `output:${input.id}:stdout`,
			path: stdoutPath,
			bytes: stdoutBytes,
			stream: "stdout",
		},
		stderr: {
			ref: `output:${input.id}:stderr`,
			path: stderrPath,
			bytes: stderrBytes,
			stream: "stderr",
		},
	};
}

async function simpleCommand(
	command: string,
	args: readonly string[],
	cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
	const child = spawn(command, [...args], {
		cwd,
		env: safeEnvironment({}, undefined).env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk: Buffer) => {
		stdout += chunk.toString("utf8");
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr += chunk.toString("utf8");
	});
	const code = await new Promise<number>((resolveExit, rejectExit) => {
		child.once("error", rejectExit);
		child.once("close", (value) => resolveExit(value ?? 1));
	});
	return { code, stdout, stderr };
}

async function processIdentity(pid: number): Promise<string | undefined> {
	// Birth identity is pid + process start time only — never the argv/command
	// line, so no positional secret can leak into the managed registry. The
	// probe is retried because `ps` can transiently fail under concurrent load.
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const observed = await simpleCommand(
				"ps",
				["-p", String(pid), "-o", "lstart="],
				process.cwd(),
			);
			const start = observed.stdout.trim();
			if (observed.code === 0 && start.length > 0)
				return `pid:${pid}:lstart:${start}`;
		} catch {
			// `ps` itself can fail to spawn (EAGAIN/EMFILE) under process-table
			// pressure; fall through to the backoff and retry like an empty probe.
		}
		if (attempt < 2)
			await new Promise<void>((resolveWait) =>
				setTimeout(resolveWait, 10 * (attempt + 1)),
			);
	}
	return undefined;
}

async function textFiles(root: string): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		if (entry.isDirectory() && excludedSearchDirectories.has(entry.name))
			continue;
		const path = join(root, entry.name);
		if (entry.isDirectory()) files.push(...(await textFiles(path)));
		else if (entry.isFile()) files.push(path);
	}
	return files;
}

function isLanOrLocal(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
	if (host === "localhost" || host === "::1" || host.startsWith("127."))
		return true;
	if (/^169\.254\./.test(host)) return false;
	if (/^(10\.|192\.168\.)/.test(host)) return true;
	const match = /^172\.(\d+)\./.exec(host);
	return (
		match?.[1] !== undefined && Number(match[1]) >= 16 && Number(match[1]) <= 31
	);
}

export class ExternalFileMaterializationError extends Error {
	readonly code: string;
	constructor(code: string, message = code) {
		super(`${code}: ${message}`);
		this.name = "ExternalFileMaterializationError";
		this.code = code;
	}
}

const EXTERNAL_FILE_MAX_COUNT = 10;
const EXTERNAL_FILE_MAX_BYTES = 10_000_000;
const EXTERNAL_FILE_AGGREGATE_MAX_BYTES = 50_000_000;
const EXTERNAL_FILE_FETCH_TIMEOUT_MS = 15_000;

function safeExternalFilename(name: string): boolean {
	return (
		name.length > 0 &&
		name !== "." &&
		name !== ".." &&
		!/[\\/]/.test(name) &&
		!name.includes("..") &&
		![...name].some((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code < 32 || code === 127;
		})
	);
}

function publicIpv4(address: string): boolean {
	const parts = address.split(".").map(Number);
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part)))
		return false;
	const [a = -1, b = -1] = parts;
	if (a <= 0 || a >= 224) return false;
	if (a === 10 || a === 127) return false;
	if (a === 100 && b >= 64 && b <= 127) return false;
	if (a === 169 && b === 254) return false;
	if (a === 172 && b >= 16 && b <= 31) return false;
	if (a === 192 && b === 168) return false;
	if (a === 198 && (b === 18 || b === 19)) return false;
	return true;
}

function publicIpv6(address: string): boolean {
	const normalized = address.toLowerCase();
	if (normalized === "::" || normalized === "::1") return false;
	if (
		normalized.startsWith("fe8") ||
		normalized.startsWith("fe9") ||
		normalized.startsWith("fea") ||
		normalized.startsWith("feb")
	)
		return false;
	if (normalized.startsWith("fc") || normalized.startsWith("fd")) return false;
	if (normalized.startsWith("ff")) return false;
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
	if (mapped?.[1]) return publicIpv4(mapped[1]);
	return true;
}

async function assertSafeExternalUrl(raw: string): Promise<URL> {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new ExternalFileMaterializationError("EXTERNAL_FILE_INPUT_INVALID");
	}
	if (url.protocol !== "https:" || url.username || url.password)
		throw new ExternalFileMaterializationError("EXTERNAL_FILE_INPUT_INVALID");
	const hostname = url.hostname.toLowerCase();
	if (hostname === "localhost" || hostname === "metadata.google.internal")
		throw new ExternalFileMaterializationError("EXTERNAL_FILE_INPUT_INVALID");
	let addresses: Array<{ address: string; family: number }>;
	try {
		addresses = await lookup(hostname, { all: true, verbatim: true });
	} catch {
		throw new ExternalFileMaterializationError("EXTERNAL_FILE_FETCH_FAILED");
	}
	if (addresses.length === 0)
		throw new ExternalFileMaterializationError("EXTERNAL_FILE_FETCH_FAILED");
	for (const candidate of addresses) {
		const family = candidate.family || isIP(candidate.address);
		const safe =
			family === 4
				? publicIpv4(candidate.address)
				: family === 6
					? publicIpv6(candidate.address)
					: false;
		if (!safe)
			throw new ExternalFileMaterializationError("EXTERNAL_FILE_INPUT_INVALID");
	}
	return url;
}

export function detectedExternalMime(prefix: Buffer): string {
	if (prefix.length >= 5 && prefix.subarray(0, 5).toString("ascii") === "%PDF-")
		return "application/pdf";
	if (
		prefix.length >= 8 &&
		prefix
			.subarray(0, 8)
			.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
	)
		return "image/png";
	if (
		prefix.length >= 3 &&
		prefix[0] === 0xff &&
		prefix[1] === 0xd8 &&
		prefix[2] === 0xff
	)
		return "image/jpeg";
	if (
		prefix.length >= 6 &&
		["GIF87a", "GIF89a"].includes(prefix.subarray(0, 6).toString("ascii"))
	)
		return "image/gif";
	if (
		prefix.length >= 4 &&
		prefix[0] === 0x50 &&
		prefix[1] === 0x4b &&
		prefix[2] === 0x03 &&
		prefix[3] === 0x04
	)
		return "application/zip";
	if (!prefix.includes(0)) return "text/plain";
	return "application/octet-stream";
}

function normalizedMime(value: string): string {
	return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function externalMimeCompatible(
	declared: string,
	responseMime: string | null,
	detected: string,
): boolean {
	const expected = normalizedMime(declared);
	const response = responseMime ? normalizedMime(responseMime) : "";
	const textExpected =
		expected.startsWith("text/") ||
		[
			"application/json",
			"application/xml",
			"application/yaml",
			"application/x-yaml",
		].includes(expected);
	if (detected === "text/plain") {
		if (!textExpected) return false;
		return (
			response === "" ||
			response === "application/octet-stream" ||
			response.startsWith("text/") ||
			response === expected
		);
	}
	return (
		expected === detected &&
		(response === "" ||
			response === expected ||
			response === "application/octet-stream")
	);
}

export async function materializeExternalFiles(options: {
	artifactRoot: string;
	files: readonly ExternalFileMaterializationInput[];
	signal?: AbortSignal;
}): Promise<ExternalFileMaterializationResult[]> {
	if (
		options.files.length === 0 ||
		options.files.length > EXTERNAL_FILE_MAX_COUNT
	)
		throw new ExternalFileMaterializationError("EXTERNAL_FILE_COUNT_EXCEEDED");
	const artifactRoot = resolve(options.artifactRoot);
	await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
	let aggregate = 0;
	const materialized: ExternalFileMaterializationResult[] = [];
	for (const file of options.files) {
		if (
			!safeExternalFilename(file.name) ||
			!file.provenanceRef ||
			!file.declaredMimeType ||
			!file.sourceUrl
		)
			throw new ExternalFileMaterializationError("EXTERNAL_FILE_INPUT_INVALID");
		let currentUrl = await assertSafeExternalUrl(file.sourceUrl);
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(),
			EXTERNAL_FILE_FETCH_TIMEOUT_MS,
		);
		const forwardAbort = () => controller.abort();
		options.signal?.addEventListener("abort", forwardAbort, { once: true });
		let response: Response | undefined;
		try {
			for (let hop = 0; hop <= 5; hop += 1) {
				response = await fetch(currentUrl, {
					redirect: "manual",
					signal: controller.signal,
				});
				const location = response.headers.get("location");
				if (response.status < 300 || response.status >= 400 || !location) break;
				if (hop === 5)
					throw new ExternalFileMaterializationError(
						"EXTERNAL_FILE_FETCH_FAILED",
						"redirect hop limit exceeded",
					);
				currentUrl = await assertSafeExternalUrl(
					new URL(location, currentUrl).href,
				);
			}
			if (!response || response.status < 200 || response.status >= 300)
				throw new ExternalFileMaterializationError(
					"EXTERNAL_FILE_FETCH_FAILED",
				);
			const declaredLength = Number(response.headers.get("content-length"));
			if (
				Number.isFinite(declaredLength) &&
				declaredLength > EXTERNAL_FILE_MAX_BYTES
			)
				throw new ExternalFileMaterializationError("EXTERNAL_FILE_TOO_LARGE");
			if (
				Number.isFinite(declaredLength) &&
				aggregate + declaredLength > EXTERNAL_FILE_AGGREGATE_MAX_BYTES
			)
				throw new ExternalFileMaterializationError(
					"EXTERNAL_FILE_AGGREGATE_TOO_LARGE",
				);
			const id = randomUUID();
			const stagingPath = join(artifactRoot, `${id}.external-file`);
			const handle = await open(stagingPath, "wx", 0o600);
			const hash = createHash("sha256");
			let bytes = 0;
			let prefix = Buffer.alloc(0);
			try {
				if (response.body) {
					const reader = response.body.getReader();
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						const chunk = Buffer.from(value);
						bytes += chunk.byteLength;
						if (bytes > EXTERNAL_FILE_MAX_BYTES)
							throw new ExternalFileMaterializationError(
								"EXTERNAL_FILE_TOO_LARGE",
							);
						if (aggregate + bytes > EXTERNAL_FILE_AGGREGATE_MAX_BYTES)
							throw new ExternalFileMaterializationError(
								"EXTERNAL_FILE_AGGREGATE_TOO_LARGE",
							);
						if (prefix.length < 512)
							prefix = Buffer.concat([
								prefix,
								chunk.subarray(0, 512 - prefix.length),
							]);
						hash.update(chunk);
						await handle.write(chunk);
					}
				}
			} catch (error) {
				await handle.close();
				await unlink(stagingPath).catch(() => undefined);
				throw error;
			}
			await handle.close();
			const detectedMimeType = detectedExternalMime(prefix);
			if (
				!externalMimeCompatible(
					file.declaredMimeType,
					response.headers.get("content-type"),
					detectedMimeType,
				)
			) {
				await unlink(stagingPath).catch(() => undefined);
				throw new ExternalFileMaterializationError(
					"EXTERNAL_FILE_MIME_MISMATCH",
				);
			}
			aggregate += bytes;
			let content: string | undefined;
			if (detectedMimeType === "text/plain") {
				try {
					content = new TextDecoder("utf-8", { fatal: true }).decode(
						await readFile(stagingPath),
					);
				} catch {
					await unlink(stagingPath).catch(() => undefined);
					throw new ExternalFileMaterializationError(
						"EXTERNAL_FILE_MIME_MISMATCH",
						"text input is not valid UTF-8",
					);
				}
			}
			materialized.push({
				name: file.name,
				provenanceRef: file.provenanceRef,
				declaredMimeType: normalizedMime(file.declaredMimeType),
				detectedMimeType,
				bytes,
				hash: `sha256:${hash.digest("hex")}`,
				artifactRef: `artifact:${id}:external-file`,
				...(content === undefined ? {} : { content }),
			});
		} catch (error) {
			if (controller.signal.aborted)
				throw new ExternalFileMaterializationError(
					options.signal?.aborted ? "CANCELLED" : "EXTERNAL_FILE_FETCH_TIMEOUT",
				);
			throw error;
		} finally {
			clearTimeout(timeout);
			options.signal?.removeEventListener("abort", forwardAbort);
		}
	}
	return materialized;
}

// ── Context Pack / Patch proposal: bounded Execution Artifact subtypes ─────
// These are Artifact mechanics, not new Stores/Services; a patch proposal is
// materialized distinctly from the apply/test Evidence that a later Effect produces.

const CONTEXT_PACK_MAX_ENTRIES = 200;
const CONTEXT_PACK_ENTRY_MAX_BYTES = 256_000;
const CONTEXT_PACK_TOTAL_MAX_BYTES = 2_000_000;
const PATCH_PROPOSAL_MAX_BYTES = 2_000_000;

const textMimePrefixes = new Set([
	"text/",
	"application/json",
	"application/xml",
	"application/x-yaml",
	"application/x-ndjson",
	"image/svg+xml",
]);

function isTextMime(mimeType: string): boolean {
	const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
	return [...textMimePrefixes].some(
		(prefix) => normalized === prefix || normalized.startsWith(prefix),
	);
}

export interface ContextPackEntryInput {
	path: string;
	mimeType: string;
	content: string;
}

export interface ContextPackManifestEntry {
	path: string;
	mimeType: string;
	bytes: number;
}

export interface ContextPackResult {
	artifactRef: string;
	hash: string;
	bytes: number;
	entries: number;
	binaryFiltered: number;
	redacted: boolean;
	manifest: ContextPackManifestEntry[];
}

export async function materializeContextPack(options: {
	artifactRoot: string;
	taskId: string;
	nodeId: string;
	entries: readonly ContextPackEntryInput[];
	secrets?: readonly string[];
}): Promise<ContextPackResult> {
	if (
		options.entries.length === 0 ||
		options.entries.length > CONTEXT_PACK_MAX_ENTRIES
	)
		throw new LocalExecutionError(
			"INVALID_REQUEST",
			"context pack entry count is out of bounds",
		);
	const secrets = options.secrets ?? [];
	let totalBytes = 0;
	let binaryFiltered = 0;
	const manifest: ContextPackManifestEntry[] = [];
	const entries: ContextPackEntryInput[] = [];
	for (const entry of options.entries) {
		if (!isTextMime(entry.mimeType)) {
			binaryFiltered += 1;
			continue;
		}
		const content = redactText(entry.content, secrets);
		const bytes = Buffer.byteLength(content);
		if (bytes > CONTEXT_PACK_ENTRY_MAX_BYTES) continue;
		if (totalBytes + bytes > CONTEXT_PACK_TOTAL_MAX_BYTES) continue;
		totalBytes += bytes;
		manifest.push({ path: entry.path, mimeType: entry.mimeType, bytes });
		entries.push({ ...entry, content });
	}
	const id = randomUUID();
	const artifactRef = `artifact:${id}:context-pack`;
	const hash = `sha256:${createHash("sha256")
		.update(JSON.stringify({ taskId: options.taskId, nodeId: options.nodeId, manifest }))
		.digest("hex")}`;
	const artifactRoot = resolve(options.artifactRoot);
	await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
	await writeFile(
		join(artifactRoot, `${id}.context-pack.json`),
		JSON.stringify({ taskId: options.taskId, nodeId: options.nodeId, manifest, entries }),
		{ encoding: "utf8", mode: 0o600 },
	);
	return {
		artifactRef,
		hash,
		bytes: totalBytes,
		entries: entries.length,
		binaryFiltered,
		redacted: secrets.length > 0,
		manifest,
	};
}

export interface PatchProposalInput {
	// Bounded text diff/patch built against a base precondition snapshot.
	diff: string;
	baseHash: string;
	baseRef: string;
}

export interface PatchProposalResult {
	artifactRef: string;
	hash: string;
	bytes: number;
	baseHash: string;
	stale: boolean;
	precondition: { baseHash: string; baseRef: string };
}

export async function materializePatchProposal(options: {
	artifactRoot: string;
	taskId: string;
	nodeId: string;
	proposal: PatchProposalInput;
}): Promise<PatchProposalResult> {
	const bytes = Buffer.byteLength(options.proposal.diff);
	if (bytes === 0 || bytes > PATCH_PROPOSAL_MAX_BYTES)
		throw new LocalExecutionError(
			"INVALID_REQUEST",
			"patch proposal must be non-empty and within size bounds",
		);
	if (!options.proposal.baseHash)
		throw new LocalExecutionError(
			"PRECONDITION_FAILED",
			"patch proposal requires a base precondition snapshot hash",
		);
	const id = randomUUID();
	const artifactRef = `artifact:${id}:patch-proposal`;
	const hash = `sha256:${createHash("sha256")
		.update(options.proposal.diff)
		.digest("hex")}`;
	const artifactRoot = resolve(options.artifactRoot);
	await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
	await writeFile(join(artifactRoot, `${id}.patch-proposal.diff`), options.proposal.diff, {
		encoding: "utf8",
		mode: 0o600,
	});
	// A proposal is never auto-applied. Applying it is a separate Effect that
	// re-validates this precondition against the live snapshot (stale detection)
	// and produces its own Result/Evidence, never reusing this proposal as truth.
	return {
		artifactRef,
		hash,
		bytes,
		baseHash: options.proposal.baseHash,
		stale: false,
		precondition: {
			baseHash: options.proposal.baseHash,
			baseRef: options.proposal.baseRef,
		},
	};
}

export async function createLocalExecutor(options: LocalExecutorOptions) {
	const projectRoot = await realpath(resolve(options.projectRoot));
	const artifactRoot = resolve(options.artifactRoot);
	await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
	const exactNetworkTargets = new Set(options.exactNetworkTargets ?? []);
	const now = options.now ?? (() => new Date());
	const idFactory = options.idFactory ?? randomUUID;
	const assertScopedCommand = (
		command: string,
		args: readonly string[],
	): void => {
		assertSafeCommand(command, args);
		const bare = basename(command);
		const allowedBareCommands = new Set([
			"node",
			"pnpm",
			"npm",
			"git",
			"tsc",
			"biome",
		]);
		if (
			isAbsolute(command) &&
			resolve(command) !== resolve(process.execPath) &&
			!within(projectRoot, resolve(command))
		)
			throw new LocalExecutionError(
				"SCOPE_DENIED",
				"absolute executable is outside project scope",
			);
		if (!isAbsolute(command) && !allowedBareCommands.has(bare))
			throw new LocalExecutionError(
				"SCOPE_DENIED",
				"executable is outside the bounded engineering command set",
			);
		if (
			bare === "node" &&
			args.some((argument) =>
				["-e", "--eval", "-p", "--print"].includes(argument),
			)
		)
			throw new LocalExecutionError(
				"SCOPE_DENIED",
				"inline executable source cannot be scope-verified",
			);
		for (const argument of args) {
			const argumentPath = isAbsolute(argument)
				? resolve(argument)
				: resolve(projectRoot, argument);
			if (isAbsolute(argument) && !within(projectRoot, argumentPath))
				throw new LocalExecutionError(
					"SCOPE_DENIED",
					"absolute command argument escaped project scope",
				);
			if (
				argument === ".." ||
				argument.startsWith("../") ||
				argument.includes("/../")
			)
				throw new LocalExecutionError(
					"SCOPE_DENIED",
					"command argument traversed outside project scope",
				);
			if (within(projectRoot, argumentPath)) {
				const rel = relative(projectRoot, argumentPath);
				if (rel === ".proflow" || rel.startsWith(`.proflow${sep}`))
					throw new LocalExecutionError(
						"SCOPE_DENIED",
						"command argument entered protected .proflow state",
					);
			}
		}
	};
	const registryPath = join(artifactRoot, "managed-processes.json");
	const logPath = join(
		artifactRoot,
		"..",
		"..",
		"logs",
		"execution-local",
		"events.jsonl",
	);
	await mkdir(dirname(logPath), { recursive: true, mode: 0o700 });
	const managed = new Map<string, ManagedProcessRecord>();
	if (await fileExists(registryPath)) {
		const records: unknown = JSON.parse(await readFile(registryPath, "utf8"));
		if (Array.isArray(records)) {
			for (const record of records) {
				if (
					typeof record === "object" &&
					record !== null &&
					typeof Reflect.get(record, "processRef") === "string" &&
					typeof Reflect.get(record, "pid") === "number"
				) {
					managed.set(
						Reflect.get(record, "processRef"),
						record as ManagedProcessRecord,
					);
				}
			}
		}
	}

	const persistManaged = async () => {
		await writeFile(
			registryPath,
			`${JSON.stringify([...managed.values()], null, 2)}\n`,
			{ mode: 0o600 },
		);
	};
	const ownsManagedProcess = async (
		record: ManagedProcessRecord,
	): Promise<boolean> =>
		typeof record.processIdentity === "string" &&
		record.processIdentity.length > 0 &&
		(await processIdentity(record.pid)) === record.processIdentity;
	const log = async (
		request: ExecuteCapabilityRequest,
		event: string,
		code?: ExecutionErrorCode,
	) => {
		await appendFile(
			logPath,
			`${JSON.stringify({ timestamp: now().toISOString(), component: "execution-local", executionRef: request.executionRef, correlationId: request.correlationId, taskId: request.taskId, nodeId: request.nodeId, runNo: request.runNo, roleRef: request.roleRef, workerRef: request.workerRef, capability: request.capability, event, ...(code ? { errorCode: code } : {}) })}\n`,
			{ mode: 0o600 },
		);
	};

	const packageManagerLockPath = (manager: "pnpm" | "npm" | "yarn") =>
		manager === "pnpm"
			? join(projectRoot, "pnpm-lock.yaml")
			: manager === "yarn"
				? join(projectRoot, "yarn.lock")
				: join(projectRoot, "package-lock.json");

	const detectPackageManager = async (): Promise<"pnpm" | "npm" | "yarn"> => {
		if (await fileExists(join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
		if (await fileExists(join(projectRoot, "yarn.lock"))) return "yarn";
		if (await fileExists(join(projectRoot, "package-lock.json"))) return "npm";
		try {
			const manifest: unknown = JSON.parse(
				await readFile(join(projectRoot, "package.json"), "utf8"),
			);
			if (typeof manifest === "object" && manifest !== null) {
				const declared = Reflect.get(manifest, "packageManager");
				if (typeof declared === "string") {
					if (declared.startsWith("pnpm@")) return "pnpm";
					if (declared.startsWith("yarn@")) return "yarn";
					if (declared.startsWith("npm@")) return "npm";
				}
			}
		} catch {
			// Fall through to npm only when no durable manager signal exists.
		}
		return "npm";
	};

	const packageDeclaration = (
		manifest: unknown,
		packageName: string,
		dev: boolean,
	): string | undefined => {
		if (typeof manifest !== "object" || manifest === null) return undefined;
		const bucket = Reflect.get(
			manifest,
			dev ? "devDependencies" : "dependencies",
		);
		if (typeof bucket !== "object" || bucket === null) return undefined;
		const value = Reflect.get(bucket, packageName);
		return typeof value === "string" ? value : undefined;
	};

	const resolveManifestPackageName = async (
		packageName: string,
	): Promise<string | undefined> => {
		if (/^(?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+$/.test(packageName))
			return packageName;
		if (
			packageName === "." ||
			packageName.startsWith("./") ||
			packageName.startsWith("../")
		) {
			try {
				const dependencyRoot = await safePath(packageName);
				const metadata: unknown = JSON.parse(
					await readFile(join(dependencyRoot, "package.json"), "utf8"),
				);
				if (typeof metadata !== "object" || metadata === null) return undefined;
				const name = Reflect.get(metadata, "name");
				return typeof name === "string" && name.length > 0 ? name : undefined;
			} catch {
				return undefined;
			}
		}
		return undefined;
	};

	const resolveInstalledVersion = async (
		manifestPackageName: string | undefined,
	): Promise<string | undefined> => {
		if (
			!manifestPackageName ||
			!/^(?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+$/.test(manifestPackageName)
		)
			return undefined;
		try {
			const metadataPath = await safePath(
				`node_modules/${manifestPackageName}/package.json`,
			);
			const metadata: unknown = JSON.parse(
				await readFile(metadataPath, "utf8"),
			);
			if (typeof metadata !== "object" || metadata === null) return undefined;
			const version = Reflect.get(metadata, "version");
			return typeof version === "string" && version.length > 0
				? version
				: undefined;
		} catch {
			return undefined;
		}
	};

	const checkManagedReadiness = async (
		record: ManagedProcessRecord,
		readiness:
			| { kind: "port"; port: number }
			| { kind: "http"; url: string }
			| { kind: "log"; pattern: string }
			| undefined,
	): Promise<boolean> => {
		if (readiness === undefined) return true;
		if (readiness.kind === "log") {
			const content = (await fileExists(record.stdoutPath))
				? await readFile(record.stdoutPath, "utf8")
				: "";
			return content.includes(readiness.pattern);
		}
		const target =
			readiness.kind === "port"
				? new URL(`http://127.0.0.1:${readiness.port}`)
				: new URL(readiness.url);
		if (
			!["http:", "https:"].includes(target.protocol) ||
			(!isLanOrLocal(target.hostname) && !exactNetworkTargets.has(target.href))
		)
			return false;
		try {
			const response = await fetch(target, {
				signal: AbortSignal.timeout(500),
				redirect: "manual",
			});
			return response.status > 0 && response.status < 300;
		} catch {
			return false;
		}
	};

	async function safePath(
		input: string,
		allowMissing = false,
	): Promise<string> {
		if (isAbsolute(input))
			throw new LocalExecutionError(
				"SCOPE_DENIED",
				"absolute paths are outside project scope",
			);
		const lexical = resolve(projectRoot, input);
		if (!within(projectRoot, lexical))
			throw new LocalExecutionError(
				"SCOPE_DENIED",
				"path traversal escaped projectRoot",
			);
		const rel = relative(projectRoot, lexical);
		if (rel === ".proflow" || rel.startsWith(`.proflow${sep}`))
			throw new LocalExecutionError(
				"SCOPE_DENIED",
				".proflow is protected from ordinary capabilities",
			);
		if (!allowMissing || (await fileExists(lexical))) {
			const canonical = await realpath(lexical);
			if (!within(projectRoot, canonical))
				throw new LocalExecutionError(
					"SCOPE_DENIED",
					"symlink escaped projectRoot",
				);
			return canonical;
		}
		let ancestor = dirname(lexical);
		while (!(await fileExists(ancestor))) ancestor = dirname(ancestor);
		const canonicalAncestor = await realpath(ancestor);
		if (!within(projectRoot, canonicalAncestor))
			throw new LocalExecutionError(
				"SCOPE_DENIED",
				"symlink parent escaped projectRoot",
			);
		return lexical;
	}

	async function validateInvocation(
		invocation: LocalExecutorInvocation,
	): Promise<void> {
		if (invocation.signal?.aborted)
			throw new LocalExecutionError(
				"CANCELLED",
				"local execution was cancelled before validation",
			);
		if (!localCapabilities.has(invocation.request.capability))
			throw new LocalExecutionError(
				"EXECUTOR_UNAVAILABLE",
				"capability is not routed to execution-local",
			);
		if (invocation.admission.policy !== "ALLOW")
			throw new LocalExecutionError(
				"POLICY_DENIED",
				"local effect requires ALLOW admission",
			);
		if (
			invocation.admission.approval !== "NOT_REQUIRED" &&
			invocation.admission.approval !== "VALID"
		)
			throw new LocalExecutionError(
				"APPROVAL_INVALID",
				"approval is not valid",
			);
		if (
			invocation.request.projectRoot !== undefined &&
			(await realpath(resolve(invocation.request.projectRoot))) !== projectRoot
		)
			throw new LocalExecutionError(
				"SCOPE_DENIED",
				"request projectRoot differs from configured projectRoot",
			);
	}

	async function markEffect(
		invocation: LocalExecutorInvocation,
		precondition: LocalPrecondition,
	): Promise<void> {
		if (invocation.signal?.aborted)
			throw new LocalExecutionError(
				"CANCELLED",
				"local execution was cancelled before effect",
			);
		if (invocation.onEffectStarted === undefined)
			throw new LocalExecutionError(
				"PRECONDITION_FAILED",
				"durable effect boundary acknowledgement is required",
			);
		await invocation.onEffectStarted(precondition);
		if (invocation.signal?.aborted)
			throw new LocalExecutionError(
				"CANCELLED",
				"local execution was cancelled at the effect boundary",
			);
	}

	async function outputResult(
		capability:
			| "quality.test"
			| "quality.build"
			| "quality.lint"
			| "quality.typecheck"
			| "shell.run"
			| "project.installDependency",
		command: string,
		args: readonly string[],
		cwd: string,
		invocation: LocalExecutorInvocation,
		precondition: LocalPrecondition,
		envInput?: Readonly<Record<string, string>>,
		timeoutMs = 30_000,
		maxOutputBytes = 16_384,
	): Promise<LocalExecutionResult> {
		await markEffect(invocation, precondition);
		const environment = safeEnvironment(options.baseEnv ?? {}, envInput);
		const id = idFactory();
		const captured = await captureCommand({
			command,
			args,
			cwd,
			env: environment.env,
			secrets: environment.secrets,
			timeoutMs,
			maxOutputBytes,
			artifactRoot,
			id,
			...(invocation.signal ? { signal: invocation.signal } : {}),
		});
		const output = {
			exitCode: captured.exitCode,
			durationMs: captured.durationMs,
			stdoutSummary: captured.stdoutSummary,
			stderrSummary: captured.stderrSummary,
			stdoutRef: captured.stdout.ref,
			stderrRef: captured.stderr.ref,
		};
		const evidence: ExecutionEvidence[] = [
			{
				kind: "output",
				evidenceRef: `evidence:${id}:stdout`,
				stream: "stdout",
				artifactRef: captured.stdout.ref,
				bytes: captured.stdout.bytes,
			},
			{
				kind: "output",
				evidenceRef: `evidence:${id}:stderr`,
				stream: "stderr",
				artifactRef: captured.stderr.ref,
				bytes: captured.stderr.bytes,
			},
		];
		if (capability === "project.installDependency")
			throw new LocalExecutionError(
				"EXECUTION_FAILED",
				"project installation requires package metadata result handling",
			);
		return {
			result: { capability, data: output },
			evidence,
			artifacts: [captured.stdout, captured.stderr],
			precondition,
			effectApplied: true,
			successful: captured.exitCode === 0,
		} as LocalExecutionResult;
	}

	async function execute(
		invocation: LocalExecutorInvocation,
	): Promise<LocalExecutionResult> {
		await validateInvocation(invocation);
		const request = invocation.request;
		await log(request, "COMMAND_ACCEPTED");
		try {
			switch (request.capability) {
				case "file.read": {
					const path = await safePath(request.input.path);
					const content = await readFile(path, "utf8");
					const result = {
						capability: request.capability,
						data: {
							path: relative(projectRoot, path),
							content,
							bytes: Buffer.byteLength(content),
							hash: sha256(content),
						},
					} as ExecutionCapabilityResult;
					return {
						result,
						evidence: [
							{
								kind: "file",
								evidenceRef: `evidence:${idFactory()}:file`,
								path: relative(projectRoot, path),
								afterHash: sha256(content),
								bytes: Buffer.byteLength(content),
							},
						],
						artifacts: [],
						effectApplied: false,
						successful: true,
					};
				}
				case "file.write": {
					const path = await safePath(request.input.path, true);
					const before = (await fileExists(path))
						? await readFile(path, "utf8")
						: undefined;
					const beforeHash = before === undefined ? undefined : sha256(before);
					const afterHash = sha256(request.input.content);
					const precondition: LocalPrecondition = {
						kind: "file.write",
						capability: "file.write",
						path: relative(projectRoot, path),
						...(beforeHash ? { beforeHash } : {}),
						expectedAfterHash: afterHash,
					};
					await markEffect(invocation, precondition);
					if (request.input.createParents)
						await mkdir(dirname(path), { recursive: true });
					await writeFile(path, request.input.content, "utf8");
					const id = idFactory();
					const diffPath = join(artifactRoot, `${id}.file-change.json`);
					await writeFile(
						diffPath,
						`${JSON.stringify({ path: relative(projectRoot, path), beforeHash, afterHash })}\n`,
						{ mode: 0o600 },
					);
					const diffRef = `output:${id}:report`;
					const bytes = Buffer.byteLength(request.input.content);
					const evidence: ExecutionEvidence = {
						kind: "file",
						evidenceRef: `evidence:${id}:file`,
						path: relative(projectRoot, path),
						...(beforeHash ? { beforeHash } : {}),
						afterHash,
						bytes,
						diffRef,
					};
					return {
						result: {
							capability: request.capability,
							data: {
								path: relative(projectRoot, path),
								...(beforeHash ? { beforeHash } : {}),
								afterHash,
								bytes,
								diffRef,
							},
						},
						evidence: [evidence],
						artifacts: [
							{
								ref: diffRef,
								path: diffPath,
								bytes: (await stat(diffPath)).size,
								stream: "report",
							},
						],
						precondition,
						effectApplied: true,
						successful: true,
					};
				}
				case "file.searchText":
				case "code.findSymbol":
				case "code.findReferences": {
					const roots = request.input.paths?.length
						? await Promise.all(
								request.input.paths.map((path) => safePath(path)),
							)
						: [projectRoot];
					const query =
						request.capability === "file.searchText"
							? request.input.query
							: request.input.symbol;
					const limit = request.input.maxMatches ?? 1_000;
					const matches: Array<{ path: string; line: number; text: string }> =
						[];
					for (const root of roots) {
						const info = await stat(root);
						const files = info.isDirectory() ? await textFiles(root) : [root];
						for (const file of files) {
							let content: string;
							try {
								content = await readFile(file, "utf8");
							} catch {
								continue;
							}
							for (const [index, line] of content.split(/\r?\n/).entries()) {
								if (line.includes(query))
									matches.push({
										path: relative(projectRoot, file),
										line: index + 1,
										text: line,
									});
								if (matches.length >= limit) break;
							}
							if (matches.length >= limit) break;
						}
						if (matches.length >= limit) break;
					}
					return {
						result: {
							capability: request.capability,
							data: { matches, truncated: matches.length >= limit },
						} as ExecutionCapabilityResult,
						evidence: [],
						artifacts: [],
						effectApplied: false,
						successful: true,
					};
				}
				case "git.status": {
					const [branch, statusResult] = await Promise.all([
						simpleCommand("git", ["branch", "--show-current"], projectRoot),
						simpleCommand("git", ["status", "--short"], projectRoot),
					]);
					if (branch.code !== 0 || statusResult.code !== 0)
						throw new LocalExecutionError(
							"EXECUTION_FAILED",
							statusResult.stderr || branch.stderr,
						);
					const summary = statusResult.stdout;
					return {
						result: {
							capability: request.capability,
							data: {
								branch: branch.stdout.trim(),
								clean: summary.trim() === "",
								summary,
							},
						},
						evidence: [
							{
								kind: "git",
								evidenceRef: `evidence:${idFactory()}:git`,
								head: (
									await simpleCommand("git", ["rev-parse", "HEAD"], projectRoot)
								).stdout.trim(),
								summary,
							},
						],
						artifacts: [],
						effectApplied: false,
						successful: true,
					};
				}
				case "git.diff": {
					const args = [
						"diff",
						...(request.input.staged ? ["--cached"] : []),
						...(request.input.path ? ["--", request.input.path] : []),
					];
					const diff = await simpleCommand("git", args, projectRoot);
					if (diff.code !== 0)
						throw new LocalExecutionError("EXECUTION_FAILED", diff.stderr);
					const id = idFactory();
					const path = join(artifactRoot, `${id}.git.diff`);
					await writeFile(path, diff.stdout, { mode: 0o600 });
					return {
						result: {
							capability: request.capability,
							data: {
								summary: diff.stdout.slice(0, 16_384),
								diffRef: `output:${id}:report`,
							},
						},
						evidence: [],
						artifacts: [
							{
								ref: `output:${id}:report`,
								path,
								bytes: Buffer.byteLength(diff.stdout),
								stream: "report",
							},
						],
						effectApplied: false,
						successful: true,
					};
				}
				case "git.commit": {
					const head = await simpleCommand(
						"git",
						["rev-parse", "HEAD"],
						projectRoot,
					);
					if (head.code !== 0)
						throw new LocalExecutionError("PRECONDITION_FAILED", head.stderr);
					const precondition: LocalPrecondition = {
						kind: "git.commit",
						capability: "git.commit",
						beforeHead: head.stdout.trim(),
						beforeIndexHash: sha256(
							(
								await simpleCommand(
									"git",
									["diff", "--cached", "--binary"],
									projectRoot,
								)
							).stdout,
						),
						message: request.input.message,
						...(request.input.paths ? { paths: request.input.paths } : {}),
					};
					await markEffect(invocation, precondition);
					const stage = await simpleCommand(
						"git",
						["add", "--", ...(request.input.paths ?? ["."])],
						projectRoot,
					);
					if (stage.code !== 0)
						throw new LocalExecutionError("EXECUTION_FAILED", stage.stderr);
					const commit = await simpleCommand(
						"git",
						["commit", "-m", request.input.message],
						projectRoot,
					);
					if (commit.code !== 0)
						throw new LocalExecutionError("EXECUTION_FAILED", commit.stderr);
					const after = (
						await simpleCommand("git", ["rev-parse", "HEAD"], projectRoot)
					).stdout.trim();
					const evidence: ExecutionEvidence = {
						kind: "git",
						evidenceRef: `evidence:${idFactory()}:git`,
						commitSha: after,
						head: after,
					};
					return {
						result: {
							capability: request.capability,
							data: { commitSha: after, head: after },
						},
						evidence: [evidence],
						artifacts: [],
						precondition,
						effectApplied: true,
						successful: true,
					};
				}
				case "git.push": {
					const precondition: LocalPrecondition = {
						kind: "opaque",
						capability: request.capability,
					};
					await markEffect(invocation, precondition);
					const branch =
						request.input.branch ??
						(
							await simpleCommand(
								"git",
								["branch", "--show-current"],
								projectRoot,
							)
						).stdout.trim();
					const remote = request.input.remote ?? "origin";
					const pushed = await simpleCommand(
						"git",
						["push", remote, branch],
						projectRoot,
					);
					if (pushed.code !== 0)
						throw new LocalExecutionError("EXECUTION_FAILED", pushed.stderr);
					const head = (
						await simpleCommand("git", ["rev-parse", "HEAD"], projectRoot)
					).stdout.trim();
					return {
						result: {
							capability: request.capability,
							data: { remote, branch, head },
						},
						evidence: [
							{ kind: "git", evidenceRef: `evidence:${idFactory()}:git`, head },
						],
						artifacts: [],
						precondition,
						effectApplied: true,
						successful: true,
					};
				}
				case "project.info": {
					const packagePath = await safePath("package.json");
					const metadata: unknown = JSON.parse(
						await readFile(packagePath, "utf8"),
					);
					const object =
						typeof metadata === "object" && metadata !== null ? metadata : {};
					const scripts =
						typeof Reflect.get(object, "scripts") === "object" &&
						Reflect.get(object, "scripts") !== null
							? Object.keys(Reflect.get(object, "scripts"))
							: [];
					const dependencies = ["dependencies", "devDependencies"].flatMap(
						(key) =>
							typeof Reflect.get(object, key) === "object" &&
							Reflect.get(object, key) !== null
								? Object.keys(Reflect.get(object, key))
								: [],
					);
					const packageManager = await detectPackageManager();
					return {
						result: {
							capability: request.capability,
							data: { packageManager, scripts, dependencies },
						},
						evidence: [],
						artifacts: [],
						effectApplied: false,
						successful: true,
					};
				}
				case "project.installDependency": {
					const manager =
						request.input.packageManager ?? (await detectPackageManager());
					const requested = `${request.input.packageName}${request.input.version ? `@${request.input.version}` : ""}`;
					const beforeManifestBytes = await readFile(
						join(projectRoot, "package.json"),
					);
					const beforeManifestObject: unknown = JSON.parse(
						beforeManifestBytes.toString("utf8"),
					);
					const beforeManifest = sha256(beforeManifestBytes);
					const lockPath = packageManagerLockPath(manager);
					const beforeLock = (await fileExists(lockPath))
						? sha256(await readFile(lockPath))
						: undefined;
					const manifestPackageName = await resolveManifestPackageName(
						request.input.packageName,
					);
					const beforeDeclaration = manifestPackageName
						? packageDeclaration(
								beforeManifestObject,
								manifestPackageName,
								request.input.dev ?? false,
							)
						: undefined;
					const id = idFactory();
					const receiptFile = `${id}.install-receipt.json`;
					const precondition: LocalPrecondition = {
						kind: "install-dependency",
						capability: "project.installDependency",
						packageManager: manager,
						packageName: request.input.packageName,
						...(manifestPackageName ? { manifestPackageName } : {}),
						receiptFile,
						requested,
						dev: request.input.dev ?? false,
						beforeManifestHash: beforeManifest,
						...(beforeLock ? { beforeLockHash: beforeLock } : {}),
						...(beforeDeclaration ? { beforeDeclaration } : {}),
					};
					await markEffect(invocation, precondition);
					const environment = safeEnvironment(options.baseEnv ?? {}, undefined);
					const args =
						manager === "pnpm"
							? ["add", ...(request.input.dev ? ["-D"] : []), requested]
							: manager === "yarn"
								? ["add", ...(request.input.dev ? ["--dev"] : []), requested]
								: [
										"install",
										...(request.input.dev ? ["--save-dev"] : ["--save"]),
										requested,
									];
					const captured = await captureCommand({
						command: manager,
						args,
						cwd: projectRoot,
						env: environment.env,
						secrets: environment.secrets,
						timeoutMs: request.input.timeoutMs ?? 60_000,
						maxOutputBytes: request.input.maxOutputBytes ?? 16_384,
						artifactRoot,
						id,
						...(invocation.signal ? { signal: invocation.signal } : {}),
					});
					const afterManifest = sha256(
						await readFile(join(projectRoot, "package.json")),
					);
					const afterLock = (await fileExists(lockPath))
						? sha256(await readFile(lockPath))
						: undefined;
					const resolvedVersion =
						await resolveInstalledVersion(manifestPackageName);
					const output = {
						exitCode: captured.exitCode,
						durationMs: captured.durationMs,
						stdoutSummary: captured.stdoutSummary,
						stderrSummary: captured.stderrSummary,
						stdoutRef: captured.stdout.ref,
						stderrRef: captured.stderr.ref,
					};
					await writeFile(
						join(artifactRoot, receiptFile),
						`${JSON.stringify({
							contract: "proflow.install-receipt.v1",
							packageManager: manager,
							requested,
							...(resolvedVersion ? { resolvedVersion } : {}),
							manifestChanged: beforeManifest !== afterManifest,
							lockfileChanged: beforeLock !== afterLock,
							successful: captured.exitCode === 0,
							output,
						})}\n`,
						{ mode: 0o600 },
					);
					return {
						result: {
							capability: request.capability,
							data: {
								packageManager: manager,
								requested,
								...(resolvedVersion ? { resolvedVersion } : {}),
								manifestChanged: beforeManifest !== afterManifest,
								lockfileChanged: beforeLock !== afterLock,
								output,
							},
						},
						evidence: [
							{
								kind: "output",
								evidenceRef: `evidence:${id}:stdout`,
								stream: "stdout",
								artifactRef: captured.stdout.ref,
								bytes: captured.stdout.bytes,
							},
						],
						artifacts: [captured.stdout, captured.stderr],
						precondition,
						effectApplied: true,
						successful: captured.exitCode === 0,
					};
				}
				case "quality.test":
				case "quality.build":
				case "quality.lint":
				case "quality.typecheck": {
					const script =
						request.input.script ?? request.capability.split(".")[1] ?? "test";
					const manager = (await fileExists(
						join(projectRoot, "pnpm-lock.yaml"),
					))
						? "pnpm"
						: "npm";
					const args = ["run", script, ...(request.input.args ?? [])];
					const precondition: LocalPrecondition = {
						kind: "opaque",
						capability: request.capability,
					};
					return outputResult(
						request.capability,
						manager,
						args,
						request.input.cwd ? await safePath(request.input.cwd) : projectRoot,
						invocation,
						precondition,
						undefined,
						request.input.timeoutMs,
						request.input.maxOutputBytes,
					);
				}
				case "process.start": {
					assertScopedCommand(request.input.command, request.input.args);
					if (request.input.readiness?.kind === "http") {
						const readinessUrl = new URL(request.input.readiness.url);
						if (
							!["http:", "https:"].includes(readinessUrl.protocol) ||
							(!isLanOrLocal(readinessUrl.hostname) &&
								!exactNetworkTargets.has(readinessUrl.href))
						)
							throw new LocalExecutionError(
								"SCOPE_DENIED",
								"managed readiness target is outside deterministic engineering scope",
							);
					}
					const cwd = request.input.cwd
						? await safePath(request.input.cwd)
						: projectRoot;
					const environment = safeEnvironment(
						options.baseEnv ?? {},
						request.input.env,
					);
					const processRef = `process:${idFactory()}`;
					const precondition: LocalPrecondition = {
						kind: "process.start",
						capability: "process.start",
						processRef,
						mode: request.input.mode,
						...(request.input.readiness
							? { readiness: request.input.readiness }
							: {}),
					};
					await markEffect(invocation, precondition);
					if (request.input.mode === "one-shot") {
						const id = idFactory();
						const captured = await captureCommand({
							command: request.input.command,
							args: request.input.args,
							cwd,
							env: environment.env,
							secrets: environment.secrets,
							timeoutMs: request.input.timeoutMs ?? 30_000,
							maxOutputBytes: request.input.maxOutputBytes ?? 16_384,
							artifactRoot,
							id,
							...(invocation.signal ? { signal: invocation.signal } : {}),
						});
						const output = {
							exitCode: captured.exitCode,
							durationMs: captured.durationMs,
							stdoutSummary: captured.stdoutSummary,
							stderrSummary: captured.stderrSummary,
							stdoutRef: captured.stdout.ref,
							stderrRef: captured.stderr.ref,
						};
						return {
							result: {
								capability: request.capability,
								data: { mode: "one-shot", output },
							},
							evidence: [
								{
									kind: "process",
									evidenceRef: `evidence:${id}:process`,
									exitCode: captured.exitCode,
									stdoutRef: captured.stdout.ref,
									stderrRef: captured.stderr.ref,
								},
							],
							artifacts: [captured.stdout, captured.stderr],
							precondition,
							effectApplied: true,
							successful: captured.exitCode === 0,
						};
					}
					const id = idFactory();
					const stdoutPath = join(artifactRoot, `${id}.managed.stdout.log`);
					const stderrPath = join(artifactRoot, `${id}.managed.stderr.log`);
					const stdoutHandle = await open(stdoutPath, "w", 0o600);
					const stderrHandle = await open(stderrPath, "w", 0o600);
					// Managed output is redacted BEFORE it reaches disk, using the
					// same streaming redactor as one-shot/quality/shell/install.
					const managedSecrets = [
						...environment.secrets,
						...extractArgvSecrets(request.input.args),
					];
					const stdoutRedactor = createStreamingRedactor(managedSecrets);
					const stderrRedactor = createStreamingRedactor(managedSecrets);
					if (invocation.signal?.aborted)
						throw new LocalExecutionError(
							"CANCELLED",
							"managed process cancelled before spawn",
						);
					const child = spawn(request.input.command, [...request.input.args], {
						cwd,
						env: environment.env,
						detached: true,
						stdio: ["ignore", "pipe", "pipe"],
					});
					// A failed spawn (EAGAIN/EMFILE under process-table pressure)
					// surfaces asynchronously on "error"; capture it so we can fail
					// closed instead of leaking an unhandled "error" crash.
					let spawnError: Error | undefined;
					child.once("error", (err) => {
						spawnError = err;
					});
					let managedWriteChain = Promise.resolve();
					const writeRedacted = (handle: FileHandle, text: string) => {
						managedWriteChain = managedWriteChain
							.then(() => handle.write(text))
							.then(() => undefined);
					};
					child.stdout.on("data", (chunk: Buffer) => {
						const text = stdoutRedactor.push(chunk.toString("utf8"));
						if (text.length > 0) writeRedacted(stdoutHandle, text);
					});
					child.stderr.on("data", (chunk: Buffer) => {
						const text = stderrRedactor.push(chunk.toString("utf8"));
						if (text.length > 0) writeRedacted(stderrHandle, text);
					});
					// Flushing only after close is safe: no further chunks can
					// straddle a secret across the flush boundary.
					child.once("close", () => {
						const stdoutTail = stdoutRedactor.flush();
						const stderrTail = stderrRedactor.flush();
						if (stdoutTail.length > 0) writeRedacted(stdoutHandle, stdoutTail);
						if (stderrTail.length > 0) writeRedacted(stderrHandle, stderrTail);
						void managedWriteChain
							.then(() => stdoutHandle.close())
							.then(() => stderrHandle.close());
					});
					if (child.pid === undefined)
						throw new LocalExecutionError(
							"EXECUTION_FAILED",
							"managed process did not receive a pid",
						);
					await new Promise<void>((resolveWait) => setImmediate(resolveWait));
					if (spawnError !== undefined)
						throw new LocalExecutionError(
							"EXECUTION_FAILED",
							`managed process failed to spawn: ${spawnError.message}`,
						);
					const identity = await processIdentity(child.pid);
					if (!identity) {
						await killProcessTree(child.pid);
						throw new LocalExecutionError(
							"EXECUTION_FAILED",
							"managed process identity could not be established",
						);
					}
					child.unref();
					const record: ManagedProcessRecord = {
						processRef,
						pid: child.pid,
						stdoutRef: `output:${id}:stdout`,
						stderrRef: `output:${id}:stderr`,
						stdoutPath,
						stderrPath,
						startedAt: now().toISOString(),
						processIdentity: identity,
					};
					managed.set(processRef, record);
					await persistManaged();
					const deadline = Date.now() + (request.input.timeoutMs ?? 10_000);
					let ready = request.input.readiness === undefined;
					while (!ready && Date.now() < deadline) {
						if (request.input.readiness?.kind === "port") {
							try {
								const response = await fetch(
									`http://127.0.0.1:${request.input.readiness.port}`,
									{
										signal: AbortSignal.timeout(300),
										redirect: "manual",
									},
								);
								ready = response.status > 0 && response.status < 300;
							} catch {
								ready = false;
							}
						} else if (request.input.readiness?.kind === "http") {
							try {
								const response = await fetch(request.input.readiness.url, {
									signal: AbortSignal.timeout(300),
									redirect: "manual",
								});
								ready = response.status > 0 && response.status < 300;
							} catch {
								ready = false;
							}
						} else if (request.input.readiness?.kind === "log") {
							const onDisk = (await fileExists(stdoutPath))
								? await readFile(stdoutPath, "utf8")
								: "";
							ready = (onDisk + stdoutRedactor.peek()).includes(
								request.input.readiness.pattern,
							);
						}
						if (!ready)
							await new Promise((resolveWait) => setTimeout(resolveWait, 50));
					}
					if (!ready) {
						await killProcessTree(child.pid);
						managed.delete(processRef);
						await persistManaged();
						throw new LocalExecutionError(
							"TIMEOUT",
							"managed process readiness timed out",
						);
					}
					return {
						result: {
							capability: request.capability,
							data: {
								mode: "managed",
								processRef,
								pid: child.pid,
								ready,
								stdoutRef: record.stdoutRef,
								stderrRef: record.stderrRef,
							},
						},
						evidence: [
							{
								kind: "process",
								evidenceRef: `evidence:${id}:process`,
								processRef,
								pid: child.pid,
								stdoutRef: record.stdoutRef,
								stderrRef: record.stderrRef,
							},
						],
						artifacts: [
							{
								ref: record.stdoutRef,
								path: stdoutPath,
								bytes: (await stat(stdoutPath)).size,
								stream: "stdout",
							},
							{
								ref: record.stderrRef,
								path: stderrPath,
								bytes: (await stat(stderrPath)).size,
								stream: "stderr",
							},
						],
						precondition,
						effectApplied: true,
						successful: true,
					};
				}
				case "process.status": {
					const record = managed.get(request.input.processRef);
					if (!record)
						throw new LocalExecutionError(
							"SCOPE_DENIED",
							"processRef is not owned by this local executor",
						);
					let state: "RUNNING" | "STOPPED" = "RUNNING";
					if (!(await ownsManagedProcess(record))) state = "STOPPED";
					return {
						result: {
							capability: request.capability,
							data: {
								processRef: record.processRef,
								state,
								...(state === "RUNNING" ? { pid: record.pid } : {}),
							},
						},
						evidence: [],
						artifacts: [],
						effectApplied: false,
						successful: true,
					};
				}
				case "process.stop": {
					const record = managed.get(request.input.processRef);
					if (!record)
						throw new LocalExecutionError(
							"SCOPE_DENIED",
							"processRef is not owned by this local executor",
						);
					if (!(await ownsManagedProcess(record)))
						throw new LocalExecutionError(
							"SCOPE_DENIED",
							"process identity no longer matches the owned process",
						);
					const precondition: LocalPrecondition = {
						kind: "process.stop",
						capability: "process.stop",
						processRef: record.processRef,
						pid: record.pid,
						birthIdentity: record.processIdentity,
					};
					await markEffect(invocation, precondition);
					await killProcessTree(record.pid);
					managed.delete(record.processRef);
					await persistManaged();
					return {
						result: {
							capability: request.capability,
							data: { processRef: record.processRef, stopped: true },
						},
						evidence: [],
						artifacts: [],
						precondition,
						effectApplied: true,
						successful: true,
					};
				}
				case "network.request": {
					const url = new URL(request.input.url);
					const isScoped = (candidate: URL): boolean =>
						["http:", "https:"].includes(candidate.protocol) &&
						(isLanOrLocal(candidate.hostname) ||
							exactNetworkTargets.has(candidate.href));
					if (!isScoped(url))
						throw new LocalExecutionError(
							"SCOPE_DENIED",
							"network target is outside deterministic engineering scope",
						);
					const mutating = !["GET", "HEAD"].includes(request.input.method);
					const precondition: LocalPrecondition = {
						kind: "opaque",
						capability: request.capability,
					};
					if (mutating) await markEffect(invocation, precondition);
					const controller = new AbortController();
					const timeout = setTimeout(
						() => controller.abort(),
						request.input.timeoutMs ?? 15_000,
					);
					const abort = () => controller.abort();
					invocation.signal?.addEventListener("abort", abort, { once: true });
					// Request-side secrets enter the redaction set so a response
					// body that echoes them is scrubbed before it reaches disk.
					const requestSecrets = extractRequestSecrets(
						request.input.headers,
						request.input.body,
					);
					const originalOrigin = url.origin;
					// Sensitive headers are never forwarded across origins.
					const headersFor = (
						candidate: URL,
					): Record<string, string> | undefined => {
						if (request.input.headers === undefined) return undefined;
						if (candidate.origin === originalOrigin)
							return request.input.headers;
						const filtered = Object.fromEntries(
							Object.entries(request.input.headers).filter(
								([name]) => !sensitiveKey.test(name),
							),
						);
						return Object.keys(filtered).length > 0 ? filtered : undefined;
					};
					let response: Response;
					let currentUrl = url;
					const maxRedirects = 5;
					try {
						for (let hop = 0; ; hop++) {
							const hopHeaders = headersFor(currentUrl);
							const fetchInit: RequestInit = {
								method: request.input.method,
								redirect: "manual",
								signal: controller.signal,
								...(hopHeaders === undefined ? {} : { headers: hopHeaders }),
								...(request.input.body === undefined
									? {}
									: { body: request.input.body }),
							};
							response = await fetch(currentUrl, fetchInit);
							const location = response.headers.get("location");
							const isRedirect =
								response.status >= 300 &&
								response.status < 400 &&
								location !== null;
							if (!isRedirect) break;
							if (request.input.followRedirects !== true)
								throw new LocalExecutionError(
									"SCOPE_DENIED",
									"redirect requires a separately validated exact target",
								);
							if (hop >= maxRedirects)
								throw new LocalExecutionError(
									"SCOPE_DENIED",
									"redirect hop limit exceeded",
								);
							// Per-hop validation: each hop must independently stay
							// inside the deterministic engineering scope, else fail-closed.
							const next = new URL(location, currentUrl);
							if (!isScoped(next))
								throw new LocalExecutionError(
									"SCOPE_DENIED",
									"redirect target is outside deterministic engineering scope",
								);
							if (
								next.origin !== currentUrl.origin &&
								request.input.body !== undefined
							)
								throw new LocalExecutionError(
									"SCOPE_DENIED",
									"cross-origin redirect cannot forward a request body",
								);
							currentUrl = next;
						}
					} catch (error) {
						if (controller.signal.aborted)
							throw new LocalExecutionError(
								invocation.signal?.aborted ? "CANCELLED" : "TIMEOUT",
								"network request interrupted",
							);
						throw error;
					} finally {
						clearTimeout(timeout);
						invocation.signal?.removeEventListener("abort", abort);
					}
					// Stream the body to a redacted artifact and accumulate a
					// UTF-8 byte-bounded summary, redacting across chunk boundaries.
					const id = idFactory();
					const bodyPath = join(artifactRoot, `${id}.network.body`);
					const bodyHandle = await open(bodyPath, "w", 0o600);
					const bodyRedactor = createStreamingRedactor(requestSecrets);
					const bodySummary = createByteBoundedSummary(
						request.input.maxOutputBytes ?? 16_384,
					);
					let writtenBytes = 0;
					const writeRedactedBody = async (text: string) => {
						if (text.length === 0) return;
						bodySummary.push(text);
						await bodyHandle.write(text);
						writtenBytes += Buffer.byteLength(text);
					};
					if (response.body !== null) {
						const reader = response.body.getReader();
						while (true) {
							const { done, value } = await reader.read();
							if (done) break;
							await writeRedactedBody(
								bodyRedactor.push(Buffer.from(value).toString("utf8")),
							);
						}
					}
					await writeRedactedBody(bodyRedactor.flush());
					await bodyHandle.close();
					const headers = Object.fromEntries(
						[...response.headers.entries()].filter(
							([name]) => !sensitiveKey.test(name),
						),
					);
					const bodyRef = `output:${id}:report`;
					return {
						result: {
							capability: request.capability,
							data: {
								url: currentUrl.href,
								status: response.status,
								headers,
								bodySummary: bodySummary.value(),
								bodyRef,
							},
						},
						evidence: [
							{
								kind: "network",
								evidenceRef: `evidence:${id}:network`,
								url: currentUrl.href,
								status: response.status,
								bodyRef,
							},
						],
						artifacts: [
							{
								ref: bodyRef,
								path: bodyPath,
								bytes: writtenBytes,
								stream: "report",
							},
						],
						...(mutating
							? { precondition, effectApplied: true }
							: { effectApplied: false }),
						successful: response.ok,
					};
				}
				case "shell.run": {
					if (invocation.admission.decisionPath === "deterministic")
						throw new LocalExecutionError(
							"POLICY_DENIED",
							"shell escape hatch cannot use deterministic direct admission",
						);
					if (invocation.admission.approval !== "VALID")
						throw new LocalExecutionError(
							"APPROVAL_REQUIRED",
							"shell escape hatch requires a validated approval",
						);
					assertScopedCommand(request.input.command, request.input.args);
					const cwd = request.input.cwd
						? await safePath(request.input.cwd)
						: projectRoot;
					const precondition: LocalPrecondition = {
						kind: "opaque",
						capability: request.capability,
					};
					return outputResult(
						request.capability,
						request.input.command,
						request.input.args,
						cwd,
						invocation,
						precondition,
						request.input.env,
						request.input.timeoutMs,
						request.input.maxOutputBytes,
					);
				}
			}
			throw new LocalExecutionError(
				"EXECUTOR_UNAVAILABLE",
				"capability is not routed to execution-local",
			);
		} catch (error) {
			const code =
				error instanceof LocalExecutionError ? error.code : "EXECUTION_FAILED";
			await log(request, "FAILED", code);
			throw error;
		}
	}

	async function reconcile(
		request: ExecuteCapabilityRequest,
		precondition: LocalPrecondition,
	): Promise<LocalReconciliation> {
		if (
			precondition.kind === "file.write" &&
			request.capability === "file.write"
		) {
			const path = await safePath(precondition.path, true);
			if (!(await fileExists(path)))
				return { state: "NOT_APPLIED", evidence: [] };
			const content = await readFile(path);
			const current = sha256(content);
			const evidence: ExecutionEvidence = {
				kind: "file",
				evidenceRef: `evidence:${idFactory()}:reconcile`,
				path: precondition.path,
				...(precondition.beforeHash
					? { beforeHash: precondition.beforeHash }
					: {}),
				afterHash: current,
				bytes: content.byteLength,
			};
			if (current === precondition.expectedAfterHash)
				return {
					state: "APPLIED",
					evidence: [evidence],
					result: {
						capability: "file.write",
						data: {
							path: precondition.path,
							...(precondition.beforeHash
								? { beforeHash: precondition.beforeHash }
								: {}),
							afterHash: current,
							bytes: content.byteLength,
						},
					},
				};
			if (
				precondition.beforeHash !== undefined &&
				current === precondition.beforeHash
			)
				return { state: "NOT_APPLIED", evidence: [evidence] };
			return { state: "UNKNOWN", evidence: [evidence] };
		}
		if (
			precondition.kind === "git.commit" &&
			request.capability === "git.commit"
		) {
			const head = (
				await simpleCommand("git", ["rev-parse", "HEAD"], projectRoot)
			).stdout.trim();
			const evidence: ExecutionEvidence = {
				kind: "git",
				evidenceRef: `evidence:${idFactory()}:reconcile`,
				head,
				...(head !== precondition.beforeHead ? { commitSha: head } : {}),
			};
			if (head === precondition.beforeHead)
				return sha256(
					(
						await simpleCommand(
							"git",
							["diff", "--cached", "--binary"],
							projectRoot,
						)
					).stdout,
				) === precondition.beforeIndexHash
					? { state: "NOT_APPLIED", evidence: [evidence] }
					: { state: "UNKNOWN", evidence: [evidence] };
			const message = (
				await simpleCommand(
					"git",
					["show", "-s", "--format=%B", head],
					projectRoot,
				)
			).stdout.trim();
			return message === precondition.message
				? {
						state: "APPLIED",
						evidence: [evidence],
						result: {
							capability: "git.commit",
							data: { commitSha: head, head },
						},
					}
				: { state: "UNKNOWN", evidence: [evidence] };
		}
		if (
			precondition.kind === "install-dependency" &&
			request.capability === "project.installDependency"
		) {
			const lockPath = packageManagerLockPath(precondition.packageManager);
			const manifest = await readFile(join(projectRoot, "package.json"));
			const manifestHash = sha256(manifest);
			const manifestObject: unknown = JSON.parse(manifest.toString("utf8"));
			const lockExists = await fileExists(lockPath);
			const lockHash = lockExists
				? sha256(await readFile(lockPath))
				: undefined;
			const currentDeclaration = precondition.manifestPackageName
				? packageDeclaration(
						manifestObject,
						precondition.manifestPackageName,
						precondition.dev,
					)
				: undefined;
			const manifestChanged = manifestHash !== precondition.beforeManifestHash;
			const lockfileChanged =
				precondition.beforeLockHash !== undefined
					? lockHash !== precondition.beforeLockHash
					: lockExists;
			const evidence: ExecutionEvidence = {
				kind: "file",
				evidenceRef: `evidence:${idFactory()}:reconcile`,
				path: "package.json",
				beforeHash: precondition.beforeManifestHash,
				afterHash: manifestHash,
				bytes: manifest.byteLength,
			};
			if (basename(precondition.receiptFile) === precondition.receiptFile) {
				const receiptPath = join(artifactRoot, precondition.receiptFile);
				if (await fileExists(receiptPath)) {
					try {
						const receipt: unknown = JSON.parse(
							await readFile(receiptPath, "utf8"),
						);
						if (typeof receipt === "object" && receipt !== null) {
							const output = Reflect.get(receipt, "output");
							if (
								Reflect.get(receipt, "contract") ===
									"proflow.install-receipt.v1" &&
								Reflect.get(receipt, "packageManager") ===
									precondition.packageManager &&
								Reflect.get(receipt, "requested") === precondition.requested &&
								Reflect.get(receipt, "successful") === true &&
								typeof output === "object" &&
								output !== null &&
								typeof Reflect.get(output, "exitCode") === "number" &&
								typeof Reflect.get(output, "durationMs") === "number" &&
								typeof Reflect.get(output, "stdoutSummary") === "string" &&
								typeof Reflect.get(output, "stderrSummary") === "string" &&
								typeof Reflect.get(output, "stdoutRef") === "string" &&
								typeof Reflect.get(output, "stderrRef") === "string"
							)
								return {
									state: "APPLIED",
									evidence: [evidence],
									result: {
										capability: "project.installDependency",
										data: {
											packageManager: precondition.packageManager,
											requested: precondition.requested,
											...(typeof Reflect.get(receipt, "resolvedVersion") ===
											"string"
												? {
														resolvedVersion: Reflect.get(
															receipt,
															"resolvedVersion",
														) as string,
													}
												: {}),
											manifestChanged:
												Reflect.get(receipt, "manifestChanged") === true,
											lockfileChanged:
												Reflect.get(receipt, "lockfileChanged") === true,
											output: output as {
												exitCode: number;
												durationMs: number;
												stdoutSummary: string;
												stderrSummary: string;
												stdoutRef: string;
												stderrRef: string;
											},
										},
									},
								};
						}
					} catch {
						// Corrupt/incomplete receipt cannot authorize recovered success.
					}
				}
			}
			if (
				!manifestChanged &&
				!lockfileChanged &&
				currentDeclaration === precondition.beforeDeclaration
			)
				return { state: "UNKNOWN", evidence: [evidence] };

			// A changed declaration for the exact requested package is strong reality
			// evidence that the install applied. Do not fabricate exitCode/duration or
			// synthetic output refs after a crash: Runtime will keep the execution
			// UNKNOWN until a trustworthy Result can be reconstructed.
			if (
				currentDeclaration !== undefined &&
				currentDeclaration !== precondition.beforeDeclaration &&
				(manifestChanged || lockfileChanged)
			)
				return { state: "APPLIED", evidence: [evidence] };

			return { state: "UNKNOWN", evidence: [evidence] };
		}

		if (precondition.kind === "process.start") {
			if (precondition.mode === "one-shot")
				return { state: "UNKNOWN", evidence: [] };
			const record = managed.get(precondition.processRef);
			// EFFECT_STARTED already fired, so a missing registry entry cannot
			// prove the process was never spawned — never claim NOT_APPLIED.
			if (!record) return { state: "UNKNOWN", evidence: [] };
			try {
				if (!(await ownsManagedProcess(record)))
					return { state: "UNKNOWN", evidence: [] };
				if (!(await checkManagedReadiness(record, precondition.readiness)))
					return { state: "UNKNOWN", evidence: [] };
				return {
					state: "APPLIED",
					evidence: [
						{
							kind: "process",
							evidenceRef: `evidence:${idFactory()}:reconcile`,
							processRef: record.processRef,
							pid: record.pid,
						},
					],
					result: {
						capability: "process.start",
						data: {
							mode: "managed",
							processRef: record.processRef,
							pid: record.pid,
							ready: true,
							stdoutRef: record.stdoutRef,
							stderrRef: record.stderrRef,
						},
					},
				};
			} catch {
				return { state: "UNKNOWN", evidence: [] };
			}
		}
		if (
			precondition.kind === "process.stop" &&
			request.capability === "process.stop"
		) {
			const record = managed.get(precondition.processRef);
			if (!record)
				return {
					state: "APPLIED",
					evidence: [],
					result: {
						capability: "process.stop",
						data: { processRef: precondition.processRef, stopped: true },
					},
				};
			try {
				if (await ownsManagedProcess(record))
					return { state: "NOT_APPLIED", evidence: [] };
			} catch {
				return { state: "UNKNOWN", evidence: [] };
			}
			return {
				state: "APPLIED",
				evidence: [
					{
						kind: "process",
						evidenceRef: `evidence:${idFactory()}:reconcile`,
						processRef: record.processRef,
						pid: record.pid,
					},
				],
				result: {
					capability: "process.stop",
					data: { processRef: record.processRef, stopped: true },
				},
			};
		}
		return { state: "UNKNOWN", evidence: [] };
	}

	async function readArtifact(
		ref: string,
		offset = 0,
		limit = 16_384,
	): Promise<{
		chunk: string;
		nextOffset: number;
		eof: boolean;
		bytes: number;
	}> {
		const entries = await readdir(artifactRoot);
		const id = ref.split(":")[1];
		const stream = ref.split(":")[2];
		const file = entries.find(
			(entry) =>
				entry.startsWith(`${id}.`) &&
				(stream === "stdout"
					? entry.includes("stdout")
					: stream === "stderr"
						? entry.includes("stderr")
						: true),
		);
		if (!file)
			throw new LocalExecutionError(
				"EXECUTION_FAILED",
				"output artifact not found",
			);
		const content = await readFile(join(artifactRoot, file));
		const chunkBuffer = content.subarray(offset, offset + limit);
		const chunk = chunkBuffer.toString("utf8");
		return {
			chunk,
			nextOffset: offset + chunkBuffer.byteLength,
			eof: offset + chunkBuffer.byteLength >= content.byteLength,
			bytes: content.byteLength,
		};
	}

	return Object.freeze({
		projectRoot,
		artifactRoot,
		execute,
		reconcile,
		readArtifact,
		logPath,
	});
}
