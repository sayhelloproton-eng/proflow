import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
	appendFile,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
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
import type { CodeGraph as CodeGraphInstance } from "@colbymchenry/codegraph";
import codeGraphSdkDefault from "@colbymchenry/codegraph";
import { runDefaultAction } from "repomix";

type CodeGraphClass = {
	open(
		projectRoot: string,
		options?: { sync?: boolean; readOnly?: boolean },
	): Promise<CodeGraphInstance>;
};
const codeGraphSdk = codeGraphSdkDefault as unknown as {
	CodeGraph: CodeGraphClass;
	findNearestCodeGraphRoot(path: string): string | null;
};
const { CodeGraph, findNearestCodeGraphRoot } = codeGraphSdk;

export const directToolNames = ["localDev", "repomix", "codeGraph"] as const;
export type DirectToolName = (typeof directToolNames)[number];

export type DirectToolRequest = {
	authenticatedRoleRef: string;
	tool: DirectToolName;
	operation: string;
	input: unknown;
	deadlineAt: string;
};

export type DirectToolPreparation = {
	notices: string[];
};

export type DirectToolExecutorOptions = {
	workspaceRoot: string;
	generation: string;
	stateRoot?: string;
	now?: () => Date;
	idFactory?: () => string;
};

type ManagedProcess = {
	processRef: string;
	roleRef: string;
	generation: string;
	pid: number;
	child: ChildProcessWithoutNullStreams;
	cwd: string;
	command: string;
	args: string[];
	stdoutPath: string;
	stderrPath: string;
	startedAt: string;
	exitCode: number | null;
	exitedAt?: string;
};

type RepomixOutput = {
	outputId: string;
	roleRef: string;
	generation: string;
	path: string;
	sourceDirectory: string;
	createdAt: number;
	expiresAt: number;
	totalFiles: number;
	totalCharacters: number;
	totalTokens: number;
};

const REPOMIX_OUTPUT_TTL_MS = 30 * 60_000;
const REPOMIX_MAX_OUTPUTS = 16;
const REPOMIX_MAX_PACK_BYTES = 20_000_000;
const TOOL_TEXT_RESULT_MAX_BYTES = 200_000;

export class DirectToolError extends Error {
	readonly code:
		| "TOOL_INPUT_INVALID"
		| "TOOL_PROVIDER_UNAVAILABLE"
		| "TOOL_SCOPE_DENIED"
		| "TOOL_HANDLE_INVALID"
		| "TOOL_TIMEOUT"
		| "TOOL_EXECUTION_FAILED";

	constructor(code: DirectToolError["code"], message: string) {
		super(message);
		this.name = "DirectToolError";
		this.code = code;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inputObject(value: unknown): Record<string, unknown> {
	if (!isRecord(value))
		throw new DirectToolError(
			"TOOL_INPUT_INVALID",
			"tool input must be an object",
		);
	return value;
}

function stringValue(
	value: unknown,
	name: string,
	optional = false,
): string | undefined {
	if (value === undefined && optional) return undefined;
	if (typeof value !== "string" || value.length === 0)
		throw new DirectToolError(
			"TOOL_INPUT_INVALID",
			`${name} must be a non-empty string`,
		);
	return value;
}

function integerValue(
	value: unknown,
	name: string,
	fallback: number,
	min: number,
	max: number,
): number {
	if (value === undefined) return fallback;
	if (!Number.isInteger(value) || Number(value) < min || Number(value) > max)
		throw new DirectToolError(
			"TOOL_INPUT_INVALID",
			`${name} must be an integer between ${min} and ${max}`,
		);
	return Number(value);
}

function stringArray(value: unknown, name: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
		throw new DirectToolError(
			"TOOL_INPUT_INVALID",
			`${name} must be a string array`,
		);
	return [...value];
}

function envObject(value: unknown): Record<string, string> {
	if (value === undefined) return {};
	if (!isRecord(value))
		throw new DirectToolError("TOOL_INPUT_INVALID", "env must be an object");
	const output: Record<string, string> = {};
	for (const [key, item] of Object.entries(value)) {
		if (typeof item !== "string")
			throw new DirectToolError(
				"TOOL_INPUT_INVALID",
				`env.${key} must be a string`,
			);
		if (/^(?:NODE_OPTIONS|BASH_ENV|ENV|LD_PRELOAD|DYLD_|GIT_CONFIG)/i.test(key))
			throw new DirectToolError(
				"TOOL_SCOPE_DENIED",
				`environment override ${key} is not allowed`,
			);
		output[key] = item;
	}
	return output;
}

function within(root: string, target: string): boolean {
	const rel = relative(root, target);
	return (
		rel === "" ||
		(!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
	);
}

function lexicalPath(workspaceRoot: string, value: string): string {
	return resolve(workspaceRoot, value);
}

function outsideNotice(
	workspaceRoot: string,
	path: string,
): string | undefined {
	const absolute = lexicalPath(workspaceRoot, path);
	return within(workspaceRoot, absolute)
		? undefined
		: `Workspace notice: Local Dev will operate outside the default Workspace: ${absolute}`;
}

function unique(values: Array<string | undefined>): string[] {
	return [
		...new Set(
			values.filter((item): item is string => typeof item === "string"),
		),
	];
}

function explicitPaths(request: DirectToolRequest): string[] {
	if (request.tool !== "localDev") return [];
	const input = inputObject(request.input);
	if (request.operation === "read")
		return stringValue(input.path, "path", true)
			? [String(input.path)]
			: stringArray(input.paths, "paths");
	if (request.operation === "list")
		return [String(stringValue(input.path, "path", true) ?? ".")];
	if (request.operation === "search") {
		const paths = stringArray(input.paths, "paths");
		const path = stringValue(input.path, "path", true);
		return path ? [path, ...paths] : paths;
	}
	if (request.operation === "mutate") {
		const action = stringValue(input.action, "action");
		if (action === "move")
			return [
				String(stringValue(input.source, "source")),
				String(stringValue(input.destination, "destination")),
			];
		return [String(stringValue(input.path, "path"))];
	}
	if (request.operation === "run") {
		const cwd = stringValue(input.cwd, "cwd", true);
		return cwd ? [cwd] : [];
	}
	if (request.operation === "process") {
		if (input.action === "start") {
			const cwd = stringValue(input.cwd, "cwd", true);
			return cwd ? [cwd] : [];
		}
	}
	return [];
}

function boundedText(value: string, maxBytes: number) {
	const buffer = Buffer.from(value);
	if (buffer.byteLength <= maxBytes) return { text: value, truncated: false };
	return {
		text: buffer.subarray(0, maxBytes).toString("utf8"),
		truncated: true,
	};
}

async function existingRealPath(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch {
		return path;
	}
}

function protectedPath(workspaceRoot: string, absolute: string): boolean {
	const rel = relative(workspaceRoot, absolute).split(sep).join("/");
	return (
		rel === ".proflow/secrets" ||
		rel.startsWith(".proflow/secrets/") ||
		/(^|\/)\.proflow\/runtime\/modules\/[^/]+\/secrets(\/|$)/.test(rel)
	);
}

async function resolveFilePath(
	workspaceRoot: string,
	value: string,
	options: { allowMissing?: boolean; allowProtected?: boolean } = {},
): Promise<string> {
	const lexical = lexicalPath(workspaceRoot, value);
	const actual = options.allowMissing
		? await existingRealPath(dirname(lexical)).then((parent) =>
				join(parent, basename(lexical)),
			)
		: await existingRealPath(lexical);
	if (!options.allowProtected && protectedPath(workspaceRoot, actual))
		throw new DirectToolError(
			"TOOL_SCOPE_DENIED",
			"direct file operations cannot access ProFlow credential storage",
		);
	return actual;
}

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

function assertSafeCommand(command: string, args: readonly string[]): void {
	const name = basename(command).toLowerCase();
	if (dangerousCommands.has(name))
		throw new DirectToolError(
			"TOOL_SCOPE_DENIED",
			`system/elevation command is outside Direct Tool scope: ${name}`,
		);
	if (
		["sh", "bash", "zsh", "fish"].includes(name) &&
		args.some((arg) => arg === "-c" || arg === "-lc")
	)
		throw new DirectToolError(
			"TOOL_SCOPE_DENIED",
			"nested command-string shells are not accepted by Local Dev run/process",
		);
	const joined = [command, ...args].join(" ");
	if (/[|;&`]|\$\(|\r|\n/.test(command))
		throw new DirectToolError(
			"TOOL_SCOPE_DENIED",
			"complex shell syntax is not accepted as an executable name",
		);
	if (
		/\brm\s+(?:-[A-Za-z]*r[A-Za-z]*f|-rf|-fr)\s+(?:\/|~|\$HOME)\b/.test(joined)
	)
		throw new DirectToolError(
			"TOOL_SCOPE_DENIED",
			"system-wide destructive command is outside Direct Tool scope",
		);
}

function safeEnvironment(extra: Record<string, string>): NodeJS.ProcessEnv {
	const inherited = { ...process.env };
	for (const key of Object.keys(inherited))
		if (
			/^(?:OPENAI|ANTHROPIC|API[_-]?KEY|TOKEN|PASSWORD|COOKIE|PRIVATE[_-]?KEY|SECRET)/i.test(
				key,
			)
		)
			delete inherited[key];
	return { ...inherited, ...extra };
}

function deadlineRemaining(
	request: DirectToolRequest,
	now: () => Date,
): number {
	const remaining = Date.parse(request.deadlineAt) - now().getTime();
	if (!Number.isFinite(remaining) || remaining <= 0)
		throw new DirectToolError(
			"TOOL_TIMEOUT",
			"tool request deadline has expired",
		);
	return remaining;
}

async function spawnCaptured(input: {
	command: string;
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	timeoutMs: number;
	maxOutputBytes: number;
}): Promise<{
	exitCode: number;
	stdout: string;
	stderr: string;
	durationMs: number;
	truncated: boolean;
}> {
	const started = performance.now();
	const child = spawn(input.command, input.args, {
		cwd: input.cwd,
		env: input.env,
		stdio: ["ignore", "pipe", "pipe"],
		shell: false,
	});
	let stdout = "";
	let stderr = "";
	let truncated = false;
	const append = (current: string, chunk: Buffer) => {
		const remaining = input.maxOutputBytes - Buffer.byteLength(current);
		if (remaining <= 0) {
			truncated = true;
			return current;
		}
		if (chunk.byteLength > remaining) truncated = true;
		return current + chunk.subarray(0, Math.max(0, remaining)).toString("utf8");
	};
	child.stdout.on("data", (chunk: Buffer) => {
		stdout = append(stdout, chunk);
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr = append(stderr, chunk);
	});
	let timer: ReturnType<typeof setTimeout> | undefined;
	const result = await new Promise<number>((resolvePromise, rejectPromise) => {
		timer = setTimeout(() => {
			child.kill("SIGTERM");
			setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
			rejectPromise(new DirectToolError("TOOL_TIMEOUT", "command timed out"));
		}, input.timeoutMs);
		child.once("error", rejectPromise);
		child.once("close", (code) => resolvePromise(code ?? 1));
	});
	if (timer) clearTimeout(timer);
	return {
		exitCode: result,
		stdout,
		stderr,
		durationMs: Math.round(performance.now() - started),
		truncated,
	};
}

async function resolveProviderDirectory(
	workspaceRoot: string,
	value: string,
): Promise<string> {
	const lexical = resolve(workspaceRoot, value);
	if (!within(workspaceRoot, lexical))
		throw new DirectToolError(
			"TOOL_SCOPE_DENIED",
			"repository providers cannot escape the server-bound Workspace",
		);
	let actual: string;
	try {
		actual = await realpath(lexical);
	} catch {
		throw new DirectToolError(
			"TOOL_INPUT_INVALID",
			"repository provider directory does not exist",
		);
	}
	if (!within(workspaceRoot, actual))
		throw new DirectToolError(
			"TOOL_SCOPE_DENIED",
			"repository provider symlink escaped the server-bound Workspace",
		);
	const rel = relative(workspaceRoot, actual).split(sep).join("/");
	if (rel.split("/").includes(".proflow"))
		throw new DirectToolError(
			"TOOL_SCOPE_DENIED",
			"repository providers cannot inspect protected .proflow runtime state",
		);
	const info = await stat(actual);
	if (!info.isDirectory())
		throw new DirectToolError(
			"TOOL_INPUT_INVALID",
			"repository provider path must be a directory",
		);
	return actual;
}

async function collectFiles(root: string, limit: number): Promise<string[]> {
	const output: string[] = [];
	const stack = [root];
	while (stack.length && output.length < limit) {
		const current = stack.pop();
		if (!current) break;
		let entries: Dirent[];
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if ([".git", "node_modules", "dist"].includes(entry.name)) continue;
			const absolute = join(current, entry.name);
			if (entry.isDirectory()) stack.push(absolute);
			else if (entry.isFile()) output.push(absolute);
			if (output.length >= limit) break;
		}
	}
	return output;
}

export async function createDirectToolExecutor(
	options: DirectToolExecutorOptions,
) {
	if (!isAbsolute(options.workspaceRoot))
		throw new TypeError("Direct Tool workspaceRoot must be absolute");
	const workspaceRoot = await realpath(resolve(options.workspaceRoot));
	const generation = options.generation;
	const now = options.now ?? (() => new Date());
	const idFactory = options.idFactory ?? randomUUID;
	const stateRoot = resolve(
		options.stateRoot ??
			join(workspaceRoot, ".proflow", "runtime", "direct-tools"),
	);
	const safeGeneration = generation.replace(/[^a-zA-Z0-9._-]/g, "_");
	const processRoot = join(stateRoot, "processes", safeGeneration);
	const repomixRoot = join(stateRoot, "repomix", safeGeneration);
	await Promise.all([
		mkdir(processRoot, { recursive: true, mode: 0o700 }),
		mkdir(repomixRoot, { recursive: true, mode: 0o700 }),
	]);
	const managed = new Map<string, ManagedProcess>();
	const repomixOutputs = new Map<string, RepomixOutput>();

	const prepare = async (
		request: DirectToolRequest,
	): Promise<DirectToolPreparation> => {
		if (!directToolNames.includes(request.tool))
			throw new DirectToolError(
				"TOOL_INPUT_INVALID",
				"unsupported direct tool",
			);
		return {
			notices: unique(
				explicitPaths(request).map((path) =>
					outsideNotice(workspaceRoot, path),
				),
			),
		};
	};

	const requireManaged = (processRef: string, roleRef: string) => {
		const record = managed.get(processRef);
		if (
			!record ||
			record.roleRef !== roleRef ||
			record.generation !== generation
		)
			throw new DirectToolError(
				"TOOL_HANDLE_INVALID",
				"processRef is not owned by this Role/Workspace/generation",
			);
		return record;
	};

	const executeLocalDev = async (request: DirectToolRequest) => {
		const input = inputObject(request.input);
		const remaining = deadlineRemaining(request, now);
		if (request.operation === "read") {
			const paths = stringValue(input.path, "path", true)
				? [String(input.path)]
				: stringArray(input.paths, "paths");
			if (paths.length === 0 || paths.length > 64)
				throw new DirectToolError(
					"TOOL_INPUT_INVALID",
					"read requires 1..64 paths",
				);
			const maxBytes = integerValue(
				input.maxBytes,
				"maxBytes",
				64_000,
				1,
				500_000,
			);
			const files = [];
			for (const path of paths) {
				const absolute = await resolveFilePath(workspaceRoot, path);
				const info = await stat(absolute);
				if (!info.isFile())
					throw new DirectToolError(
						"TOOL_INPUT_INVALID",
						`${path} is not a file`,
					);
				const content = boundedText(await readFile(absolute, "utf8"), maxBytes);
				files.push({
					path: absolute,
					content: content.text,
					truncated: content.truncated,
					bytes: info.size,
					mtimeMs: info.mtimeMs,
					hash: `sha256:${createHash("sha256")
						.update(await readFile(absolute))
						.digest("hex")}`,
				});
			}
			return { files };
		}
		if (request.operation === "list") {
			const path = String(stringValue(input.path, "path", true) ?? ".");
			const absolute = await resolveFilePath(workspaceRoot, path);
			const maxEntries = integerValue(
				input.maxEntries,
				"maxEntries",
				500,
				1,
				5_000,
			);
			const entries = (await readdir(absolute, { withFileTypes: true }))
				.slice(0, maxEntries)
				.map((entry) => ({
					name: entry.name,
					path: join(absolute, entry.name),
					kind: entry.isDirectory()
						? "directory"
						: entry.isFile()
							? "file"
							: "other",
				}));
			return {
				path: absolute,
				entries,
				truncated: entries.length >= maxEntries,
			};
		}
		if (request.operation === "search") {
			const query = String(stringValue(input.query, "query"));
			const mode = input.mode ?? "literal";
			if (!["literal", "regex", "filename"].includes(String(mode)))
				throw new DirectToolError(
					"TOOL_INPUT_INVALID",
					"search mode must be literal, regex, or filename",
				);
			const roots = stringArray(input.paths, "paths");
			if (roots.length === 0)
				roots.push(String(stringValue(input.path, "path", true) ?? "."));
			const maxResults = integerValue(
				input.maxResults,
				"maxResults",
				200,
				1,
				2_000,
			);
			const matches: Array<{ path: string; line?: number; text?: string }> = [];
			const regex = mode === "regex" ? new RegExp(query) : undefined;
			for (const rootPath of roots) {
				const root = await resolveFilePath(workspaceRoot, rootPath);
				const info = await stat(root);
				const files = info.isDirectory()
					? await collectFiles(root, 20_000)
					: [root];
				for (const file of files) {
					if (mode === "filename") {
						if (basename(file).includes(query)) matches.push({ path: file });
					} else {
						let content: string;
						try {
							content = await readFile(file, "utf8");
						} catch {
							continue;
						}
						for (const [index, line] of content.split(/\r?\n/).entries()) {
							if (regex ? regex.test(line) : line.includes(query))
								matches.push({
									path: file,
									line: index + 1,
									text: line.slice(0, 2_000),
								});
							if (matches.length >= maxResults) break;
						}
					}
					if (matches.length >= maxResults) break;
				}
				if (matches.length >= maxResults) break;
			}
			return { matches, truncated: matches.length >= maxResults };
		}
		if (request.operation === "mutate") {
			const action = String(stringValue(input.action, "action"));
			if (action === "move") {
				const source = await resolveFilePath(
					workspaceRoot,
					String(stringValue(input.source, "source")),
				);
				const destination = await resolveFilePath(
					workspaceRoot,
					String(stringValue(input.destination, "destination")),
					{ allowMissing: true },
				);
				await mkdir(dirname(destination), { recursive: true });
				await rename(source, destination);
				return { action, source, destination };
			}
			const path = await resolveFilePath(
				workspaceRoot,
				String(stringValue(input.path, "path")),
				{
					allowMissing:
						action === "create" || action === "write" || action === "mkdir",
				},
			);
			if (action === "mkdir")
				await mkdir(path, { recursive: Boolean(input.recursive ?? true) });
			else if (action === "delete")
				await rm(path, {
					recursive: Boolean(input.recursive),
					force: Boolean(input.force),
				});
			else if (action === "create") {
				await mkdir(dirname(path), {
					recursive: Boolean(input.createParents ?? true),
				});
				await writeFile(path, String(input.content ?? ""), {
					encoding: "utf8",
					flag: "wx",
				});
			} else if (action === "write") {
				await mkdir(dirname(path), {
					recursive: Boolean(input.createParents ?? true),
				});
				await writeFile(path, String(input.content ?? ""), "utf8");
			} else if (action === "edit") {
				const oldText = String(stringValue(input.oldText, "oldText"));
				const newText = typeof input.newText === "string" ? input.newText : "";
				const current = await readFile(path, "utf8");
				const occurrences = current.split(oldText).length - 1;
				const expected = integerValue(
					input.expectedReplacements,
					"expectedReplacements",
					1,
					1,
					10_000,
				);
				if (occurrences !== expected)
					throw new DirectToolError(
						"TOOL_EXECUTION_FAILED",
						`edit expected ${expected} occurrence(s), found ${occurrences}`,
					);
				await writeFile(path, current.split(oldText).join(newText), "utf8");
			} else {
				throw new DirectToolError(
					"TOOL_INPUT_INVALID",
					"unsupported mutate action",
				);
			}
			return { action, path };
		}
		if (request.operation === "run") {
			const command = String(stringValue(input.command, "command"));
			const args = stringArray(input.args, "args");
			assertSafeCommand(command, args);
			const cwd = await resolveFilePath(
				workspaceRoot,
				String(stringValue(input.cwd, "cwd", true) ?? "."),
				{ allowProtected: true },
			);
			const maxOutputBytes = integerValue(
				input.maxOutputBytes,
				"maxOutputBytes",
				64_000,
				1,
				250_000,
			);
			const requestedTimeout = integerValue(
				input.timeoutMs,
				"timeoutMs",
				30_000,
				1,
				40_000,
			);
			const result = await spawnCaptured({
				command,
				args,
				cwd,
				env: safeEnvironment(envObject(input.env)),
				timeoutMs: Math.max(1, Math.min(requestedTimeout, remaining - 50)),
				maxOutputBytes,
			});
			return result;
		}
		if (request.operation === "process") {
			const action = String(stringValue(input.action, "action"));
			if (action === "list") {
				return spawnCaptured({
					command: "ps",
					args: ["-axo", "pid=,ppid=,stat=,etime=,comm="],
					cwd: workspaceRoot,
					env: safeEnvironment({}),
					timeoutMs: Math.min(5_000, remaining),
					maxOutputBytes: integerValue(
						input.maxOutputBytes,
						"maxOutputBytes",
						64_000,
						1,
						250_000,
					),
				});
			}
			if (action === "ports") {
				const port =
					input.port === undefined
						? undefined
						: integerValue(input.port, "port", 0, 1, 65535);
				return spawnCaptured({
					command: "lsof",
					args: port
						? ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]
						: ["-nP", "-iTCP", "-sTCP:LISTEN"],
					cwd: workspaceRoot,
					env: safeEnvironment({}),
					timeoutMs: Math.min(5_000, remaining),
					maxOutputBytes: integerValue(
						input.maxOutputBytes,
						"maxOutputBytes",
						64_000,
						1,
						250_000,
					),
				});
			}
			if (action === "start") {
				const command = String(stringValue(input.command, "command"));
				const args = stringArray(input.args, "args");
				assertSafeCommand(command, args);
				const cwd = await resolveFilePath(
					workspaceRoot,
					String(stringValue(input.cwd, "cwd", true) ?? "."),
					{ allowProtected: true },
				);
				const processRef = `process:${generation}:${idFactory()}`;
				const stdoutPath = join(
					processRoot,
					`${createHash("sha256").update(processRef).digest("hex")}.stdout.log`,
				);
				const stderrPath = join(
					processRoot,
					`${createHash("sha256").update(processRef).digest("hex")}.stderr.log`,
				);
				await Promise.all([
					writeFile(stdoutPath, "", { mode: 0o600 }),
					writeFile(stderrPath, "", { mode: 0o600 }),
				]);
				const child = spawn(command, args, {
					cwd,
					env: safeEnvironment(envObject(input.env)),
					stdio: ["pipe", "pipe", "pipe"],
					shell: false,
				});
				if (!child.pid)
					throw new DirectToolError(
						"TOOL_EXECUTION_FAILED",
						"managed process did not expose a pid",
					);
				const record: ManagedProcess = {
					processRef,
					roleRef: request.authenticatedRoleRef,
					generation,
					pid: child.pid,
					child,
					cwd,
					command,
					args,
					stdoutPath,
					stderrPath,
					startedAt: now().toISOString(),
					exitCode: null,
				};
				managed.set(processRef, record);
				child.stdout.on(
					"data",
					(chunk: Buffer) => void appendFile(stdoutPath, chunk),
				);
				child.stderr.on(
					"data",
					(chunk: Buffer) => void appendFile(stderrPath, chunk),
				);
				child.once("close", (code) => {
					record.exitCode = code ?? 1;
					record.exitedAt = now().toISOString();
				});
				return { processRef, pid: child.pid, cwd, startedAt: record.startedAt };
			}
			const processRef = String(stringValue(input.processRef, "processRef"));
			const record = requireManaged(processRef, request.authenticatedRoleRef);
			if (action === "status")
				return {
					processRef,
					pid: record.pid,
					running: record.exitCode === null,
					exitCode: record.exitCode,
					startedAt: record.startedAt,
					...(record.exitedAt ? { exitedAt: record.exitedAt } : {}),
				};
			if (action === "read") {
				const stream = input.stream === "stderr" ? "stderr" : "stdout";
				const path =
					stream === "stderr" ? record.stderrPath : record.stdoutPath;
				const content = await readFile(path, "utf8");
				const offset = integerValue(
					input.offset,
					"offset",
					0,
					0,
					Math.max(0, Buffer.byteLength(content)),
				);
				const limit = integerValue(input.limit, "limit", 64_000, 1, 250_000);
				const bytes = Buffer.from(content);
				const chunk = bytes.subarray(offset, offset + limit).toString("utf8");
				return {
					processRef,
					stream,
					chunk,
					nextOffset: offset + Buffer.byteLength(chunk),
					eof: offset + Buffer.byteLength(chunk) >= bytes.length,
				};
			}
			if (action === "input") {
				if (record.exitCode !== null)
					throw new DirectToolError(
						"TOOL_HANDLE_INVALID",
						"process already exited",
					);
				const data = typeof input.data === "string" ? input.data : "";
				record.child.stdin.write(data);
				return { processRef, accepted: true };
			}
			if (action === "stop") {
				if (record.exitCode === null) record.child.kill("SIGTERM");
				return { processRef, stopped: true };
			}
			throw new DirectToolError(
				"TOOL_INPUT_INVALID",
				"unsupported process action",
			);
		}
		throw new DirectToolError(
			"TOOL_INPUT_INVALID",
			`unsupported Local Dev operation: ${request.operation}`,
		);
	};

	const removeRepomixOutput = async (record: RepomixOutput) => {
		repomixOutputs.delete(record.outputId);
		await rm(record.path, { force: true });
	};

	const pruneRepomixOutputs = async () => {
		const stamp = now().getTime();
		for (const record of [...repomixOutputs.values()])
			if (record.expiresAt <= stamp) await removeRepomixOutput(record);
		while (repomixOutputs.size >= REPOMIX_MAX_OUTPUTS) {
			const oldest = [...repomixOutputs.values()].sort(
				(left, right) => left.createdAt - right.createdAt,
			)[0];
			if (!oldest) break;
			await removeRepomixOutput(oldest);
		}
	};

	const requireRepomixOutput = async (
		outputId: string,
		roleRef: string,
	): Promise<RepomixOutput> => {
		const record = repomixOutputs.get(outputId);
		if (
			!record ||
			record.roleRef !== roleRef ||
			record.generation !== generation ||
			record.expiresAt <= now().getTime()
		) {
			if (record) await removeRepomixOutput(record);
			throw new DirectToolError(
				"TOOL_HANDLE_INVALID",
				"outputId is expired or not owned by this Role/Workspace/generation",
			);
		}
		return record;
	};

	const executeRepomix = async (request: DirectToolRequest) => {
		const input = inputObject(request.input);
		deadlineRemaining(request, now);
		if (request.operation === "pack") {
			const directory = String(
				stringValue(input.directory, "directory", true) ?? ".",
			);
			const sourceDirectory = await resolveProviderDirectory(
				workspaceRoot,
				directory,
			);
			const includePatterns = stringArray(
				input.includePatterns,
				"includePatterns",
			);
			const ignorePatterns = stringArray(
				input.ignorePatterns,
				"ignorePatterns",
			);
			if (includePatterns.length > 100 || ignorePatterns.length > 100)
				throw new DirectToolError(
					"TOOL_INPUT_INVALID",
					"Repomix include/ignore pattern count exceeds 100",
				);
			if (
				[...includePatterns, ...ignorePatterns].some((pattern) =>
					pattern.split("/").includes(".proflow"),
				)
			)
				throw new DirectToolError(
					"TOOL_SCOPE_DENIED",
					"Repomix patterns cannot target protected .proflow runtime state",
				);
			if (input.compress !== undefined && typeof input.compress !== "boolean")
				throw new DirectToolError(
					"TOOL_INPUT_INVALID",
					"compress must be a boolean",
				);
			await pruneRepomixOutputs();
			const outputId = `repomix-output:${idFactory()}`;
			const outputPath = join(
				repomixRoot,
				`${createHash("sha256").update(outputId).digest("hex")}.md`,
			);
			const relativeDirectory = relative(workspaceRoot, sourceDirectory) || ".";
			let result: Awaited<ReturnType<typeof runDefaultAction>>;
			try {
				result = await runDefaultAction([relativeDirectory], workspaceRoot, {
					output: outputPath,
					compress: input.compress === true,
					...(includePatterns.length
						? { include: includePatterns.join(",") }
						: {}),
					ignore: ["**/.proflow/**", ...ignorePatterns].join(","),
					confineToBaseDir: true,
					skipLocalConfig: true,
					skipGlobalConfig: true,
					securityCheck: true,
					copy: false,
					stdout: false,
					quiet: true,
				});
			} catch (error) {
				await rm(outputPath, { force: true });
				throw new DirectToolError(
					"TOOL_EXECUTION_FAILED",
					error instanceof Error ? error.message : "Repomix pack failed",
				);
			}
			try {
				deadlineRemaining(request, now);
			} catch (error) {
				await rm(outputPath, { force: true });
				throw error;
			}
			const outputInfo = await stat(outputPath);
			if (!outputInfo.isFile() || outputInfo.size > REPOMIX_MAX_PACK_BYTES) {
				await rm(outputPath, { force: true });
				throw new DirectToolError(
					"TOOL_EXECUTION_FAILED",
					"Repomix output exceeded the bounded provider cache size",
				);
			}
			const stamp = now().getTime();
			const record: RepomixOutput = {
				outputId,
				roleRef: request.authenticatedRoleRef,
				generation,
				path: outputPath,
				sourceDirectory,
				createdAt: stamp,
				expiresAt: stamp + REPOMIX_OUTPUT_TTL_MS,
				totalFiles: result.packResult.totalFiles,
				totalCharacters: result.packResult.totalCharacters,
				totalTokens: result.packResult.totalTokens,
			};
			repomixOutputs.set(outputId, record);
			return {
				outputId,
				directory: relativeDirectory,
				totalFiles: record.totalFiles,
				totalCharacters: record.totalCharacters,
				totalTokens: record.totalTokens,
				bytes: outputInfo.size,
				expiresAt: new Date(record.expiresAt).toISOString(),
			};
		}

		const outputId = String(stringValue(input.outputId, "outputId"));
		const record = await requireRepomixOutput(
			outputId,
			request.authenticatedRoleRef,
		);
		const content = await readFile(record.path, "utf8");
		const lines = content.split(/\r?\n/);
		if (request.operation === "grep") {
			const pattern = String(stringValue(input.pattern, "pattern"));
			if (pattern.length > 1_000)
				throw new DirectToolError(
					"TOOL_INPUT_INVALID",
					"Repomix grep pattern exceeds 1000 characters",
				);
			const contextLines = integerValue(
				input.contextLines,
				"contextLines",
				2,
				0,
				50,
			);
			const maxMatches = integerValue(
				input.maxMatches,
				"maxMatches",
				100,
				1,
				2_000,
			);
			const matches: Array<{ line: number; snippet: string }> = [];
			let resultBytes = 0;
			let truncated = false;
			for (let index = 0; index < lines.length; index += 1) {
				if (!String(lines[index] ?? "").includes(pattern)) continue;
				const from = Math.max(0, index - contextLines);
				const to = Math.min(lines.length, index + contextLines + 1);
				const snippet = lines
					.slice(from, to)
					.map(
						(line, offset) => `${from + offset + 1}: ${line.slice(0, 1_000)}`,
					)
					.join("\n");
				const nextBytes = Buffer.byteLength(snippet);
				if (resultBytes + nextBytes > TOOL_TEXT_RESULT_MAX_BYTES) {
					truncated = true;
					break;
				}
				matches.push({ line: index + 1, snippet });
				resultBytes += nextBytes;
				if (matches.length >= maxMatches) {
					truncated = index + 1 < lines.length;
					break;
				}
			}
			return { outputId, pattern, matches, truncated };
		}
		if (request.operation === "read") {
			const startLine = integerValue(
				input.startLine,
				"startLine",
				1,
				1,
				Math.max(1, lines.length),
			);
			const requestedEndLine = integerValue(
				input.endLine,
				"endLine",
				Math.min(lines.length, startLine + 499),
				1,
				Math.max(1, lines.length),
			);
			if (requestedEndLine < startLine)
				throw new DirectToolError(
					"TOOL_INPUT_INVALID",
					"endLine must be greater than or equal to startLine",
				);
			const endLine = Math.min(requestedEndLine, startLine + 1_999);
			const selected: string[] = [];
			let bytes = 0;
			let lastLine = startLine - 1;
			for (let lineNo = startLine; lineNo <= endLine; lineNo += 1) {
				const line = String(lines[lineNo - 1] ?? "");
				const nextBytes = Buffer.byteLength(line) + (selected.length ? 1 : 0);
				if (bytes + nextBytes > TOOL_TEXT_RESULT_MAX_BYTES) break;
				selected.push(line);
				bytes += nextBytes;
				lastLine = lineNo;
			}
			const eof = lastLine >= lines.length;
			return {
				outputId,
				startLine,
				endLine: lastLine,
				content: selected.join("\n"),
				nextLine: eof ? null : lastLine + 1,
				eof,
				truncated: lastLine < requestedEndLine,
			};
		}
		throw new DirectToolError(
			"TOOL_INPUT_INVALID",
			`unsupported Repomix operation: ${request.operation}`,
		);
	};

	const executeCodeGraph = async (request: DirectToolRequest) => {
		if (request.operation !== "explore")
			throw new DirectToolError(
				"TOOL_INPUT_INVALID",
				`unsupported CodeGraph operation: ${request.operation}`,
			);
		const input = inputObject(request.input);
		const query = String(stringValue(input.query, "query"));
		if (query.length > 20_000)
			throw new DirectToolError(
				"TOOL_INPUT_INVALID",
				"CodeGraph query exceeds 20000 characters",
			);
		const maxFiles = integerValue(input.maxFiles, "maxFiles", 12, 1, 50);
		const requestedPath = String(
			stringValue(input.projectPath, "projectPath", true) ?? ".",
		);
		const requestedDirectory = await resolveProviderDirectory(
			workspaceRoot,
			requestedPath,
		);
		let projectRoot = findNearestCodeGraphRoot(requestedDirectory);
		if (!projectRoot)
			throw new DirectToolError(
				"TOOL_PROVIDER_UNAVAILABLE",
				"CodeGraph has no existing index for the selected project",
			);
		projectRoot = await resolveProviderDirectory(workspaceRoot, projectRoot);
		deadlineRemaining(request, now);
		let graph: Awaited<ReturnType<typeof CodeGraph.open>> | undefined;
		try {
			graph = await CodeGraph.open(projectRoot, {
				sync: false,
				readOnly: true,
			});
			const stats = graph.getStats();
			const context = await graph.buildContext(query, {
				maxNodes: Math.min(200, Math.max(20, maxFiles * 8)),
				maxCodeBlocks: maxFiles,
				maxCodeBlockSize: 6_000,
				includeCode: true,
				format: "markdown",
				searchLimit: Math.min(20, Math.max(5, maxFiles)),
				traversalDepth: 2,
			});
			deadlineRemaining(request, now);
			const bounded = boundedText(String(context), TOOL_TEXT_RESULT_MAX_BYTES);
			return {
				projectPath: relative(workspaceRoot, projectRoot) || ".",
				context: bounded.text,
				truncated: bounded.truncated,
				indexState: graph.getIndexState(),
				lastIndexedAt: graph.getLastIndexedAt(),
				indexEngineStale: graph.isIndexStale(),
				stats: {
					files: stats.fileCount,
					nodes: stats.nodeCount,
					edges: stats.edgeCount,
				},
			};
		} catch (error) {
			if (error instanceof DirectToolError) throw error;
			throw new DirectToolError(
				"TOOL_PROVIDER_UNAVAILABLE",
				error instanceof Error ? error.message : "CodeGraph explore failed",
			);
		} finally {
			graph?.close();
		}
	};

	const execute = async (request: DirectToolRequest) => {
		if (request.tool === "localDev") return executeLocalDev(request);
		if (request.tool === "repomix") return executeRepomix(request);
		if (request.tool === "codeGraph") return executeCodeGraph(request);
		throw new DirectToolError("TOOL_INPUT_INVALID", "unsupported direct tool");
	};

	return Object.freeze({
		workspaceRoot,
		generation,
		prepare,
		execute,
		async close() {
			for (const record of managed.values())
				if (record.exitCode === null) record.child.kill("SIGTERM");
			managed.clear();
			await Promise.allSettled(
				[...repomixOutputs.values()].map((record) =>
					rm(record.path, { force: true }),
				),
			);
			repomixOutputs.clear();
		},
	});
}
