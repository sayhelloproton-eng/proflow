#!/usr/bin/env node

import { readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
	moduleDocsDataSchema,
	moduleSetupPlanDataSchema,
	moduleStatusObservationSchema,
} from "@tomflow/proflow-module-contract";
import { descriptor as platformCliDescriptor } from "../deployment/descriptor.ts";
import { AutoModuleCatalog, discoverModules } from "./discovery/discover.ts";
import { InstalledModuleCatalog } from "./discovery/installed.ts";
import { PlatformError } from "./errors.ts";
import {
	observeWorkspaceInstalledVersion,
	type PackageCommandOutput,
	type PackageCommandRunner,
	removeWorkspacePackages,
	syncWorkspacePackages,
} from "./install/package-manager.ts";
import {
	cleanOwnedPnpmPolicy,
	observeMinimumReleaseAgeExclude,
	recordPnpmPolicyOwnership,
} from "./install/pnpm-policy.ts";
import {
	installModulesThin,
	type ModuleBatchResult,
	observeDocs,
	observeStatuses,
	setupModulesThin,
	startModulesThin,
	stopModulesThin,
	uninstallModulesThin,
} from "./lifecycle/index.ts";
import { ensureWorkspaceMetadata } from "./persistence/workspace-metadata.ts";
import { type PlatformProgressReporter, reportProgress } from "./progress.ts";
import {
	discoverRegistryModules,
	type NpmCommandRunner,
	PRO_FLOW_PACKAGE_PREFIX,
} from "./registry/index.ts";
import { createTerminalProgressReporter } from "./terminal.ts";

const COMMANDS = [
	"install",
	"uninstall",
	"status",
	"setup",
	"docs",
	"start",
	"stop",
] as const;
type Command = (typeof COMMANDS)[number];
export type CliStatus = "SUCCEEDED" | "ACTION_REQUIRED" | "BLOCKED" | "FAILED";
export interface CliOutcome {
	command: string;
	status: CliStatus;
	workspaceRoot?: string;
	data?: unknown;
	error?: {
		code: string;
		message: string;
		category?: "USAGE" | "OPERATION";
		helpCommand?: Command;
	};
}
export interface CliRuntimeOptions {
	cwd?: string;
	registryRunner?: NpmCommandRunner;
	packageRunner?: PackageCommandRunner;
	executableAvailable?: (command: string) => boolean;
	onProgress?: PlatformProgressReporter;
}
interface ParsedArgs {
	command: Command | "help" | "version";
	workspace?: string;
	moduleRef?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
	let workspace: string | undefined, moduleRef: string | undefined;
	let special: "help" | "version" | undefined;
	const positional: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === undefined) continue;
		if (value === "--json")
			throw new PlatformError("INVALID_REQUEST", "不支持的选项 --json");
		if (value === "--workspace" || value === "--module") {
			const next = argv[index + 1];
			if (!next || next.startsWith("-"))
				throw new PlatformError("INVALID_REQUEST", `${value} requires a value`);
			if (value === "--workspace") workspace = next;
			else if (value === "--module") moduleRef = next;
			index += 1;
			continue;
		}
		if (value === "--help" || value === "-h") {
			special = "help";
			continue;
		}
		if (value === "--version" || value === "-v") {
			special = "version";
			continue;
		}
		if (value.startsWith("-"))
			throw new PlatformError("INVALID_REQUEST", `unknown option ${value}`);
		positional.push(value);
	}
	if (special !== undefined) {
		if (
			workspace !== undefined ||
			moduleRef !== undefined ||
			positional.length > 0
		)
			throw new PlatformError(
				"INVALID_REQUEST",
				`${special} flag cannot be combined with command options`,
			);
		return { command: special };
	}
	if (positional.length === 0) return { command: "help" };
	if (positional.length !== 1)
		throw new PlatformError(
			"INVALID_REQUEST",
			"commands accept no positional arguments",
		);
	const raw = positional[0] ?? "";
	if (!COMMANDS.includes(raw as Command))
		throw new PlatformError("INVALID_REQUEST", `unknown command ${raw}`);
	const command = raw as Command;
	if (moduleRef !== undefined && command !== "setup")
		throw new PlatformError(
			"INVALID_REQUEST",
			"--module is only valid with setup",
		);
	return {
		command,
		...(workspace === undefined ? {} : { workspace }),
		...(moduleRef === undefined ? {} : { moduleRef }),
	};
}
function outcome(
	command: string,
	status: CliStatus,
	workspaceRoot?: string,
	data?: unknown,
): CliOutcome {
	return {
		command,
		status,
		...(workspaceRoot === undefined ? {} : { workspaceRoot }),
		...(data === undefined ? {} : { data }),
	};
}
async function canonicalWorkspace(
	cwd: string,
	explicit?: string,
): Promise<string> {
	const candidate = explicit === undefined ? cwd : resolve(cwd, explicit);
	let info: Awaited<ReturnType<typeof stat>>;
	try {
		info = await stat(candidate);
	} catch (error) {
		throw new PlatformError(
			"WORKSPACE_NOT_FOUND",
			`Workspace does not exist: ${candidate} (${error instanceof Error ? error.message : String(error)})`,
		);
	}
	if (!info.isDirectory())
		throw new PlatformError(
			"WORKSPACE_NOT_FOUND",
			`Workspace is not a directory: ${candidate}`,
		);
	return realpath(candidate);
}
async function buildContext(root: string) {
	const catalog = new AutoModuleCatalog(root);
	const modules = await discoverModules({ workspaceRoot: root, catalog });
	return { catalog, modules };
}
function statusFromModule(value: string): CliStatus {
	return value === "SUCCEEDED"
		? "SUCCEEDED"
		: value === "ACTION_REQUIRED"
			? "ACTION_REQUIRED"
			: value === "BLOCKED"
				? "BLOCKED"
				: "FAILED";
}
function batchStatus(result: ModuleBatchResult): CliStatus {
	if (result.completed) return "SUCCEEDED";
	if (result.blockedBy)
		return result.blockedBy.setupStatus === "ACTION_REQUIRED"
			? "ACTION_REQUIRED"
			: result.blockedBy.setupStatus === "BLOCKED"
				? "BLOCKED"
				: "FAILED";
	const statuses = result.results.map((item) =>
		statusFromModule(item.result.status),
	);
	if (statuses.includes("FAILED")) return "FAILED";
	if (statuses.includes("BLOCKED")) return "BLOCKED";
	if (statuses.includes("ACTION_REQUIRED")) return "ACTION_REQUIRED";
	return "FAILED";
}
async function handleStatus(
	root: string,
	runtime: CliRuntimeOptions,
): Promise<CliOutcome> {
	reportProgress(runtime.onProgress, {
		command: "status",
		phase: "status",
		status: "STARTED",
		message: "正在读取模块状态",
	});
	const { catalog, modules } = await buildContext(root);
	const observed = await observeStatuses(catalog, modules, root);
	const byRef = new Map(modules.map((module) => [module.moduleRef, module]));
	const output = observed.map((item) => {
		if (item.result.status !== "SUCCEEDED")
			throw new PlatformError(
				"COMMAND_FAILED",
				`module ${item.moduleRef} status observation did not return SUCCEEDED`,
			);
		const parsed = moduleStatusObservationSchema.safeParse(item.result.data);
		if (!parsed.success)
			throw new PlatformError(
				"COMMAND_FAILED",
				`module ${item.moduleRef} returned invalid status: ${parsed.error.message}`,
			);
		const module = byRef.get(item.moduleRef);
		if (!module)
			throw new PlatformError(
				"COMMAND_FAILED",
				`unknown module ${item.moduleRef}`,
			);
		return {
			moduleRef: item.moduleRef,
			version: module.moduleVersion,
			setupStatus: parsed.data.setupStatus,
			runtimeStatus: parsed.data.runtimeStatus,
			...(parsed.data.issues === undefined
				? {}
				: { issues: parsed.data.issues }),
		};
	});
	reportProgress(runtime.onProgress, {
		command: "status",
		phase: "status",
		status: "SUCCEEDED",
		message: `已读取 ${output.length} 个模块状态`,
	});
	return outcome("status", "SUCCEEDED", root, { modules: output });
}
async function handleDocs(
	root: string,
	runtime: CliRuntimeOptions,
): Promise<CliOutcome> {
	reportProgress(runtime.onProgress, {
		command: "docs",
		phase: "docs",
		status: "STARTED",
		message: "正在整理模块文档",
	});
	const { catalog, modules: resolvedModules } = await buildContext(root);
	const docs = await observeDocs(catalog, resolvedModules, root);
	const byRef = new Map(
		resolvedModules.map((module) => [module.moduleRef, module]),
	);
	const modules: Array<Record<string, unknown>> = [];
	const errors: Array<Record<string, unknown>> = [];
	for (const item of docs) {
		const parsed = moduleDocsDataSchema.safeParse(item.result.data);
		if (item.result.status !== "SUCCEEDED" || !parsed.success) {
			errors.push({
				moduleRef: item.moduleRef,
				reason:
					item.result.status !== "SUCCEEDED"
						? (item.result.error?.message ?? "文档读取失败")
						: "Module.docs 返回格式无效",
			});
			continue;
		}
		modules.push({
			moduleRef: item.moduleRef,
			version: byRef.get(item.moduleRef)?.moduleVersion,
			docs: parsed.data.docs,
		});
	}
	reportProgress(runtime.onProgress, {
		command: "docs",
		phase: "docs",
		status: errors.length === 0 ? "SUCCEEDED" : "FAILED",
		message:
			errors.length === 0
				? `已整理 ${modules.length} 份模块文档`
				: `${errors.length} 份模块文档读取失败`,
	});
	return outcome("docs", errors.length === 0 ? "SUCCEEDED" : "FAILED", root, {
		modules,
		errors,
	});
}
async function validateInstalledPackageSet(
	root: string,
	candidates: readonly { packageName: string; moduleVersion: string }[],
	previousManaged: readonly string[],
) {
	const expectedNames = candidates.map((item) => item.packageName).sort();
	const declaredNames = await workspaceProFlowDependencies(root);
	if (JSON.stringify(declaredNames) !== JSON.stringify(expectedNames))
		throw new PlatformError(
			"COMMAND_FAILED",
			`managed dependency set mismatch: expected ${expectedNames.join(", ")}, observed ${declaredNames.join(", ")}`,
		);
	for (const candidate of candidates) {
		const observed = await observeWorkspaceInstalledVersion(
			root,
			candidate.packageName,
		);
		if (observed !== candidate.moduleVersion)
			throw new PlatformError(
				"COMMAND_FAILED",
				`installed version mismatch for ${candidate.packageName}: expected ${candidate.moduleVersion}, observed ${observed ?? "missing"}`,
			);
	}
	for (const stale of previousManaged.filter(
		(name) => !expectedNames.includes(name),
	))
		if ((await observeWorkspaceInstalledVersion(root, stale)) !== undefined)
			throw new PlatformError(
				"COMMAND_FAILED",
				`stale managed package remains installed after synchronization: ${stale}`,
			);
	const catalog = new InstalledModuleCatalog(root);
	const sources = await catalog.sources();
	const modules = await discoverModules({ catalog, sources });
	const byPackage = new Map(
		modules.map((module) => [module.packageName, module]),
	);
	for (const candidate of candidates) {
		const module = byPackage.get(candidate.packageName);
		if (
			module === undefined ||
			module.moduleVersion !== candidate.moduleVersion
		)
			throw new PlatformError(
				"DESCRIPTOR_INVALID",
				`installed descriptor mismatch for ${candidate.packageName}@${candidate.moduleVersion}`,
			);
	}
}
async function handleInstall(
	root: string,
	runtime: CliRuntimeOptions,
): Promise<CliOutcome> {
	const startedAt = Date.now();
	reportProgress(runtime.onProgress, {
		command: "install",
		phase: "workspace",
		kind: "phase",
		status: "STARTED",
		message: "正在校验 Workspace",
	});
	const metadata = await ensureWorkspaceMetadata(root);
	reportProgress(runtime.onProgress, {
		command: "install",
		phase: "workspace",
		kind: "phase",
		status: "SUCCEEDED",
		message: "Workspace 校验完成",
		elapsedMs: Date.now() - startedAt,
	});
	reportProgress(runtime.onProgress, {
		command: "install",
		phase: "registry",
		kind: "phase",
		status: "STARTED",
		message: "正在连接 Registry",
	});
	const discovered = await discoverRegistryModules({
		workspaceRoot: root,
		onSearchComplete: (total) =>
			reportProgress(runtime.onProgress, {
				command: "install",
				phase: "registry",
				kind: "detail",
				status: "STARTED",
				total,
				message: `Registry 返回 ${total} 个候选模块，正在核验`,
			}),
		onPackageChecked: ({ current, total, packageName }) =>
			reportProgress(runtime.onProgress, {
				command: "install",
				phase: "registry",
				kind: "detail",
				status: "SUCCEEDED",
				current,
				total,
				moduleRef: packageName.replace(PRO_FLOW_PACKAGE_PREFIX, ""),
				message: `核验 ${packageName.replace(PRO_FLOW_PACKAGE_PREFIX, "")}`,
			}),
		...(runtime.registryRunner === undefined
			? {}
			: { runner: runtime.registryRunner }),
	});
	reportProgress(runtime.onProgress, {
		command: "install",
		phase: "registry",
		kind: "phase",
		status: "SUCCEEDED",
		message: `已发现 ${discovered.candidates.length} 个注册模块`,
	});
	if (discovered.rejected.length > 0)
		throw new PlatformError(
			"REGISTRY_RESPONSE_INVALID",
			`registry contains rejected ProFlow packages: ${discovered.rejected.map((item) => `${item.packageName}:${item.reason}`).join(", ")}`,
		);
	if (discovered.candidates.length === 0)
		throw new PlatformError(
			"PACKAGE_NOT_FOUND",
			"no ProFlow packages were discovered in the configured scope",
		);
	const previousManaged = await workspaceProFlowDependencies(root);
	const pnpmPolicyBefore = await observeMinimumReleaseAgeExclude(root);
	reportProgress(runtime.onProgress, {
		command: "install",
		phase: "packages",
		kind: "phase",
		status: "STARTED",
		message: "正在同步依赖",
	});
	const mutation = await syncWorkspacePackages({
		workspaceRoot: root,
		packages: discovered.candidates.map((item) => ({
			packageName: item.packageName,
			version: item.moduleVersion,
		})),
		onOutput: (line) => reportPackageManagerOutput(runtime, "install", line),
		...(runtime.packageRunner === undefined
			? {}
			: { runner: runtime.packageRunner }),
		...(runtime.executableAvailable === undefined
			? {}
			: { executableAvailable: runtime.executableAvailable }),
	});
	reportProgress(runtime.onProgress, {
		command: "install",
		phase: "packages",
		kind: "phase",
		status: "SUCCEEDED",
		message: "依赖同步完成",
	});
	await recordPnpmPolicyOwnership(root, pnpmPolicyBefore);
	await validateInstalledPackageSet(
		root,
		discovered.candidates,
		previousManaged,
	);
	const { catalog, modules } = await buildContext(root);
	reportProgress(runtime.onProgress, {
		command: "install",
		phase: "validation",
		kind: "phase",
		status: "SUCCEEDED",
		message: `已验证 ${modules.length} 个已安装模块`,
	});
	const moduleInstall = await installModulesThin(
		catalog,
		modules,
		root,
		runtime.onProgress,
	);
	return outcome("install", batchStatus(moduleInstall), root, {
		registry: discovered.registry,
		packageManager: mutation.packageManager,
		packages: discovered.candidates.map((item) => ({
			packageName: item.packageName,
			version: item.moduleVersion,
		})),
		workspace: metadata,
		modules: moduleInstall,
		next: "platform status",
	});
}

const usefulPackageOutput =
	/(?:resolved|downloaded|reused|linked|added|removed|packages:|progress:|warn|warning|error|ERR_|done|completed|audited|changed)/i;

function reportPackageManagerOutput(
	runtime: CliRuntimeOptions,
	command: "install" | "uninstall",
	output: PackageCommandOutput,
) {
	if (!usefulPackageOutput.test(output.line)) return;
	reportProgress(runtime.onProgress, {
		command,
		phase: "packages",
		kind: "subprocess",
		status: /\b(?:warn|warning)\b/i.test(output.line)
			? "WARNING"
			: /(?:error|ERR_)/i.test(output.line)
				? "FAILED"
				: "STARTED",
		message: output.line,
	});
}
async function workspaceProFlowDependencies(root: string): Promise<string[]> {
	try {
		const parsed: unknown = JSON.parse(
			await readFile(resolve(root, "package.json"), "utf8"),
		);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
			return [];
		const record = parsed as Record<string, unknown>;
		const names = new Set<string>();
		for (const field of ["dependencies", "devDependencies"] as const) {
			const value = record[field];
			if (typeof value !== "object" || value === null || Array.isArray(value))
				continue;
			for (const name of Object.keys(value))
				if (name.startsWith(PRO_FLOW_PACKAGE_PREFIX)) names.add(name);
		}
		return [...names].sort();
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			Reflect.get(error, "code") === "ENOENT"
		)
			return [];
		throw new PlatformError(
			"INVALID_REQUEST",
			`cannot read Workspace package.json: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
async function handleUninstall(
	root: string,
	runtime: CliRuntimeOptions,
): Promise<CliOutcome> {
	const packageNames = await workspaceProFlowDependencies(root);
	const { catalog, modules } = await buildContext(root);
	const moduleUninstall = await uninstallModulesThin(
		catalog,
		modules,
		root,
		runtime.onProgress,
	);
	if (!moduleUninstall.completed)
		return outcome("uninstall", batchStatus(moduleUninstall), root, {
			modules: moduleUninstall,
			removed: [],
		});
	const mutation = await removeWorkspacePackages({
		workspaceRoot: root,
		packageNames,
		onOutput: (line) => reportPackageManagerOutput(runtime, "uninstall", line),
		...(runtime.packageRunner === undefined
			? {}
			: { runner: runtime.packageRunner }),
		...(runtime.executableAvailable === undefined
			? {}
			: { executableAvailable: runtime.executableAvailable }),
	});
	const cleanedPnpmPolicy = await cleanOwnedPnpmPolicy(root);
	return outcome("uninstall", "SUCCEEDED", root, {
		modules: moduleUninstall,
		packageManager: mutation.packageManager,
		removed: packageNames,
		cleanedPnpmPolicy,
		preserved: [".proflow"],
	});
}
async function handleSetup(
	root: string,
	parsed: ParsedArgs,
	runtime: CliRuntimeOptions,
): Promise<CliOutcome> {
	reportProgress(runtime.onProgress, {
		command: "setup",
		phase: "setup",
		status: "STARTED",
		message: "正在分析模块配置",
	});
	const { catalog, modules } = await buildContext(root);
	const target =
		parsed.moduleRef === undefined
			? undefined
			: { moduleRef: parsed.moduleRef };
	const result = await setupModulesThin(
		catalog,
		modules,
		root,
		target,
		undefined,
	);
	reportProgress(runtime.onProgress, {
		command: "setup",
		phase: "setup",
		status: result.completed ? "SUCCEEDED" : "ACTION_REQUIRED",
		message: result.completed ? "模块配置已就绪" : "配置清单已生成",
	});
	return outcome("setup", batchStatus(result), root, result);
}
async function handleStart(
	root: string,
	runtime: CliRuntimeOptions,
): Promise<CliOutcome> {
	const { catalog, modules } = await buildContext(root);
	const result = await startModulesThin(
		catalog,
		modules,
		root,
		runtime.onProgress,
	);
	return outcome("start", batchStatus(result), root, result);
}
async function handleStop(
	root: string,
	runtime: CliRuntimeOptions,
): Promise<CliOutcome> {
	const { catalog, modules } = await buildContext(root);
	const result = await stopModulesThin(
		catalog,
		modules,
		root,
		runtime.onProgress,
	);
	return outcome("stop", batchStatus(result), root, result);
}
function helpOutcome(): CliOutcome {
	return outcome("help", "SUCCEEDED", undefined, {
		usage:
			"platform <install|uninstall|status|setup|docs|start|stop> [--workspace <path>]",
		commands: [...COMMANDS],
		install: "platform install [--workspace <path>]",
		setup: "platform setup [--workspace <path>] [--module <moduleRef>]",
	});
}
export async function runCli(
	argv: readonly string[],
	runtime: CliRuntimeOptions = {},
): Promise<CliOutcome> {
	let parsed: ParsedArgs;
	try {
		parsed = parseArgs(argv);
	} catch (error) {
		const helpCommand = argv.find((value) =>
			COMMANDS.includes(value as Command),
		) as Command | undefined;
		return errorOutcome("unknown", error, "USAGE", helpCommand);
	}
	try {
		if (parsed.command === "help") return helpOutcome();
		if (parsed.command === "version")
			return outcome("version", "SUCCEEDED", undefined, {
				version: platformCliDescriptor.moduleVersion,
			});
		const root = await canonicalWorkspace(
			runtime.cwd ?? process.cwd(),
			parsed.workspace,
		);
		switch (parsed.command) {
			case "install":
				return await handleInstall(root, runtime);
			case "uninstall":
				return await handleUninstall(root, runtime);
			case "status":
				return await handleStatus(root, runtime);
			case "setup":
				return await handleSetup(root, parsed, runtime);
			case "docs":
				return await handleDocs(root, runtime);
			case "start":
				return await handleStart(root, runtime);
			case "stop":
				return await handleStop(root, runtime);
		}
	} catch (error) {
		return errorOutcome(parsed.command, error);
	}
}
function errorOutcome(
	command: string,
	error: unknown,
	category: "USAGE" | "OPERATION" = "OPERATION",
	helpCommand?: Command,
): CliOutcome {
	if (error instanceof PlatformError)
		return {
			command,
			status: "FAILED",
			error: {
				code: error.code,
				message: error.message,
				category,
				...(helpCommand === undefined ? {} : { helpCommand }),
			},
		};
	return {
		command,
		status: "FAILED",
		error: {
			code: "COMMAND_FAILED",
			message: error instanceof Error ? error.message : String(error),
			category,
		},
	};
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export interface HumanRenderOptions {
	color?: boolean;
	width?: number;
}

const ansi = {
	reset: "\u001b[0m",
	bold: "\u001b[1m",
	dim: "\u001b[2m",
	cyan: "\u001b[36m",
	blue: "\u001b[34m",
	green: "\u001b[32m",
	yellow: "\u001b[33m",
	red: "\u001b[31m",
} as const;

type Tone = keyof Omit<typeof ansi, "reset">;

function humanTheme(options: HumanRenderOptions = {}) {
	const enabled = options.color === true;
	const paint = (tone: Tone, value: string) =>
		enabled ? `${ansi[tone]}${value}${ansi.reset}` : value;
	return {
		width: Math.max(60, options.width ?? 100),
		paint,
		title: (value: string) => paint("bold", paint("cyan", value)),
		section: (value: string) => paint("bold", value),
		command: (value: string) => paint("blue", value),
		info: (value: string) => paint("blue", value),
		muted: (value: string) => paint("dim", value),
		success: (value: string) => paint("green", value),
		warning: (value: string) => paint("yellow", value),
		failure: (value: string) => paint("red", value),
	};
}

type HumanTheme = ReturnType<typeof humanTheme>;

function renderStatus(data: unknown, theme: HumanTheme) {
	if (!isRecord(data) || !Array.isArray(data.modules)) return "未发现模块。";
	const setupLabels: Record<string, string> = {
		READY: "已就绪",
		ACTION_REQUIRED: "需要操作",
		BLOCKED: "等待依赖",
		FAILED: "失败",
	};
	const runtimeLabels: Record<string, string> = {
		RUNNING: "运行中",
		STOPPED: "已停止",
		FAILED: "运行失败",
		NOT_APPLICABLE: "无独立进程",
	};
	const modules = data.modules.filter(isRecord);
	const failedModules = modules.filter(
		(item) => item.setupStatus === "FAILED" || item.runtimeStatus === "FAILED",
	);
	const actionModules = modules.filter(
		(item) =>
			item.setupStatus === "ACTION_REQUIRED" && item.runtimeStatus !== "FAILED",
	);
	const blockedModules = modules.filter(
		(item) => item.setupStatus === "BLOCKED" && item.runtimeStatus !== "FAILED",
	);
	const running = modules.filter(
		(item) => item.setupStatus === "READY" && item.runtimeStatus === "RUNNING",
	);
	const healthy = modules.filter(
		(item) =>
			item.setupStatus === "READY" &&
			item.runtimeStatus !== "RUNNING" &&
			item.runtimeStatus !== "FAILED",
	);
	const lines = [theme.title("ProFlow 状态"), ""];
	const renderProblems = (
		title: string,
		entries: Record<string, unknown>[],
		tone: (value: string) => string,
		icon: string,
	) => {
		if (entries.length === 0) return;
		lines.push(theme.section(title), "");
		for (const raw of entries) {
			const moduleRef = String(raw.moduleRef);
			const setupStatus = String(raw.setupStatus);
			const runtimeStatus = String(raw.runtimeStatus);
			lines.push(
				`${tone(icon)} ${theme.section(moduleRef)}  ${theme.muted(String(raw.version))}`,
			);
			lines.push(
				`  ${tone(setupLabels[setupStatus] ?? "未知")} · ${runtimeLabels[runtimeStatus] ?? "未知"}`,
			);
			const issues = Array.isArray(raw.issues)
				? raw.issues.filter(isRecord)
				: [];
			for (const issue of issues) {
				lines.push(`  原因：${String(issue.message)}`);
				if (
					Array.isArray(issue.relatedModuleRefs) &&
					issue.relatedModuleRefs.length > 0
				)
					lines.push(
						`  依赖：${issue.relatedModuleRefs.map(String).join("、")}`,
					);
				lines.push(`  下一步：${theme.command(String(issue.nextCommand))}`);
			}
			lines.push("");
		}
	};
	renderProblems("失败", failedModules, theme.failure, "✕");
	renderProblems("需要操作", actionModules, theme.warning, "◆");
	renderProblems("等待依赖", blockedModules, theme.info, "◇");
	const compact = (
		title: string,
		entries: Record<string, unknown>[],
		symbol: string,
	) => {
		if (entries.length === 0) return;
		lines.push(theme.section(title), "");
		for (const item of entries) {
			const runtime = runtimeLabels[String(item.runtimeStatus)] ?? "未知";
			lines.push(
				`${theme.success(symbol)} ${String(item.moduleRef).padEnd(32)} ${theme.muted(String(item.version).padEnd(9))} ${runtime}`,
			);
		}
		lines.push("");
	};
	compact("运行中", running, "●");
	compact("已就绪", healthy, "○");
	const ready = modules.filter((item) => item.setupStatus === "READY").length;
	const action = modules.filter(
		(item) => item.setupStatus === "ACTION_REQUIRED",
	).length;
	const failed = modules.filter((item) => item.setupStatus === "FAILED").length;
	const blocked = modules.filter(
		(item) => item.setupStatus === "BLOCKED",
	).length;
	lines.push(
		theme.section("汇总"),
		`${theme.success(`${ready} 已就绪`)} · ${theme.warning(`${action} 需要操作`)} · ${theme.info(`${blocked} 等待依赖`)} · ${failed > 0 ? theme.failure(`${failed} 失败`) : `${failed} 失败`}`,
	);
	return lines.join("\n");
}

function renderTerminalMarkdown(source: string, theme: HumanTheme): string {
	let inCode = false;
	return source
		.split(/\r?\n/)
		.map((line) => {
			if (line.trim().startsWith("```")) {
				inCode = !inCode;
				return "";
			}
			if (inCode) return `  ${theme.command(line)}`;
			const heading = line.match(/^(#{1,6})\s+(.+)$/);
			if (heading?.[2])
				return heading[1]?.length === 1
					? theme.title(heading[2].replaceAll("`", ""))
					: theme.section(heading[2].replaceAll("`", ""));
			const bullet = line.match(/^\s*[-*]\s+(.+)$/);
			if (bullet?.[1]) return `  ${theme.paint("cyan", "•")} ${bullet[1]}`;
			if (/^\|.*\|$/.test(line)) return theme.muted(line);
			return line.replace(/`([^`]+)`/g, (_match, code: string) =>
				theme.command(code),
			);
		})
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
function renderDocs(data: unknown, theme: HumanTheme) {
	if (!isRecord(data) || !Array.isArray(data.modules))
		return "未发现模块文档。";
	const lines = [theme.title("ProFlow 模块文档")];
	for (const raw of data.modules)
		if (isRecord(raw))
			lines.push(
				"",
				theme.muted("─".repeat(Math.min(theme.width, 96))),
				`${theme.section(String(raw.moduleRef))}  ${theme.muted(String(raw.version))}`,
				"",
				renderTerminalMarkdown(String(raw.docs ?? ""), theme),
			);
	if (Array.isArray(data.errors) && data.errors.length > 0)
		lines.push(
			"",
			"文档读取失败：",
			...data.errors
				.filter(isRecord)
				.map((item) => `- ${String(item.moduleRef)}：${String(item.reason)}`),
		);
	return lines.join("\n");
}
const setupCommands: Record<string, { ai: string; inputs: string }> = {
	"chatgpt-carrier": {
		ai: "pnpm exec -- proflow-chatgpt-carrier setup --carrier-url <url>",
		inputs: "Custom GPT URL",
	},
	"dev-tunnel": {
		ai: "pnpm exec -- proflow-dev-tunnel setup --tunnel-id <id> --public-base-url <url>",
		inputs: "Tunnel ID、公开 HTTPS URL",
	},
	"model-provider-api": {
		ai: "pnpm exec -- proflow-model-provider-api setup --provider-base-url <url>",
		inputs: "模型服务 Base URL",
	},
	"model-runtime": {
		ai: "pnpm exec -- proflow-model-runtime setup --fast-model <id> --reason-model <id>",
		inputs: "FAST 模型 ID、REASON 模型 ID",
	},
	"execution-browser-extension": {
		ai: "pnpm exec -- proflow-execution-browser-extension setup",
		inputs: "无",
	},
	"agent-controller-dev": {
		ai: "pnpm exec -- proflow-agent-controller-dev setup --carrier-url <url>",
		inputs: "Custom GPT URL",
	},
	"agent-product": {
		ai: "pnpm exec -- proflow-agent-product setup --carrier-url <url>",
		inputs: "Custom GPT URL",
	},
	"agent-test-ops": {
		ai: "pnpm exec -- proflow-agent-test-ops setup --carrier-url <url>",
		inputs: "Custom GPT URL",
	},
};
function renderSetup(data: unknown, theme: HumanTheme) {
	if (!isRecord(data) || !Array.isArray(data.results))
		return "没有需要执行的配置步骤。";
	const lines = [theme.title("ProFlow 配置"), ""];
	const skipped = Array.isArray(data.skipped) ? data.skipped : [];
	let ready = skipped.filter(
		(item) => isRecord(item) && item.reason === "READY",
	).length;
	let needsAction = 0;
	let blocked = 0;
	for (const raw of data.results) {
		if (!isRecord(raw) || !isRecord(raw.result)) continue;
		const moduleRef = String(
			raw.moduleRef ?? raw.result.moduleRef ?? "unknown",
		);
		const status = String(raw.result.status ?? "UNKNOWN");
		if (status === "SUCCEEDED") {
			ready += 1;
			continue;
		}
		if (status === "FAILED") blocked += 1;
		else needsAction += 1;
		lines.push(
			`${status === "FAILED" ? theme.failure("✕") : theme.warning("◆")} ${theme.section(moduleRef)}`,
		);
		const plan = moduleSetupPlanDataSchema.safeParse(raw.result.data);
		if (plan.success) {
			for (const [index, step] of plan.data.steps.entries()) {
				const marker =
					step.state === "DONE"
						? theme.success("✓")
						: step.state === "BLOCKED"
							? theme.failure("✕")
							: index ===
									plan.data.steps.findIndex((item) => item.state === "TODO")
								? theme.warning("→")
								: theme.muted("○");
				lines.push(
					`  ${marker} ${String(index + 1).padStart(2, "0")}  ${step.title}`,
				);
				if (step.description) lines.push(`       ${step.description}`);
				lines.push(`       运行：${theme.command(step.execution.interactive)}`);
				lines.push(
					`       AI：${theme.command(step.execution.nonInteractive)}`,
				);
				if (step.requiredInputs.length > 0)
					lines.push(
						`       需要：${step.requiredInputs.map((item) => item.description).join("、")}`,
					);
				if (step.humanAction)
					lines.push(`       人工操作：${step.humanAction}`);
				lines.push(`       验证：${theme.command(step.verify)}`);
				lines.push(`       完成：${step.successCondition}`);
				if (step.blockedReason)
					lines.push(`       原因：${theme.failure(step.blockedReason)}`);
			}
			lines.push("");
			continue;
		}
		lines.push(
			`  1. ${status === "FAILED" ? "等待上游服务信息" : "完成模块配置"}`,
		);
		const error = raw.result.error;
		if (status !== "FAILED") {
			const commands = setupCommands[moduleRef] ?? {
				ai: `proflow-${moduleRef} setup`,
				inputs: "按命令提示提供",
			};
			lines.push(`  人工执行：pnpm exec -- proflow-${moduleRef} setup`);
			lines.push(`  AI 执行：${commands.ai}`);
			lines.push(`  需要输入：${commands.inputs}`);
			lines.push(`  验证：proflow-${moduleRef} verify`);
			lines.push("  完成条件：配置状态变为“已就绪”");
		} else if (isRecord(error)) {
			const code = error.code === undefined ? "FAILED" : String(error.code);
			const message =
				error.message === undefined
					? "Module setup failed."
					: String(error.message);
			lines.push(`  原因：${code} — ${message}`);
			lines.push(`  执行：platform setup --module ${moduleRef}`);
			lines.push("  完成条件：配置状态变为“已就绪”");
		}
		lines.push("");
	}
	if (needsAction === 0 && blocked === 0) lines.push("全部模块均已就绪。");
	lines.push(
		theme.section("汇总"),
		`汇总：${theme.success(`${ready} 个已就绪`)}，${theme.warning(`${needsAction} 个需要操作`)}，${blocked > 0 ? theme.failure(`${blocked} 个系统阻塞`) : `${blocked} 个系统阻塞`}`,
	);
	return lines.join("\n").trimEnd();
}

function renderHelp(theme: HumanTheme, command?: Command): string {
	const commandHelp: Record<Command, { usage: string; description: string }> = {
		install: {
			usage: "platform install [--workspace <路径>]",
			description: "安装并初始化全部 ProFlow 模块",
		},
		uninstall: {
			usage: "platform uninstall [--workspace <路径>]",
			description: "卸载模块包，保留 Workspace 数据",
		},
		status: {
			usage: "platform status [--workspace <路径>]",
			description: "查看模块配置与运行状态",
		},
		setup: {
			usage: "platform setup [--workspace <路径>] [--module <模块名>]",
			description: "自动配置并列出全部剩余步骤",
		},
		docs: {
			usage: "platform docs [--workspace <路径>]",
			description: "阅读全部模块能力文档",
		},
		start: {
			usage: "platform start [--workspace <路径>]",
			description: "完成全量检查后启动平台",
		},
		stop: {
			usage: "platform stop [--workspace <路径>]",
			description: "按逆依赖顺序停止平台",
		},
	};
	if (command) {
		const item = commandHelp[command];
		return [
			theme.title(`platform ${command}`),
			item.description,
			"",
			theme.section("用法"),
			`  ${theme.command(item.usage)}`,
			"",
			theme.section("帮助"),
			`  ${theme.command(`platform ${command} --help`)}`,
		].join("\n");
	}
	return [
		theme.title("ProFlow 平台命令行"),
		"管理 ProFlow 模块的安装、配置、文档和运行生命周期。",
		"",
		theme.section("用法"),
		`  ${theme.command("platform <command> [--workspace <路径>]")}`,
		"",
		theme.section("命令"),
		...Object.entries(commandHelp).map(
			([name, item]) =>
				`  ${theme.command(`platform ${name}`.padEnd(21))}${item.description}`,
		),
		"",
		theme.section("公共参数"),
		"  --workspace <路径>       指定 ProFlow Workspace",
		"  setup --module <模块名>  只查看指定模块的配置步骤",
		"  -h, --help               显示帮助",
		"  -v, --version            显示版本",
		"",
		theme.section("推荐流程"),
		`  ${theme.command("install → status → docs → setup → start → status → stop")}`,
		"",
		theme.section("人工配置示例"),
		`  人工：${theme.command("pnpm exec -- proflow-chatgpt-carrier setup")}`,
		`  AI：  ${theme.command("pnpm exec -- proflow-chatgpt-carrier setup")}`,
		`        ${theme.command("--carrier-url <url>")}`,
		"",
		theme.section("状态图例"),
		`  ${theme.success("已就绪")}    配置与验证完成`,
		`  ${theme.warning("需要操作")}  需要执行 setup 步骤`,
		`  ${theme.info("等待依赖")}  等待上游 Module 或外部服务`,
		`  ${theme.failure("失败")}      已确认配置或运行故障`,
		"  运行中    服务进程正在运行",
		"  无独立进程 该模块无需启动",
		"",
		theme.section("遇到问题"),
		`  先运行 ${theme.command("platform status")}；配置问题运行 ${theme.command("platform setup")}。`,
	].join("\n");
}
export function renderHumanResult(
	result: CliOutcome,
	options: HumanRenderOptions = {},
): string {
	const theme = humanTheme(options);
	if (
		result.command === "setup" &&
		isRecord(result.data) &&
		Array.isArray(result.data.results)
	)
		return renderSetup(result.data, theme);
	if (result.command === "start" && isRecord(result.data)) {
		const blockers = Array.isArray(result.data.blockers)
			? result.data.blockers.filter(isRecord)
			: [];
		if (blockers.length > 0) {
			const groups = [
				{ status: "FAILED", title: "失败", icon: "✕", tone: theme.failure },
				{
					status: "ACTION_REQUIRED",
					title: "需要操作",
					icon: "◆",
					tone: theme.warning,
				},
				{ status: "BLOCKED", title: "等待依赖", icon: "◇", tone: theme.info },
			];
			const lines = [theme.failure("平台未启动：存在未就绪模块"), ""];
			for (const group of groups) {
				const entries = blockers.filter(
					(item) => item.setupStatus === group.status,
				);
				if (entries.length === 0) continue;
				lines.push(theme.section(group.title));
				for (const item of entries)
					lines.push(
						`${group.tone(group.icon)} ${theme.section(String(item.moduleRef))}`,
						`  原因：${typeof item.reason === "string" ? item.reason : "模块尚未就绪"}`,
						`  下一步：${theme.command(typeof item.nextCommand === "string" ? item.nextCommand : `platform setup --module ${String(item.moduleRef)}`)}`,
					);
				lines.push("");
			}
			const readyCount = Array.isArray(result.data.results)
				? result.data.results.filter(
						(item) =>
							isRecord(item) &&
							isRecord(item.result) &&
							item.result.status === "SUCCEEDED",
					).length - blockers.length
				: 0;
			lines.push(
				theme.section("检查汇总"),
				`${Math.max(0, readyCount)} 已就绪 · ${blockers.length} 未就绪 · 0 个模块已启动`,
				`处理方式：${theme.command(`platform setup${result.workspaceRoot ? ` --workspace "${result.workspaceRoot}"` : ""}`)}`,
			);
			return lines.join("\n");
		}
	}
	if (result.status === "FAILED" && result.error)
		return [
			theme.failure(`╭─ ${result.command} 执行失败`),
			`${theme.failure("│")} ${theme.section(result.error.code)}`,
			`${theme.failure("│")} ${result.error.message}`,
			theme.failure("╰─ 请根据提示修复后重试"),
			...(result.error.category === "USAGE"
				? ["", renderHelp(theme, result.error.helpCommand)]
				: []),
		].join("\n");
	if (result.command === "help") return renderHelp(theme);
	if (result.command === "version" && isRecord(result.data))
		return String(result.data.version ?? platformCliDescriptor.moduleVersion);
	if (result.command === "status") return renderStatus(result.data, theme);
	if (result.command === "setup") return renderSetup(result.data, theme);
	if (result.command === "docs") return renderDocs(result.data, theme);
	if (
		(result.command === "start" || result.command === "stop") &&
		isRecord(result.data)
	) {
		const skippedItems = Array.isArray(result.data.skipped)
			? result.data.skipped.filter(isRecord)
			: [];
		const skippedRefs = new Set(
			skippedItems.map((item) => String(item.moduleRef)),
		);
		const skipped = skippedItems.length;
		const results = Array.isArray(result.data.results)
			? result.data.results.filter(isRecord)
			: [];
		const operations = results.filter(
			(item) => item.command === result.command,
		);
		const succeeded = operations.filter(
			(item) =>
				isRecord(item.result) &&
				item.result.status === "SUCCEEDED" &&
				!skippedRefs.has(String(item.moduleRef)),
		).length;
		const failed = operations.find(
			(item) => isRecord(item.result) && item.result.status !== "SUCCEEDED",
		);
		return [
			failed
				? theme.failure(
						`平台${result.command === "start" ? "启动" : "停止"}未完成`,
					)
				: theme.success(
						`✓ 平台${result.command === "start" ? "启动" : "停止"}完成`,
					),
			`${theme.success(`成功：${succeeded}`)}  ${theme.muted(`跳过：${skipped}`)}  ${failed ? theme.failure(`失败：${String(failed.moduleRef)}`) : theme.muted("失败：0")}`,
		].join("\n");
	}
	const labels: Record<string, string> = {
		install: "安装",
		uninstall: "卸载",
		start: "启动",
		stop: "停止",
	};
	if (result.command === "uninstall" && result.status === "SUCCEEDED")
		return `${theme.success("✓ 已经卸载")}${result.workspaceRoot ? `\n${theme.muted("Workspace")}  ${result.workspaceRoot}` : ""}`;
	return `${result.status === "SUCCEEDED" ? theme.success("✓") : theme.failure("✕")} ${labels[result.command] ?? result.command}${result.status === "SUCCEEDED" ? "成功" : "未完成"}${result.workspaceRoot ? `\n${theme.muted("Workspace")}  ${result.workspaceRoot}` : ""}`;
}
if (import.meta.main) {
	const argv = process.argv.slice(2);
	const reporter = createTerminalProgressReporter();
	const result = await runCli(argv, { onProgress: reporter });
	reporter.close();
	const color =
		process.stdout.isTTY === true &&
		process.env.NO_COLOR === undefined &&
		process.env.TERM !== "dumb";
	const rendered = `${renderHumanResult(result, {
		color,
		width: process.stdout.columns,
	})}\n`;
	process.stdout.write(rendered);
	if (result.status !== "SUCCEEDED") process.exitCode = 1;
}
