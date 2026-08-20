#!/usr/bin/env node

import { readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { moduleStatusObservationSchema } from "@tomflow/proflow-module-contract";
import { descriptor as platformCliDescriptor } from "../deployment/descriptor.ts";
import {
	buildProductionBindings,
	importRawAdapter,
} from "./binding/production-bindings.ts";
import { AutoModuleCatalog, discoverModules } from "./discovery/discover.ts";
import { InstalledModuleCatalog } from "./discovery/installed.ts";
import { aggregateModuleDocs } from "./docs/aggregate.ts";
import { PlatformError } from "./errors.ts";
import {
	observeWorkspaceInstalledVersion,
	type PackageCommandRunner,
	removeWorkspacePackages,
	syncWorkspacePackages,
} from "./install/package-manager.ts";
import {
	observeStatuses,
	preflightAndStartModules,
	stopModulesThin,
} from "./lifecycle/thin.ts";
import type { ModuleCatalog } from "./modules.ts";
import { workspacePaths } from "./paths.ts";
import { loadConfig } from "./persistence/config.ts";
import { ensureWorkspaceMetadata } from "./persistence/workspace-metadata.ts";
import {
	discoverRegistryModules,
	type NpmCommandRunner,
	PRO_FLOW_PACKAGE_PREFIX,
} from "./registry/index.ts";

const COMMANDS = [
	"modules",
	"docs",
	"install",
	"uninstall",
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
	json: boolean;
}
function parseArgs(argv: readonly string[]): ParsedArgs {
	let json = false;
	let workspace: string | undefined;
	let special: "help" | "version" | undefined;
	const positional: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === undefined) continue;
		if (value === "--json") {
			json = true;
			continue;
		}
		if (value === "--workspace") {
			const next = argv[index + 1];
			if (!next || next.startsWith("-")) {
				throw new PlatformError(
					"INVALID_REQUEST",
					"--workspace requires a path",
				);
			}
			workspace = next;
			index += 1;
			continue;
		}
		if (value === "--help" || value === "-h") {
			if (special !== undefined && special !== "help")
				throw new PlatformError(
					"INVALID_REQUEST",
					"help and version flags cannot be combined",
				);
			special = "help";
			continue;
		}
		if (value === "--version" || value === "-v") {
			if (special !== undefined && special !== "version")
				throw new PlatformError(
					"INVALID_REQUEST",
					"help and version flags cannot be combined",
				);
			special = "version";
			continue;
		}
		if (value.startsWith("-"))
			throw new PlatformError("INVALID_REQUEST", `unknown option ${value}`);
		positional.push(value);
	}
	if (special !== undefined) {
		if (workspace !== undefined || positional.length > 0)
			throw new PlatformError(
				"INVALID_REQUEST",
				`${special} flag cannot be combined with a command or --workspace`,
			);
		return { command: special, json };
	}
	if (positional.length === 0) {
		if (workspace !== undefined)
			throw new PlatformError(
				"INVALID_REQUEST",
				"--workspace is only valid with install",
			);
		return { command: "help", json };
	}
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
	return workspace === undefined
		? { command, json }
		: { command, workspace, json };
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
	if (!info.isDirectory()) {
		throw new PlatformError(
			"WORKSPACE_NOT_FOUND",
			`Workspace is not a directory: ${candidate}`,
		);
	}
	return realpath(candidate);
}

async function loadConfigMap(
	root: string,
	modules: Awaited<ReturnType<typeof discoverModules>>,
) {
	const paths = workspacePaths(root);
	const configByModuleRef = new Map<
		string,
		{
			publicValues: Record<string, string>;
			secretValues: Record<string, string>;
		}
	>();
	for (const module of modules) {
		const config = await loadConfig(paths, module.moduleRef);
		if (config === undefined) continue;
		configByModuleRef.set(module.moduleRef, config);
	}
	return configByModuleRef;
}
async function buildContext(root: string): Promise<{
	catalog: ModuleCatalog;
	modules: Awaited<ReturnType<typeof discoverModules>>;
}> {
	const discovered = await discoverModules({ workspaceRoot: root });
	const configByModuleRef = await loadConfigMap(root, discovered);
	const bindings = await buildProductionBindings({
		workspaceRoot: root,
		modules: discovered,
		configByModuleRef,
		importAdapter: (packageName, source) =>
			importRawAdapter(packageName, source, root),
	});
	const catalog = new AutoModuleCatalog(root, bindings);
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

function failedLifecycleStatus(
	results: readonly { result: { status: string } }[],
): CliStatus {
	const last = results.at(-1);
	return last === undefined
		? "SUCCEEDED"
		: statusFromModule(last.result.status);
}
async function handleModules(root: string): Promise<CliOutcome> {
	const { catalog, modules } = await buildContext(root);
	const observed = await observeStatuses(catalog, modules);
	const byRef = new Map(modules.map((module) => [module.moduleRef, module]));
	const output = observed.map((item) => {
		if (item.result.status !== "SUCCEEDED") {
			throw new PlatformError(
				"COMMAND_FAILED",
				`module ${item.moduleRef} status observation did not return SUCCEEDED`,
			);
		}
		const parsed = moduleStatusObservationSchema.safeParse(item.result.data);
		if (!parsed.success) {
			throw new PlatformError(
				"COMMAND_FAILED",
				`module ${item.moduleRef} returned an invalid status observation: ${parsed.error.message}`,
			);
		}
		const module = byRef.get(item.moduleRef);
		if (module === undefined)
			throw new PlatformError(
				"COMMAND_FAILED",
				`unknown module ${item.moduleRef}`,
			);
		return {
			moduleRef: item.moduleRef,
			version: module.moduleVersion,
			configStatus: parsed.data.configStatus,
			...(parsed.data.missingConfig === undefined
				? {}
				: { missingConfig: parsed.data.missingConfig }),
			runtimeStatus: parsed.data.runtimeStatus,
		};
	});
	return outcome("modules", "SUCCEEDED", root, { modules: output });
}
async function handleDocs(root: string): Promise<CliOutcome> {
	const catalog = new AutoModuleCatalog(root);
	const modules = await discoverModules({ workspaceRoot: root, catalog });
	const docs = await aggregateModuleDocs(root, catalog, modules);
	return outcome("docs", "SUCCEEDED", root, { modules: docs });
}

async function validateInstalledPackageSet(
	root: string,
	candidates: readonly { packageName: string; moduleVersion: string }[],
	previousManaged: readonly string[],
): Promise<void> {
	const expectedNames = candidates.map((item) => item.packageName).sort();
	const declaredNames = await workspaceProFlowDependencies(root);
	if (JSON.stringify(declaredNames) !== JSON.stringify(expectedNames)) {
		throw new PlatformError(
			"COMMAND_FAILED",
			`managed dependency set mismatch: expected ${expectedNames.join(", ")}, observed ${declaredNames.join(", ")}`,
		);
	}
	for (const candidate of candidates) {
		const observed = await observeWorkspaceInstalledVersion(
			root,
			candidate.packageName,
		);
		if (observed !== candidate.moduleVersion) {
			throw new PlatformError(
				"COMMAND_FAILED",
				`installed version mismatch for ${candidate.packageName}: expected ${candidate.moduleVersion}, observed ${observed ?? "missing"}`,
			);
		}
	}
	for (const stale of previousManaged.filter(
		(name) => !expectedNames.includes(name),
	)) {
		if ((await observeWorkspaceInstalledVersion(root, stale)) !== undefined) {
			throw new PlatformError(
				"COMMAND_FAILED",
				`stale managed package remains installed after synchronization: ${stale}`,
			);
		}
	}
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
		) {
			throw new PlatformError(
				"DESCRIPTOR_INVALID",
				`installed descriptor mismatch for ${candidate.packageName}@${candidate.moduleVersion}`,
			);
		}
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
	if (discovered.rejected.length > 0) {
		throw new PlatformError(
			"REGISTRY_RESPONSE_INVALID",
			`registry contains rejected ProFlow packages: ${discovered.rejected.map((item) => `${item.packageName}:${item.reason}`).join(", ")}`,
		);
	}
	if (discovered.candidates.length === 0) {
		throw new PlatformError(
			"PACKAGE_NOT_FOUND",
			"no ProFlow packages were discovered in the configured scope",
		);
	}
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
	return outcome("install", "SUCCEEDED", root, {
		registry: discovered.registry,
		packageManager: mutation.packageManager,
		packages: discovered.candidates.map((item) => ({
			packageName: item.packageName,
			version: item.moduleVersion,
		})),
		workspace: metadata,
		next: "platform modules",
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
			for (const name of Object.keys(value)) {
				if (name.startsWith(PRO_FLOW_PACKAGE_PREFIX)) names.add(name);
			}
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
		packageManager: mutation.packageManager,
		removed: packageNames,
		preserved: [".proflow"],
	});
}

async function handleStart(root: string): Promise<CliOutcome> {
	const { catalog, modules } = await buildContext(root);
	const result = await preflightAndStartModules(catalog, modules);
	return outcome(
		"start",
		result.completed ? "SUCCEEDED" : failedLifecycleStatus(result.results),
		root,
		result,
	);
}

async function handleStop(root: string): Promise<CliOutcome> {
	const { catalog, modules } = await buildContext(root);
	const result = await stopModulesThin(catalog, modules);
	return outcome(
		"stop",
		result.completed ? "SUCCEEDED" : failedLifecycleStatus(result.results),
		root,
		result,
	);
}

function helpOutcome(): CliOutcome {
	return outcome("help", "SUCCEEDED", undefined, {
		usage: "platform <modules|docs|install|uninstall|start|stop> [--json]",
		commands: [...COMMANDS],
		install: "platform install [--workspace <path>]",
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
		if (parsed.command === "version") {
			return JSON.stringify(
				outcome("version", "SUCCEEDED", undefined, {
					version: platformCliDescriptor.moduleVersion,
				}),
			);
		}
		const cwd = await canonicalWorkspace(runtime.cwd ?? process.cwd());
		const root =
			parsed.command === "install" && parsed.workspace !== undefined
				? await canonicalWorkspace(cwd, parsed.workspace)
				: cwd;
		switch (parsed.command) {
			case "modules":
				return JSON.stringify(await handleModules(root));
			case "docs":
				return JSON.stringify(await handleDocs(root));
			case "install":
				return JSON.stringify(await handleInstall(root, runtime));
			case "uninstall":
				return JSON.stringify(await handleUninstall(root, runtime));
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
	if (error instanceof PlatformError) {
		return {
			command,
			status: "FAILED",
			error: { code: error.code, message: error.message },
		};
	}
	return {
		command,
		status: "FAILED",
		error: {
			code: "COMMAND_FAILED",
			message: error instanceof Error ? error.message : String(error),
		},
	};
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderModules(data: unknown): string {
	if (!isRecord(data) || !Array.isArray(data.modules)) return "No modules.";
	const lines = ["ProFlow Modules", ""];
	for (const raw of data.modules) {
		if (!isRecord(raw)) continue;
		const missing = Array.isArray(raw.missingConfig)
			? raw.missingConfig
					.filter((item): item is string => typeof item === "string")
					.join(",")
			: "-";
		lines.push(
			`${String(raw.moduleRef)}  ${String(raw.version)}  config=${String(raw.configStatus)}  runtime=${String(raw.runtimeStatus)}  missing=${missing}`,
		);
	}
	return lines.join("\n");
}

function renderDocs(data: unknown): string {
	if (!isRecord(data) || !Array.isArray(data.modules)) return "No module docs.";
	const lines = ["ProFlow Docs"];
	for (const raw of data.modules) {
		if (!isRecord(raw)) continue;
		lines.push("", `## ${String(raw.moduleRef)} @ ${String(raw.version)}`);
		if (!Array.isArray(raw.documents)) continue;
		for (const document of raw.documents) {
			if (!isRecord(document)) continue;
			lines.push(
				"",
				`### ${String(document.id)}`,
				String(document.content ?? ""),
			);
		}
	}
	return lines.join("\n");
}
export function renderHumanResult(result: CliOutcome): string {
	if (result.status === "FAILED") {
		return `${result.command.toUpperCase()} FAILED${result.error ? ` [${result.error.code}] ${result.error.message}` : ""}`;
	}
	if (result.command === "help") {
		return [
			"ProFlow Platform CLI",
			"",
			...COMMANDS.map((command) => `platform ${command}`),
			"",
			"platform install --workspace <path>",
			"append --json for machine-readable output",
		].join("\n");
	}
	if (result.command === "version" && isRecord(result.data)) {
		return String(result.data.version ?? platformCliDescriptor.moduleVersion);
	}
	if (result.command === "modules") return renderModules(result.data);
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
