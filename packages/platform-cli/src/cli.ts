#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import {
	type ModuleDescriptor,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";
import { applyPlan } from "./apply/apply.ts";
import { rebuildCurrentAssumptions } from "./apply/current.ts";
import {
	buildProductionBindings,
	importRawAdapter,
} from "./binding/production-bindings.ts";
import type { ResolvedModule } from "./contracts.ts";
import { AutoModuleCatalog, discoverModules } from "./discovery/discover.ts";
import { doctorModules } from "./doctor/doctor.ts";
import { PlatformError } from "./errors.ts";
import { generateInstallDoc } from "./install/install.ts";
import {
	startModules,
	statusModules,
	stopModules,
} from "./lifecycle/dispatch.ts";
import { buildManifest } from "./manifest/manifest.ts";
import type { ModuleCatalog, ModuleSource } from "./modules.ts";
import { ensureLayout, workspacePaths } from "./paths.ts";
import { loadConfig } from "./persistence/config.ts";
import { loadPlan, savePlan } from "./persistence/plans.ts";
import type { PlanInput } from "./planner/plan.ts";
import { planDeployment } from "./planner/plan.ts";
import { diagnoseRepair } from "./planner/repair.ts";
import { resolveTargetCatalog } from "./planner/target-catalog.ts";
import { runPreflight } from "./preflight/preflight.ts";
import { verifyModules } from "./verification/verify.ts";

const MODULE_REF = "platform-cli";
const MODULE_VERSION = "0.1.0";

const COMMANDS = [
	"preflight",
	"plan",
	"apply",
	"start",
	"stop",
	"status",
	"verify",
	"doctor",
	"manifest",
] as const;

type Command = (typeof COMMANDS)[number];

export type CliStatus = "SUCCEEDED" | "ACTION_REQUIRED" | "BLOCKED" | "FAILED";

export interface CliOutcome {
	command: string;
	status: CliStatus;
	data?: unknown;
	error?: { code: string; message: string };
}

interface ParsedArgs {
	command: string;
	workspace: string | undefined;
	intent: string | undefined;
	configFile: string | undefined;
	targetWorkspace: string | undefined;
	positional: string[];
}

function parseArgs(argv: readonly string[]): ParsedArgs {
	const positional: string[] = [];
	const parsed: ParsedArgs = {
		command: argv[0] ?? "",
		workspace: undefined,
		intent: undefined,
		configFile: undefined,
		targetWorkspace: undefined,
		positional,
	};
	for (let index = 1; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === undefined) continue;
		if (token === "--workspace") {
			parsed.workspace = argv[index + 1];
			index += 1;
		} else if (token === "--intent") {
			parsed.intent = argv[index + 1];
			index += 1;
		} else if (token === "--config") {
			parsed.configFile = argv[index + 1];
			index += 1;
		} else if (token === "--target-workspace") {
			parsed.targetWorkspace = argv[index + 1];
			index += 1;
		} else if (token.startsWith("-")) {
		} else {
			positional.push(token);
		}
	}
	return parsed;
}

function outcome(
	command: string,
	status: CliStatus,
	data?: unknown,
): CliOutcome {
	const result: CliOutcome = { command, status };
	if (data !== undefined) result.data = data;
	return result;
}

function aggregateStatus(
	statuses: ReadonlyArray<
		"SUCCEEDED" | "BLOCKED" | "ACTION_REQUIRED" | "FAILED"
	>,
): CliStatus {
	if (statuses.includes("FAILED")) return "FAILED";
	if (statuses.includes("BLOCKED")) return "BLOCKED";
	if (statuses.includes("ACTION_REQUIRED")) return "ACTION_REQUIRED";
	return "SUCCEEDED";
}

function failure(command: string, error: unknown): CliOutcome {
	if (error instanceof PlatformError) {
		return {
			command,
			status: "FAILED",
			error: { code: error.code, message: error.message },
		};
	}
	const message = error instanceof Error ? error.message : String(error);
	return {
		command,
		status: "FAILED",
		error: { code: "COMMAND_FAILED", message },
	};
}

function selectModules(
	modules: readonly ResolvedModule[],
	filter?: string,
): readonly ResolvedModule[] {
	if (filter === undefined) return modules;
	const selected = modules.filter((module) => module.moduleRef === filter);
	if (selected.length === 0) {
		throw new PlatformError("INVALID_REQUEST", `module "${filter}" not found`);
	}
	return selected;
}

function moduleSourceOf(module: ResolvedModule): ModuleSource {
	const source: ModuleSource = {
		type: module.source.type,
		packageName: module.packageName,
	};
	if (module.source.path !== undefined) source.path = module.source.path;
	return source;
}

async function loadDescriptors(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
): Promise<ModuleDescriptor[]> {
	const descriptors: ModuleDescriptor[] = [];
	for (const module of modules) {
		const raw = await catalog.loadDescriptor(moduleSourceOf(module));
		descriptors.push(parseModuleDescriptor(raw));
	}
	return descriptors;
}

async function loadConfigFile(
	path: string | undefined,
): Promise<Record<string, Record<string, string>>> {
	if (path === undefined) return {};
	const raw = await readFile(path, "utf8");
	const value: unknown = JSON.parse(raw);
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new PlatformError(
			"INVALID_REQUEST",
			`config file ${path} is not an object`,
		);
	}
	const modules = (value as { modules?: unknown }).modules;
	if (modules === undefined) return {};
	if (
		typeof modules !== "object" ||
		modules === null ||
		Array.isArray(modules)
	) {
		throw new PlatformError(
			"INVALID_REQUEST",
			`config file ${path} "modules" is not an object`,
		);
	}
	const result: Record<string, Record<string, string>> = {};
	for (const [ref, slots] of Object.entries(
		modules as Record<string, unknown>,
	)) {
		if (typeof slots !== "object" || slots === null || Array.isArray(slots))
			continue;
		const values: Record<string, string> = {};
		for (const [key, value] of Object.entries(
			slots as Record<string, unknown>,
		)) {
			if (typeof value === "string") values[key] = value;
		}
		result[ref] = values;
	}
	return result;
}

interface CliContext {
	catalog: ModuleCatalog;
	paths: ReturnType<typeof workspacePaths>;
}

async function buildContext(workspace?: string): Promise<CliContext> {
	const root = workspace ?? process.cwd();
	const paths = workspacePaths(root);
	await ensureLayout(paths);
	const catalog = await buildCatalogWithProductionBindings(root, paths);
	return { catalog, paths };
}

/**
 * The shipped CLI production composition root. Instead of constructing an empty
 * `AutoModuleCatalog` (whose binding seam would otherwise be used only by tests),
 * it discovers the governed modules, loads their materialized config, runs the
 * production binding factory against each module's own deployment adapter, and
 * passes the resulting real bindings into the catalog. Modules without a
 * production factory stay unbound and fail closed when operated on.
 */
async function buildCatalogWithProductionBindings(
	root: string,
	paths: ReturnType<typeof workspacePaths>,
): Promise<AutoModuleCatalog> {
	const modules = await discoverModules({ workspaceRoot: root });
	const configByModuleRef = new Map<string, Record<string, string>>();
	for (const module of modules) {
		const config = await loadConfig(paths, module.moduleRef);
		if (config === undefined) continue;
		configByModuleRef.set(module.moduleRef, {
			...config.publicValues,
			...config.secretValues,
		});
	}
	const bindings = await buildProductionBindings({
		modules,
		configByModuleRef,
		importAdapter: (packageName, source) =>
			importRawAdapter(packageName, source),
	});
	return new AutoModuleCatalog(root, bindings);
}

async function handlePreflight(
	ctx: CliContext,
	args: ParsedArgs,
): Promise<CliOutcome> {
	const modules = await discoverModules({ catalog: ctx.catalog });
	const selected = selectModules(modules, args.positional[0]);
	const config = await loadConfigFile(args.configFile);
	const result = await runPreflight(selected, { config, catalog: ctx.catalog });
	return result.ok
		? outcome("preflight", "SUCCEEDED", result)
		: outcome("preflight", "BLOCKED", result);
}

async function handlePlan(
	ctx: CliContext,
	args: ParsedArgs,
): Promise<CliOutcome> {
	const intent = args.intent;
	if (
		intent !== "install" &&
		intent !== "configure" &&
		intent !== "upgrade" &&
		intent !== "repair"
	) {
		throw new PlatformError(
			"INVALID_REQUEST",
			"plan requires --intent install|configure|upgrade|repair",
		);
	}
	const modules = await discoverModules({ catalog: ctx.catalog });
	const selected = selectModules(modules, args.positional[0]);
	const config = await loadConfigFile(args.configFile);
	const preflight = await runPreflight(selected, {
		config,
		catalog: ctx.catalog,
	});
	if (
		preflight.status === "NOT_READY" ||
		preflight.status === "ACTION_REQUIRED"
	) {
		return outcome(
			"plan",
			preflight.status === "ACTION_REQUIRED" ? "ACTION_REQUIRED" : "BLOCKED",
			preflight,
		);
	}
	let input: PlanInput;
	if (intent === "upgrade") {
		if (args.targetWorkspace === undefined) {
			throw new PlatformError(
				"INVALID_REQUEST",
				"upgrade requires --target-workspace <path>",
			);
		}
		const target = await resolveTargetCatalog(args.targetWorkspace);
		input = {
			intent,
			modules: selected,
			currentDescriptors: await loadDescriptors(ctx.catalog, selected),
			targetDescriptors: target.descriptors,
			config,
		};
	} else if (intent === "repair") {
		const diagnosis = diagnoseRepair(
			await doctorModules(ctx.catalog, selected),
		);
		if (diagnosis.blocked.length > 0) {
			return outcome("plan", "BLOCKED", diagnosis);
		}
		input = { intent, modules: selected, facts: diagnosis.facts, config };
	} else {
		input = { intent, modules: selected, config };
	}
	const plan = planDeployment(input);
	await savePlan(ctx.paths, plan);
	return outcome("plan", "SUCCEEDED", { planRef: plan.planRef, plan });
}

async function handleApply(
	ctx: CliContext,
	args: ParsedArgs,
): Promise<CliOutcome> {
	const planRef = args.positional[0];
	if (planRef === undefined) {
		throw new PlatformError("INVALID_REQUEST", "apply requires <planRef>");
	}
	const plan = await loadPlan(ctx.paths, planRef);
	if (plan === undefined) {
		throw new PlatformError("PLAN_NOT_FOUND", `plan ${planRef} not found`);
	}
	const current = await rebuildCurrentAssumptions(ctx.catalog, plan);
	const result = await applyPlan({
		paths: ctx.paths,
		planRef,
		catalog: ctx.catalog,
		current,
	});
	const status: CliStatus =
		result.outcome === "COMPLETE"
			? "SUCCEEDED"
			: result.outcome === "ACTION_REQUIRED"
				? "ACTION_REQUIRED"
				: result.outcome === "BLOCKED"
					? "BLOCKED"
					: "FAILED";
	return outcome("apply", status, result);
}

async function handleLifecycle(
	ctx: CliContext,
	args: ParsedArgs,
	primitive: "start" | "stop" | "status",
): Promise<CliOutcome> {
	const modules = await discoverModules({ catalog: ctx.catalog });
	const selected = selectModules(modules, args.positional[0]);
	const result =
		primitive === "start"
			? await startModules(ctx.catalog, selected)
			: primitive === "stop"
				? await stopModules(ctx.catalog, selected)
				: await statusModules(ctx.catalog, selected);
	return outcome(
		primitive,
		aggregateStatus(
			result.flatMap((item) => (item.result ? [item.result.status] : [])),
		),
		result,
	);
}

async function handleVerify(
	ctx: CliContext,
	args: ParsedArgs,
): Promise<CliOutcome> {
	const modules = await discoverModules({ catalog: ctx.catalog });
	const selected = selectModules(modules, args.positional[0]);
	const result = await verifyModules(ctx.catalog, selected, ctx.paths);
	return outcome(
		"verify",
		aggregateStatus(result.map((item) => item.result.status)),
		result,
	);
}

async function handleDoctor(
	ctx: CliContext,
	args: ParsedArgs,
): Promise<CliOutcome> {
	const modules = await discoverModules({ catalog: ctx.catalog });
	const selected = selectModules(modules, args.positional[0]);
	const result = await doctorModules(ctx.catalog, selected);
	return outcome(
		"doctor",
		aggregateStatus(result.map((item) => item.status)),
		result,
	);
}

async function handleManifest(
	ctx: CliContext,
	args: ParsedArgs,
): Promise<CliOutcome> {
	const modules = await discoverModules({ catalog: ctx.catalog });
	const selected = selectModules(modules, args.positional[0]);
	const config = await loadConfigFile(args.configFile);
	const manifest = await buildManifest({
		catalog: ctx.catalog,
		modules: selected,
		paths: ctx.paths,
		config,
	});
	await generateInstallDoc({ modules: selected, config, paths: ctx.paths });
	switch (manifest.status) {
		case "READY":
			return outcome("manifest", "SUCCEEDED", manifest);
		case "ACTION_REQUIRED":
			return outcome("manifest", "ACTION_REQUIRED", manifest);
		case "DEGRADED":
			return outcome("manifest", "BLOCKED", manifest);
		case "NOT_READY":
			return outcome("manifest", "FAILED", manifest);
	}
}

async function dispatchCommand(argv: readonly string[]): Promise<CliOutcome> {
	const args = parseArgs(argv);
	if (!(COMMANDS as readonly string[]).includes(args.command)) {
		return {
			command: args.command,
			status: "FAILED",
			error: {
				code: "INVALID_REQUEST",
				message: `unknown command: ${args.command}`,
			},
		};
	}
	try {
		const ctx = await buildContext(args.workspace);
		switch (args.command as Command) {
			case "preflight":
				return await handlePreflight(ctx, args);
			case "plan":
				return await handlePlan(ctx, args);
			case "apply":
				return await handleApply(ctx, args);
			case "start":
			case "stop":
			case "status":
				return await handleLifecycle(
					ctx,
					args,
					args.command as "start" | "stop" | "status",
				);
			case "verify":
				return await handleVerify(ctx, args);
			case "doctor":
				return await handleDoctor(ctx, args);
			case "manifest":
				return await handleManifest(ctx, args);
		}
	} catch (error) {
		return failure(args.command, error);
	}
	return failure(
		args.command,
		new PlatformError("COMMAND_FAILED", "unreachable"),
	);
}

function toMachineResult(outcomeResult: CliOutcome): string {
	const ok = outcomeResult.status === "SUCCEEDED";
	return JSON.stringify({
		contract: "deployment.result.v1",
		ok,
		status: outcomeResult.status,
		moduleRef: MODULE_REF,
		moduleVersion: MODULE_VERSION,
		...(outcomeResult.data !== undefined ? { data: outcomeResult.data } : {}),
		...(outcomeResult.status === "ACTION_REQUIRED"
			? {
					actionRequired: {
						action: "resolve-blocking-action",
						description: "one or more steps require a human action",
					},
				}
			: {}),
		...(outcomeResult.error !== undefined
			? {
					error: {
						code: outcomeResult.error.code,
						message: outcomeResult.error.message,
						retryable: false,
					},
				}
			: {}),
	});
}

export async function runCli(argv: readonly string[]): Promise<string> {
	const filtered = argv.filter((argument) => argument !== "--json");
	if (filtered.length === 0) {
		return JSON.stringify({
			contract: "deployment.result.v1",
			ok: true,
			status: "SUCCEEDED",
			moduleRef: MODULE_REF,
			moduleVersion: MODULE_VERSION,
		});
	}
	return toMachineResult(await dispatchCommand(filtered));
}

if (import.meta.main) {
	const output = await runCli(process.argv.slice(2));
	process.stdout.write(`${output}\n`);
	const parsed: unknown = JSON.parse(output);
	if (
		typeof parsed === "object" &&
		parsed !== null &&
		Reflect.get(parsed, "ok") === false
	) {
		process.exitCode = 1;
	}
}
