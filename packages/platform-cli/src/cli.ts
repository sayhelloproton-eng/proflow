#!/usr/bin/env node

import { readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { moduleStatusObservationSchema } from "@tomflow/proflow-module-contract";
import { descriptor as platformCliDescriptor } from "../deployment/descriptor.ts";
import { AutoModuleCatalog, discoverModules } from "./discovery/discover.ts";
import { InstalledModuleCatalog } from "./discovery/installed.ts";
import { PlatformError } from "./errors.ts";
import {
	observeWorkspaceInstalledVersion,
	type PackageCommandRunner,
	removeWorkspacePackages,
	syncWorkspacePackages,
} from "./install/package-manager.ts";
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
import {
	discoverRegistryModules,
	type NpmCommandRunner,
	PRO_FLOW_PACKAGE_PREFIX,
} from "./registry/index.ts";

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
	error?: { code: string; message: string };
}
export interface CliRuntimeOptions {
	cwd?: string;
	registryRunner?: NpmCommandRunner;
	packageRunner?: PackageCommandRunner;
	executableAvailable?: (command: string) => boolean;
}
interface ParsedArgs {
	command: Command | "help" | "version";
	workspace?: string;
	moduleRef?: string;
	input?: unknown;
	json: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
	let json = false,
		workspace: string | undefined,
		moduleRef: string | undefined,
		input: unknown,
		inputSeen = false;
	let special: "help" | "version" | undefined;
	const positional: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === undefined) continue;
		if (value === "--json") {
			json = true;
			continue;
		}
		if (
			value === "--workspace" ||
			value === "--module" ||
			value === "--input"
		) {
			const next = argv[index + 1];
			if (!next || (value !== "--input" && next.startsWith("-")))
				throw new PlatformError("INVALID_REQUEST", `${value} requires a value`);
			if (value === "--workspace") workspace = next;
			else if (value === "--module") moduleRef = next;
			else {
				try {
					input = JSON.parse(next);
					inputSeen = true;
				} catch (error) {
					throw new PlatformError(
						"INVALID_REQUEST",
						`--input must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
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
			inputSeen ||
			positional.length > 0
		)
			throw new PlatformError(
				"INVALID_REQUEST",
				`${special} flag cannot be combined with command options`,
			);
		return { command: special, json };
	}
	if (positional.length === 0) return { command: "help", json };
	if (positional.length !== 1)
		throw new PlatformError(
			"INVALID_REQUEST",
			"commands accept no positional arguments",
		);
	const raw = positional[0] ?? "";
	if (!COMMANDS.includes(raw as Command))
		throw new PlatformError("INVALID_REQUEST", `unknown command ${raw}`);
	const command = raw as Command;
	if (workspace !== undefined && command !== "install")
		throw new PlatformError(
			"INVALID_REQUEST",
			"--workspace is only valid with install",
		);
	if ((moduleRef !== undefined || inputSeen) && command !== "setup")
		throw new PlatformError(
			"INVALID_REQUEST",
			"--module/--input are only valid with setup",
		);
	if (inputSeen && moduleRef === undefined)
		throw new PlatformError("INVALID_REQUEST", "--input requires --module");
	return {
		command,
		json,
		...(workspace === undefined ? {} : { workspace }),
		...(moduleRef === undefined ? {} : { moduleRef }),
		...(inputSeen ? { input } : {}),
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
			: "FAILED";
	return statusFromModule(result.results.at(-1)?.result.status ?? "FAILED");
}
async function handleStatus(root: string): Promise<CliOutcome> {
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
		};
	});
	return outcome("status", "SUCCEEDED", root, { modules: output });
}
async function handleDocs(root: string): Promise<CliOutcome> {
	const { catalog, modules } = await buildContext(root);
	const docs = await observeDocs(catalog, modules, root);
	const byRef = new Map(modules.map((module) => [module.moduleRef, module]));
	return outcome("docs", "SUCCEEDED", root, {
		modules: docs.map((item) => ({
			moduleRef: item.moduleRef,
			version: byRef.get(item.moduleRef)?.moduleVersion,
			docs: item.result.data,
		})),
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
	const discovered = await discoverRegistryModules({
		workspaceRoot: root,
		...(runtime.registryRunner === undefined
			? {}
			: { runner: runtime.registryRunner }),
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
	const mutation = await syncWorkspacePackages({
		workspaceRoot: root,
		packages: discovered.candidates.map((item) => ({
			packageName: item.packageName,
			version: item.moduleVersion,
		})),
		...(runtime.packageRunner === undefined
			? {}
			: { runner: runtime.packageRunner }),
		...(runtime.executableAvailable === undefined
			? {}
			: { executableAvailable: runtime.executableAvailable }),
	});
	await validateInstalledPackageSet(
		root,
		discovered.candidates,
		previousManaged,
	);
	const metadata = await ensureWorkspaceMetadata(root);
	const { catalog, modules } = await buildContext(root);
	const moduleInstall = await installModulesThin(catalog, modules, root);
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
	const moduleUninstall = await uninstallModulesThin(catalog, modules, root);
	if (!moduleUninstall.completed)
		return outcome("uninstall", batchStatus(moduleUninstall), root, {
			modules: moduleUninstall,
			removed: [],
		});
	const mutation = await removeWorkspacePackages({
		workspaceRoot: root,
		packageNames,
		...(runtime.packageRunner === undefined
			? {}
			: { runner: runtime.packageRunner }),
		...(runtime.executableAvailable === undefined
			? {}
			: { executableAvailable: runtime.executableAvailable }),
	});
	return outcome("uninstall", "SUCCEEDED", root, {
		modules: moduleUninstall,
		packageManager: mutation.packageManager,
		removed: packageNames,
		preserved: [".proflow"],
	});
}
async function handleSetup(
	root: string,
	parsed: ParsedArgs,
): Promise<CliOutcome> {
	const { catalog, modules } = await buildContext(root);
	const target =
		parsed.moduleRef === undefined
			? undefined
			: {
					moduleRef: parsed.moduleRef,
					...(Object.hasOwn(parsed, "input") ? { input: parsed.input } : {}),
				};
	const result = await setupModulesThin(catalog, modules, root, target);
	return outcome("setup", batchStatus(result), root, result);
}
async function handleStart(root: string): Promise<CliOutcome> {
	const { catalog, modules } = await buildContext(root);
	const result = await startModulesThin(catalog, modules, root);
	return outcome("start", batchStatus(result), root, result);
}
async function handleStop(root: string): Promise<CliOutcome> {
	const { catalog, modules } = await buildContext(root);
	const result = await stopModulesThin(catalog, modules, root);
	return outcome("stop", batchStatus(result), root, result);
}
function helpOutcome(): CliOutcome {
	return outcome("help", "SUCCEEDED", undefined, {
		usage: "platform <install|uninstall|status|setup|docs|start|stop> [--json]",
		commands: [...COMMANDS],
		install: "platform install [--workspace <path>]",
		setup: "platform setup [--module <moduleRef> --input '<json>']",
	});
}
export async function runCli(
	argv: readonly string[],
	runtime: CliRuntimeOptions = {},
): Promise<string> {
	let parsed: ParsedArgs;
	try {
		parsed = parseArgs(argv);
	} catch (error) {
		return JSON.stringify(errorOutcome("unknown", error));
	}
	try {
		if (parsed.command === "help") return JSON.stringify(helpOutcome());
		if (parsed.command === "version")
			return JSON.stringify(
				outcome("version", "SUCCEEDED", undefined, {
					version: platformCliDescriptor.moduleVersion,
				}),
			);
		const cwd = await canonicalWorkspace(runtime.cwd ?? process.cwd());
		const root =
			parsed.command === "install" && parsed.workspace !== undefined
				? await canonicalWorkspace(cwd, parsed.workspace)
				: cwd;
		switch (parsed.command) {
			case "install":
				return JSON.stringify(await handleInstall(root, runtime));
			case "uninstall":
				return JSON.stringify(await handleUninstall(root, runtime));
			case "status":
				return JSON.stringify(await handleStatus(root));
			case "setup":
				return JSON.stringify(await handleSetup(root, parsed));
			case "docs":
				return JSON.stringify(await handleDocs(root));
			case "start":
				return JSON.stringify(await handleStart(root));
			case "stop":
				return JSON.stringify(await handleStop(root));
		}
	} catch (error) {
		return JSON.stringify(errorOutcome(parsed.command, error));
	}
}
function errorOutcome(command: string, error: unknown): CliOutcome {
	if (error instanceof PlatformError)
		return {
			command,
			status: "FAILED",
			error: { code: error.code, message: error.message },
		};
	return {
		command,
		status: "FAILED",
		error: {
			code: "COMMAND_FAILED",
			message: error instanceof Error ? error.message : String(error),
		},
	};
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
function renderStatus(data: unknown) {
	if (!isRecord(data) || !Array.isArray(data.modules)) return "No modules.";
	return [
		"ProFlow Modules",
		"",
		...data.modules
			.filter(isRecord)
			.map(
				(raw) =>
					`${String(raw.moduleRef)}  ${String(raw.version)}  setup=${String(raw.setupStatus)}  runtime=${String(raw.runtimeStatus)}`,
			),
	].join("\n");
}
function renderDocs(data: unknown) {
	if (!isRecord(data) || !Array.isArray(data.modules)) return "No module docs.";
	const lines = ["ProFlow Docs"];
	for (const raw of data.modules)
		if (isRecord(raw))
			lines.push(
				"",
				`## ${String(raw.moduleRef)} @ ${String(raw.version)}`,
				JSON.stringify(raw.docs ?? {}, null, 2),
			);
	return lines.join("\n");
}
export function renderHumanResult(result: CliOutcome): string {
	if (result.status === "FAILED")
		return `${result.command.toUpperCase()} FAILED${result.error ? ` [${result.error.code}] ${result.error.message}` : ""}`;
	if (result.command === "help")
		return [
			"ProFlow Platform CLI",
			"",
			...COMMANDS.map((command) => `platform ${command}`),
			"",
			"platform install --workspace <path>",
			"platform setup --module <moduleRef> --input '<json>'",
			"append --json for machine-readable output",
		].join("\n");
	if (result.command === "version" && isRecord(result.data))
		return String(result.data.version ?? platformCliDescriptor.moduleVersion);
	if (result.command === "status") return renderStatus(result.data);
	if (result.command === "docs") return renderDocs(result.data);
	return [
		`${result.command.toUpperCase()} ${result.status}`,
		...(result.workspaceRoot ? [`Workspace: ${result.workspaceRoot}`] : []),
		...(result.data === undefined
			? []
			: [JSON.stringify(result.data, null, 2)]),
	].join("\n");
}
if (import.meta.main) {
	const argv = process.argv.slice(2);
	const output = await runCli(argv);
	const result = JSON.parse(output) as CliOutcome;
	process.stdout.write(
		`${argv.includes("--json") ? output : renderHumanResult(result)}\n`,
	);
	if (result.status !== "SUCCEEDED") process.exitCode = 1;
}
