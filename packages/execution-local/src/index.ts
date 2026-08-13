import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	access,
	appendFile,
	mkdir,
	open,
	readdir,
	readFile,
	realpath,
	stat,
	writeFile,
} from "node:fs/promises";
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
			path: string;
			beforeHash?: string;
			expectedAfterHash: string;
	  }
	| {
			kind: "git.commit";
			beforeHead: string;
			beforeIndexHash: string;
			message: string;
	  }
	| {
			kind: "process.start";
			processRef: string;
			mode: "one-shot" | "managed";
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
	command: string;
	args: string[];
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
			/((?:authorization|api[_-]?key|token|password|cookie|secret)\s*[:=]\s*)[^\s,;]+/gi,
			"$1[REDACTED]",
		);
	for (const secret of secrets) {
		if (secret.length > 0) redacted = redacted.split(secret).join("[REDACTED]");
	}
	return redacted;
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
	let stdoutSummary = "";
	let stderrSummary = "";
	let writeChain = Promise.resolve();
	const capture = (stream: "stdout" | "stderr", chunk: Buffer) => {
		const text = redactText(chunk.toString("utf8"), input.secrets);
		const bytes = Buffer.byteLength(text);
		if (stream === "stdout") {
			stdoutBytes += bytes;
			if (Buffer.byteLength(stdoutSummary) < input.maxOutputBytes)
				stdoutSummary += text;
			writeChain = writeChain
				.then(() => stdoutHandle.write(text))
				.then(() => undefined);
		} else {
			stderrBytes += bytes;
			if (Buffer.byteLength(stderrSummary) < input.maxOutputBytes)
				stderrSummary += text;
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
		stdoutSummary: stdoutSummary.slice(0, input.maxOutputBytes),
		stderrSummary: stderrSummary.slice(0, input.maxOutputBytes),
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
	const observed = await simpleCommand(
		"ps",
		["-p", String(pid), "-o", "lstart=", "-o", "command="],
		process.cwd(),
	);
	const identity = observed.stdout.trim();
	return observed.code === 0 && identity.length > 0 ? identity : undefined;
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
		if (invocation.onEffectStarted === undefined)
			throw new LocalExecutionError(
				"PRECONDITION_FAILED",
				"durable effect boundary acknowledgement is required",
			);
		await invocation.onEffectStarted(precondition);
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
					const packageManager = (await fileExists(
						join(projectRoot, "pnpm-lock.yaml"),
					))
						? "pnpm"
						: (await fileExists(join(projectRoot, "yarn.lock")))
							? "yarn"
							: "npm";
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
						request.input.packageManager ??
						((await fileExists(join(projectRoot, "pnpm-lock.yaml")))
							? "pnpm"
							: "npm");
					const requested = `${request.input.packageName}${request.input.version ? `@${request.input.version}` : ""}`;
					const beforeManifest = sha256(
						await readFile(join(projectRoot, "package.json")),
					);
					const lockPath =
						manager === "pnpm"
							? join(projectRoot, "pnpm-lock.yaml")
							: join(projectRoot, "package-lock.json");
					const beforeLock = (await fileExists(lockPath))
						? sha256(await readFile(lockPath))
						: undefined;
					const precondition: LocalPrecondition = {
						kind: "opaque",
						capability: request.capability,
					};
					await markEffect(invocation, precondition);
					const environment = safeEnvironment(options.baseEnv ?? {}, undefined);
					const id = idFactory();
					const args =
						manager === "pnpm"
							? ["add", ...(request.input.dev ? ["-D"] : []), requested]
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
							data: {
								packageManager: manager,
								requested,
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
						processRef,
						mode: request.input.mode,
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
					const child = spawn(request.input.command, [...request.input.args], {
						cwd,
						env: environment.env,
						detached: true,
						stdio: ["ignore", stdoutHandle.fd, stderrHandle.fd],
					});
					await stdoutHandle.close();
					await stderrHandle.close();
					if (child.pid === undefined)
						throw new LocalExecutionError(
							"EXECUTION_FAILED",
							"managed process did not receive a pid",
						);
					await new Promise<void>((resolveWait) => setImmediate(resolveWait));
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
						command: request.input.command,
						args: [...request.input.args],
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
									{ signal: AbortSignal.timeout(300) },
								);
								ready = response.status > 0;
							} catch {
								ready = false;
							}
						} else if (request.input.readiness?.kind === "http") {
							try {
								const response = await fetch(request.input.readiness.url, {
									signal: AbortSignal.timeout(300),
								});
								ready = response.status > 0;
							} catch {
								ready = false;
							}
						} else if (request.input.readiness?.kind === "log") {
							ready = (await readFile(stdoutPath, "utf8")).includes(
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
						kind: "opaque",
						capability: request.capability,
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
					if (
						!["http:", "https:"].includes(url.protocol) ||
						(!isLanOrLocal(url.hostname) && !exactNetworkTargets.has(url.href))
					)
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
					let response: Response;
					const fetchInit: RequestInit = {
						method: request.input.method,
						redirect: "manual",
						signal: controller.signal,
						...(request.input.headers === undefined
							? {}
							: { headers: request.input.headers }),
						...(request.input.body === undefined
							? {}
							: { body: request.input.body }),
					};
					try {
						response = await fetch(url, fetchInit);
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
					if (
						response.status >= 300 &&
						response.status < 400 &&
						response.headers.get("location")
					)
						throw new LocalExecutionError(
							"SCOPE_DENIED",
							"redirect requires a separately validated exact target",
						);
					const body = await response.text();
					const id = idFactory();
					const bodyPath = join(artifactRoot, `${id}.network.body`);
					await writeFile(bodyPath, redactText(body, []), { mode: 0o600 });
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
								url: url.href,
								status: response.status,
								headers,
								bodySummary: body.slice(
									0,
									request.input.maxOutputBytes ?? 16_384,
								),
								bodyRef,
							},
						},
						evidence: [
							{
								kind: "network",
								evidenceRef: `evidence:${id}:network`,
								url: url.href,
								status: response.status,
								bodyRef,
							},
						],
						artifacts: [
							{
								ref: bodyRef,
								path: bodyPath,
								bytes: Buffer.byteLength(body),
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
				return { state: "APPLIED", evidence: [evidence] };
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
				? { state: "APPLIED", evidence: [evidence] }
				: { state: "UNKNOWN", evidence: [evidence] };
		}
		if (precondition.kind === "process.start") {
			if (precondition.mode === "one-shot")
				return { state: "UNKNOWN", evidence: [] };
			const record = managed.get(precondition.processRef);
			if (!record) return { state: "NOT_APPLIED", evidence: [] };
			try {
				if (!(await ownsManagedProcess(record)))
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
				};
			} catch {
				return { state: "NOT_APPLIED", evidence: [] };
			}
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
