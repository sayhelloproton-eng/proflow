#!/usr/bin/env node

import { readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
	moduleDocsDataSchema,
	moduleSetupPlanDataSchema,
	moduleStatusObservationSchema,
} from "@tomflow/proflow-module-contract";
import { descriptor as platformCliDescriptor } from "../deployment/descriptor.ts";
import { FROZEN_DEPLOYMENT_INSTALL_ORDER } from "./deployment-order.ts";
import { AutoModuleCatalog, discoverModules } from "./discovery/discover.ts";
import { InstalledModuleCatalog } from "./discovery/installed.ts";
import { PlatformError } from "./errors.ts";
import {
	observeWorkspaceInstalledVersion,
	type PackageCommandOutput,
	type PackageCommandRunner,
	preflightWorkspacePackageManager,
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
import { ensureWorkspaceStateIsGitIgnored } from "./persistence/git-isolation.ts";
import {
	clearStartOwner,
	registerStartOwner,
	requestStartOwnerStop,
} from "./persistence/start-owner.ts";
import { ensureWorkspaceMetadata } from "./persistence/workspace-metadata.ts";
import { type PlatformProgressReporter, reportProgress } from "./progress.ts";
import {
	discoverRegistryModules,
	type NpmCommandRunner,
	PRO_FLOW_PACKAGE_PREFIX,
} from "./registry/index.ts";
import {
	createClackSetupInteraction,
	type SetupInteraction,
} from "./setup/interaction.ts";
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
	setupInteraction?: SetupInteraction;
}
interface ParsedArgs {
	command: Command | "help" | "version";
	workspace?: string;
	moduleRef?: string;
}

function editDistance(left: string, right: string): number {
	const previous = Array.from(
		{ length: right.length + 1 },
		(_, index) => index,
	);
	for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
		const current = [leftIndex];
		for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
			current[rightIndex] = Math.min(
				(current[rightIndex - 1] ?? 0) + 1,
				(previous[rightIndex] ?? 0) + 1,
				(previous[rightIndex - 1] ?? 0) +
					(left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
			);
		}
		previous.splice(0, previous.length, ...current);
	}
	return previous[right.length] ?? Number.POSITIVE_INFINITY;
}

function commandSuggestion(raw: string): Command | undefined {
	const ranked = COMMANDS.map((command) => ({
		command,
		distance: editDistance(raw.toLowerCase(), command),
	})).sort((left, right) => left.distance - right.distance);
	return ranked[0] && ranked[0].distance <= 2 ? ranked[0].command : undefined;
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
	if (!COMMANDS.includes(raw as Command)) {
		const suggestion = commandSuggestion(raw);
		throw new PlatformError(
			"INVALID_REQUEST",
			suggestion
				? `未知命令 ${raw}。你是否想运行 platform ${suggestion}？`
				: `未知命令 ${raw}。运行 platform --help 查看可用命令。`,
		);
	}
	const command = raw as Command;
	if (moduleRef !== undefined && command !== "setup" && command !== "docs")
		throw new PlatformError(
			"INVALID_REQUEST",
			"--module is only valid with setup or docs",
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
function missingFrozenModules(
	modules: readonly { moduleRef: string }[],
): string[] {
	const observed = new Set(modules.map((module) => module.moduleRef));
	const hasCurrentPlatformSurface = FROZEN_DEPLOYMENT_INSTALL_ORDER.some(
		(moduleRef) => observed.has(moduleRef),
	);
	if (!hasCurrentPlatformSurface) return [];
	return FROZEN_DEPLOYMENT_INSTALL_ORDER.filter(
		(moduleRef) => !observed.has(moduleRef),
	);
}

function assertInstalledModules(
	modules: readonly { moduleRef: string }[],
): void {
	if (modules.length === 0)
		throw new PlatformError(
			"PLATFORM_NOT_INSTALLED",
			"ProFlow 尚未安装。请先运行 platform install。",
		);
	const missing = missingFrozenModules(modules);
	if (missing.length > 0)
		throw new PlatformError(
			"PLATFORM_INSTALL_INCOMPLETE",
			`ProFlow 安装不完整，缺少 ${missing.length} 个核心模块。请重新运行 platform install。`,
		);
}

async function collectModuleStatuses(
	catalog: AutoModuleCatalog,
	modules: Awaited<ReturnType<typeof discoverModules>>,
	root: string,
) {
	const observed = await observeStatuses(catalog, modules, root);
	const byRef = new Map(modules.map((module) => [module.moduleRef, module]));
	return observed.map((item) => {
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
			...(item.externalAvailabilityClaim === undefined
				? {}
				: { externalAvailabilityClaim: item.externalAvailabilityClaim }),
		};
	});
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
	if (modules.length === 0) {
		reportProgress(runtime.onProgress, {
			command: "status",
			phase: "status",
			status: "SUCCEEDED",
			message: "ProFlow 尚未安装",
		});
		return outcome("status", "SUCCEEDED", root, {
			installed: false,
			installState: "NOT_INSTALLED",
			modules: [],
		});
	}
	const missing = missingFrozenModules(modules);
	if (missing.length > 0) {
		reportProgress(runtime.onProgress, {
			command: "status",
			phase: "status",
			status: "SUCCEEDED",
			message: `ProFlow 安装不完整，缺少 ${missing.length} 个核心模块`,
		});
		return outcome("status", "SUCCEEDED", root, {
			installed: true,
			installState: "INCOMPLETE",
			missingModules: missing,
			modules: [],
		});
	}
	const output = await collectModuleStatuses(catalog, modules, root);
	reportProgress(runtime.onProgress, {
		command: "status",
		phase: "status",
		status: "SUCCEEDED",
		message: `已读取 ${output.length} 个模块状态`,
	});
	return outcome("status", "SUCCEEDED", root, {
		installed: true,
		modules: output,
	});
}
async function handleDocs(
	root: string,
	parsed: ParsedArgs,
	runtime: CliRuntimeOptions,
): Promise<CliOutcome> {
	reportProgress(runtime.onProgress, {
		command: "docs",
		phase: "docs",
		status: "STARTED",
		message: "正在整理模块文档",
	});
	const { catalog, modules: resolvedModules } = await buildContext(root);
	const selectedModules =
		parsed.moduleRef === undefined
			? resolvedModules
			: resolvedModules.filter((item) => item.moduleRef === parsed.moduleRef);
	if (parsed.moduleRef !== undefined && selectedModules.length === 0)
		throw new PlatformError(
			"INVALID_REQUEST",
			`docs target module ${parsed.moduleRef} was not discovered`,
		);
	if (parsed.moduleRef === undefined) {
		reportProgress(runtime.onProgress, {
			command: "docs",
			phase: "docs",
			status: "SUCCEEDED",
			message: `已整理 ${selectedModules.length} 个模块的文档索引`,
		});
		return outcome("docs", "SUCCEEDED", root, {
			indexOnly: true,
			modules: selectedModules.map((module) => ({
				moduleRef: module.moduleRef,
				version: module.moduleVersion,
			})),
			errors: [],
		});
	}
	const docs = await observeDocs(catalog, selectedModules, root);
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
	const observedVersions = await Promise.all(
		candidates.map((candidate) =>
			observeWorkspaceInstalledVersion(root, candidate.packageName),
		),
	);
	for (const [index, candidate] of candidates.entries()) {
		const observed = observedVersions[index];
		if (observed !== candidate.moduleVersion)
			throw new PlatformError(
				"COMMAND_FAILED",
				`installed version mismatch for ${candidate.packageName}: expected ${candidate.moduleVersion}, observed ${observed ?? "missing"}`,
			);
	}
	const staleNames = previousManaged.filter(
		(name) => !expectedNames.includes(name),
	);
	const staleVersions = await Promise.all(
		staleNames.map((name) => observeWorkspaceInstalledVersion(root, name)),
	);
	for (const [index, stale] of staleNames.entries())
		if (staleVersions[index] !== undefined)
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
	return { catalog, modules };
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
	const gitIsolation = await ensureWorkspaceStateIsGitIgnored(root);
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
				message: `Registry 返回 ${total} 个候选模块，正在做安装前核验`,
			}),
		onPackageChecked: ({ current, total, packageName }) =>
			reportProgress(runtime.onProgress, {
				command: "install",
				phase: "registry",
				kind: "detail",
				retention: "REPLACE",
				status: "SUCCEEDED",
				current,
				total,
				moduleRef: packageName.replace(PRO_FLOW_PACKAGE_PREFIX, ""),
				message: `安装前核验 ${packageName.replace(PRO_FLOW_PACKAGE_PREFIX, "")}`,
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
	const { catalog, modules } = await validateInstalledPackageSet(
		root,
		discovered.candidates,
		previousManaged,
	);
	assertInstalledModules(modules);
	reportProgress(runtime.onProgress, {
		command: "install",
		phase: "validation",
		kind: "phase",
		status: "SUCCEEDED",
		message: `安装完成，${modules.length} 个模块已从本地安装物验证`,
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
		gitIsolation,
		modules: moduleInstall,
		next: "platform status",
	});
}

const usefulPackageOutput = /(?:warn|warning|error|ERR_)/i;

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
	if (packageNames.length > 0)
		await preflightWorkspacePackageManager(root, runtime.executableAvailable);
	reportProgress(runtime.onProgress, {
		command: "uninstall",
		phase: "owner",
		status: "STARTED",
		message: "正在停止当前平台运行进程",
	});
	const ownerStop = await requestStartOwnerStop(root);
	if (ownerStop === "UNVERIFIED" || ownerStop === "TIMEOUT")
		throw new PlatformError(
			"COMMAND_FAILED",
			ownerStop === "TIMEOUT"
				? "平台运行进程未能在卸载前停止。未修改安装物。"
				: "无法验证当前平台运行进程归属。未修改安装物。",
		);
	reportProgress(runtime.onProgress, {
		command: "uninstall",
		phase: "owner",
		status: "SUCCEEDED",
		message:
			ownerStop === "STOPPED" ? "已停止运行中的 ProFlow" : "未发现运行中的 ProFlow",
	});
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
	assertInstalledModules(modules);
	const interaction = runtime.setupInteraction;
	const inputByModule = new Map<string, Record<string, unknown>>();
	const approvedSteps = new Set<string>();
	const confirmSetupStep = interaction?.confirmStep
		? async (moduleRef: string) => {
				if (approvedSteps.has(moduleRef)) return;
				if (!(await interaction.confirmStep?.(moduleRef)))
					throw new PlatformError("INVALID_REQUEST", "配置已取消");
				approvedSteps.add(moduleRef);
			}
		: undefined;
	if (interaction) interaction.begin();
	let target: { moduleRef: string; input?: unknown } | undefined =
		parsed.moduleRef === undefined
			? undefined
			: { moduleRef: parsed.moduleRef };
	let result = await setupModulesThin(
		catalog,
		modules,
		root,
		target,
		runtime.onProgress,
		confirmSetupStep,
	);
	for (
		let attempt = 0;
		interaction && !result.completed && attempt < 8;
		attempt += 1
	) {
		const actionable = [...result.results]
			.reverse()
			.find((item) => item.result.status === "ACTION_REQUIRED");
		const action = actionable?.result.actionRequired;
		if (!actionable || !action) break;
		const actionData = isRecord(actionable.result.data)
			? actionable.result.data
			: undefined;
		const options = Array.isArray(actionData?.candidates)
			? actionData.candidates.filter(
					(item): item is string => typeof item === "string",
				)
			: undefined;
		const collected = await interaction.collect({
			moduleRef: actionable.moduleRef,
			action: action.action,
			description: action.description,
			...(options?.length ? { options } : {}),
		});
		if (!collected) break;
		const previous = inputByModule.get(actionable.moduleRef) ?? {};
		const input = { ...previous, ...collected };
		inputByModule.set(actionable.moduleRef, input);
		const targeted = await setupModulesThin(
			catalog,
			modules,
			root,
			{ moduleRef: actionable.moduleRef, input },
			runtime.onProgress,
			confirmSetupStep,
		);
		if (parsed.moduleRef !== undefined || !targeted.completed) {
			result = targeted;
			target = { moduleRef: actionable.moduleRef, input };
			continue;
		}
		target = undefined;
		result = await setupModulesThin(
			catalog,
			modules,
			root,
			undefined,
			runtime.onProgress,
			confirmSetupStep,
		);
	}
	if (interaction && result.completed) interaction.finish("配置已完成");
	reportProgress(runtime.onProgress, {
		command: "setup",
		phase: "setup",
		status: result.completed ? "SUCCEEDED" : "ACTION_REQUIRED",
		message: result.completed ? "模块配置已就绪" : "配置清单已生成",
	});
	const moduleStatuses = await collectModuleStatuses(catalog, modules, root);
	return outcome("setup", batchStatus(result), root, {
		...result,
		moduleStatuses,
		...(parsed.moduleRef === undefined
			? {}
			: { targetModuleRef: parsed.moduleRef }),
	});
}
async function handleStart(
	root: string,
	runtime: CliRuntimeOptions,
): Promise<CliOutcome> {
	const { catalog, modules } = await buildContext(root);
	assertInstalledModules(modules);
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
				return await handleDocs(root, parsed, runtime);
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

type JourneyState = "READY" | "ACTION_REQUIRED" | "BLOCKED" | "FAILED";
type JourneyStep = {
	label: string;
	state: JourneyState;
	modules: Record<string, unknown>[];
	issue?: Record<string, unknown>;
};

function journeyState(entries: Record<string, unknown>[]): JourneyState {
	if (
		entries.length === 0 ||
		entries.some(
			(item) =>
				item.setupStatus === "FAILED" || item.runtimeStatus === "FAILED",
		)
	)
		return "FAILED";
	if (entries.some((item) => item.setupStatus === "ACTION_REQUIRED"))
		return "ACTION_REQUIRED";
	if (entries.some((item) => item.setupStatus === "BLOCKED")) return "BLOCKED";
	return entries.every((item) => item.setupStatus === "READY")
		? "READY"
		: "BLOCKED";
}

function setupJourney(modules: Record<string, unknown>[]): JourneyStep[] {
	const byRef = new Map(modules.map((item) => [String(item.moduleRef), item]));
	return [
		{ label: "浏览器扩展", refs: ["execution-browser-extension"] },
		{ label: "远程连接", refs: ["dev-tunnel"] },
		{
			label: "模型服务与 FAST / THINK",
			refs: ["model-provider-api", "model-runtime"],
		},
	].map(({ label, refs }) => {
		const entries = refs.flatMap((ref) => {
			const item = byRef.get(ref);
			return item ? [item] : [];
		});
		const issues = entries.flatMap((item) =>
			Array.isArray(item.issues) ? item.issues.filter(isRecord) : [],
		);
		return {
			label,
			state: journeyState(entries),
			modules: entries,
			...(issues[0] ? { issue: issues[0] } : {}),
		};
	});
}

function renderStatus(data: unknown, theme: HumanTheme) {
	if (!isRecord(data) || !Array.isArray(data.modules)) return "无法读取状态。";
	const modules = data.modules.filter(isRecord);
	if (data.installState === "INCOMPLETE") {
		const missing = Array.isArray(data.missingModules)
			? data.missingModules.filter(
					(item): item is string => typeof item === "string",
				)
			: [];
		return [
			theme.title("ProFlow 状态"),
			"",
			theme.warning("ProFlow 安装不完整。"),
			...(missing.length > 0 ? [`缺少 ${missing.length} 个核心模块。`] : []),
			`下一步：${theme.command("platform install")}`,
			"",
			"PLATFORM_READY=NO",
		].join("\n");
	}
	if (data.installed === false || modules.length === 0)
		return [
			theme.title("ProFlow 状态"),
			"",
			theme.warning("ProFlow 尚未安装。"),
			`下一步：${theme.command("platform install")}`,
			"",
			"PLATFORM_READY=NO",
		].join("\n");
	const journey = setupJourney(modules);
	const completed = journey.filter((step) => step.state === "READY").length;
	const current = journey.find((step) => step.state !== "READY");
	const platformReady = modules.every(
		(item) => item.setupStatus === "READY" && item.runtimeStatus !== "FAILED",
	);
	const internalProblem = modules.find(
		(item) => item.setupStatus !== "READY" || item.runtimeStatus === "FAILED",
	);
	const lines = [
		theme.title("ProFlow 状态"),
		"",
		`${theme.section("配置进度")}  ${completed}/3`,
		...journey.map((step, index) => {
			const marker =
				step.state === "READY"
					? theme.success("✓")
					: step === current
						? step.state === "FAILED"
							? theme.failure("✕")
							: theme.warning("→")
						: theme.muted("○");
			const label =
				step.state === "READY"
					? "已完成"
					: step === current
						? step.state === "FAILED"
							? "验证失败"
							: "当前步骤"
						: "后续步骤";
			return `${marker} ${index + 1}/3 ${step.label} · ${label}`;
		}),
	];
	if (current) {
		lines.push("", theme.section(`当前处理：${current.label}`));
		if (current.issue?.message)
			lines.push(`原因：${String(current.issue.message)}`);
		lines.push(`下一步：${theme.command("platform setup")}`);
	} else {
		lines.push("", theme.success("三个核心配置步骤均已完成。"));
		if (internalProblem) {
			const issue = Array.isArray(internalProblem.issues)
				? internalProblem.issues.filter(isRecord)[0]
				: undefined;
			lines.push(
				theme.warning("仍有内部能力尚未闭环。"),
				...(issue?.message ? [`原因：${String(issue.message)}`] : []),
				`下一步：${theme.command("platform setup")}`,
			);
		}
	}
	lines.push("", `PLATFORM_READY=${platformReady ? "YES" : "NO"}`);
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
	if (data.indexOnly === true) {
		return [
			theme.title("ProFlow 帮助"),
			"",
			"ProFlow 会自动完成内部模块的安装、依赖准备和验证。",
			"",
			theme.section("推荐流程"),
			`  ${theme.command("platform install")}`,
			`  ${theme.command("platform setup")}`,
			`  ${theme.command("platform start")}`,
			"",
			theme.section("当前需要帮助？"),
			`  运行 ${theme.command("platform status")} 查看唯一的下一步。`,
			`  配置未完成时运行 ${theme.command("platform setup")} 继续向导。`,
		].join("\n");
	}
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
const setupModuleLabels: Record<string, string> = {
	"execution-browser-extension": "浏览器扩展",
	"dev-tunnel": "远程连接",
	"model-provider-api": "模型服务",
	"model-runtime": "FAST / THINK 模型",
};

const setupModuleLabel = (moduleRef: string) =>
	setupModuleLabels[moduleRef] ?? moduleRef;
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
	const renderedModuleRefs = new Set<string>();
	for (const raw of data.results) {
		if (!isRecord(raw) || !isRecord(raw.result)) continue;
		const moduleRef = String(
			raw.moduleRef ?? raw.result.moduleRef ?? "unknown",
		);
		renderedModuleRefs.add(moduleRef);
		const status = String(raw.result.status ?? "UNKNOWN");
		if (status === "SUCCEEDED") {
			ready += 1;
			continue;
		}
		if (status === "FAILED") blocked += 1;
		else needsAction += 1;
		lines.push(
			`${status === "FAILED" ? theme.failure("✕") : theme.warning("◆")} ${theme.section(setupModuleLabel(moduleRef))}`,
		);
		const planData =
			isRecord(raw.result.data) && Array.isArray(raw.result.data.steps)
				? { steps: raw.result.data.steps }
				: raw.result.data;
		const plan = moduleSetupPlanDataSchema.safeParse(planData);
		if (plan.success) {
			const currentStep =
				plan.data.steps.find((step) => step.state === "BLOCKED") ??
				plan.data.steps.find((step) => step.state === "TODO");
			for (const [index, step] of plan.data.steps.entries()) {
				if (step !== currentStep && step.state !== "DONE") continue;
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
				if (step.requiredInputs.length > 0)
					lines.push(
						`       需要：${step.requiredInputs.map((item) => item.description).join("、")}`,
					);
				if (step.humanAction)
					lines.push(`       人工操作：${step.humanAction}`);
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
			lines.push("  请在当前 Platform 向导中完成这一项。完成后会自动验证。");
		} else if (isRecord(error)) {
			const code = error.code === undefined ? "FAILED" : String(error.code);
			const message =
				error.message === undefined
					? "Module setup failed."
					: String(error.message);
			lines.push(`  原因：${code} — ${message}`);
			lines.push("  修复当前问题后重新运行 platform setup。");
		}
		lines.push("");
	}
	const dependencyBlockers = Array.isArray(data.blockers)
		? data.blockers.filter(isRecord)
		: [];
	for (const item of dependencyBlockers.slice(0, 1)) {
		const moduleRef = String(item.moduleRef ?? "unknown");
		if (renderedModuleRefs.has(moduleRef)) continue;
		blocked += 1;
		lines.push(
			`${theme.info("◇")} ${theme.section(setupModuleLabel(moduleRef))}`,
			`  原因：${typeof item.reason === "string" ? item.reason : "等待上游 Module 就绪"}`,
			`  下一步：${theme.command("platform setup")}`,
			"",
		);
	}
	const targetModuleRef =
		typeof data.targetModuleRef === "string" ? data.targetModuleRef : undefined;
	if (needsAction === 0 && blocked === 0)
		lines.push(
			targetModuleRef
				? `${setupModuleLabel(targetModuleRef)}配置已就绪。`
				: "全部模块均已就绪。",
		);
	const snapshot = Array.isArray(data.moduleStatuses)
		? data.moduleStatuses.filter(isRecord)
		: [];
	if (snapshot.length > 0) {
		const journey = setupJourney(snapshot);
		const completed = journey.filter((step) => step.state === "READY").length;
		const current = journey.find((step) => step.state !== "READY");
		lines.push(
			theme.section("配置进度"),
			`${completed}/3 个核心步骤已完成`,
			...(current
				? [
						`当前处理：${current.label}`,
						...(current.issue?.message
							? [`原因：${String(current.issue.message)}`]
							: []),
						`下一步：${theme.command("platform setup")}`,
					]
				: [theme.success("全部核心配置已完成。")]),
		);
	} else {
		lines.push(
			theme.section("汇总"),
			`汇总：${theme.success(`${ready} 个已就绪`)}，${theme.warning(`${needsAction} 个需要操作`)}，${blocked > 0 ? theme.failure(`${blocked} 个系统阻塞`) : `${blocked} 个系统阻塞`}`,
		);
	}
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
			usage: "platform setup [--workspace <路径>]",
			description: "按顺序完成当前唯一配置步骤",
		},
		docs: {
			usage: "platform docs [--workspace <路径>]",
			description: "查看当前使用帮助",
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
		"  -h, --help               显示帮助",
		"  -v, --version            显示版本",
		"",
		theme.section("推荐流程"),
		`  ${theme.command("install → setup → start")}`,
		"",
		theme.section("配置入口"),
		`  ${theme.command("platform setup")}`,
		"",
		theme.section("状态图例"),
		`  ${theme.success("已就绪")}    配置与验证完成`,
		`  ${theme.warning("需要操作")}  需要执行 setup 步骤`,
		`  ${theme.info("等待依赖")}  等待上游 Module 或外部服务`,
		`  ${theme.failure("失败")}      已确认配置或运行故障`,
		"  运行中      服务进程正在运行",
		"  外部资源可用 Chrome 等外部资源已通过真实探测",
		"  无独立进程  该模块无需启动",
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
			const productOrder = new Map([
				["execution-browser-extension", 0],
				["dev-tunnel", 1],
				["model-provider-api", 2],
			]);
			const lines = [theme.failure("平台未启动：配置尚未完成"), ""];
			let current: Record<string, unknown> | undefined;
			for (const status of ["FAILED", "ACTION_REQUIRED", "BLOCKED"]) {
				current = blockers
					.filter((item) => item.setupStatus === status)
					.sort(
						(a, b) =>
							(productOrder.get(String(a.moduleRef)) ?? 100) -
							(productOrder.get(String(b.moduleRef)) ?? 100),
					)[0];
				if (current) break;
			}
			if (current) {
				const moduleRef = String(current.moduleRef);
				lines.push(
					`${current.setupStatus === "FAILED" ? theme.failure("✕") : theme.warning("◆")} ${theme.section(setupModuleLabel(moduleRef))}`,
					`原因：${typeof current.reason === "string" ? current.reason : "当前配置尚未完成"}`,
					"",
				);
			}
			lines.push(
				"PLATFORM_READY=NO",
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
			...(result.error.category === "USAGE" &&
			!result.error.message.includes("你是否想运行")
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
		return `${theme.success("✓ ProFlow 已卸载")}${result.workspaceRoot ? `\n${theme.muted("Workspace")}  ${result.workspaceRoot}` : ""}`;
	return `${result.status === "SUCCEEDED" ? theme.success("✓") : theme.failure("✕")} ${labels[result.command] ?? result.command}${result.status === "SUCCEEDED" ? "成功" : "未完成"}${result.workspaceRoot ? `\n${theme.muted("Workspace")}  ${result.workspaceRoot}` : ""}`;
}
function ownsStartedRuntime(result: CliOutcome): boolean {
	if (result.command !== "start" || !isRecord(result.data)) return false;
	const results = Array.isArray(result.data.results)
		? result.data.results.filter(isRecord)
		: [];
	return results.some(
		(item) =>
			item.command === "start" &&
			Array.isArray(item.observedEffects) &&
			item.observedEffects.length > 0 &&
			isRecord(item.result) &&
			item.result.status === "SUCCEEDED",
	);
}

if (import.meta.main) {
	const argv = process.argv.slice(2);
	const reporter = createTerminalProgressReporter();
	let parsedForOwner: ParsedArgs | undefined;
	let ownerRoot: string | undefined;
	try {
		parsedForOwner = parseArgs(argv);
		if (parsedForOwner.command === "start" || parsedForOwner.command === "stop")
			ownerRoot = await canonicalWorkspace(
				process.cwd(),
				parsedForOwner.workspace,
			);
	} catch {
		// runCli owns normal usage/workspace error rendering.
	}
	if (parsedForOwner?.command === "stop" && ownerRoot) {
		reportProgress(reporter, {
			command: "stop",
			phase: "owner",
			status: "STARTED",
			message: "正在请求当前平台运行进程停止",
		});
		const requested = await requestStartOwnerStop(ownerRoot);
		reportProgress(reporter, {
			command: "stop",
			phase: "owner",
			status: requested === "TIMEOUT" ? "WARNING" : "SUCCEEDED",
			message:
				requested === "STOPPED"
					? "平台运行进程已停止"
					: "未发现需要接管的前台运行进程",
		});
	}
	const result = await runCli(argv, {
		onProgress: reporter,
		...(process.stdin.isTTY && process.stdout.isTTY
			? { setupInteraction: createClackSetupInteraction() }
			: {}),
	});
	if (
		parsedForOwner?.command === "start" &&
		ownerRoot &&
		result.status === "SUCCEEDED" &&
		ownsStartedRuntime(result)
	) {
		await registerStartOwner(ownerRoot);
		let stopping = false;
		const gracefulStop = async () => {
			if (stopping) return;
			stopping = true;
			const stopped = await runCli(["stop", "--workspace", ownerRoot]);
			await clearStartOwner(ownerRoot);
			process.exit(stopped.status === "SUCCEEDED" ? 0 : 1);
		};
		process.once("SIGTERM", () => void gracefulStop());
		process.once("SIGINT", () => void gracefulStop());
	}
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
