#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import {
	type ModuleDescriptor,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";
import { applyPlan } from "./apply/apply.ts";
import { rebuildCurrentAssumptions } from "./apply/current.ts";
import { createWorkspacePackageManagerDriver } from "./apply/driver.ts";
import {
	buildProductionBindings,
	importRawAdapter,
} from "./binding/production-bindings.ts";
import type { ResolvedModule } from "./contracts.ts";
import { AutoModuleCatalog, discoverModules } from "./discovery/discover.ts";
import { describeModule, readModuleDocument } from "./docs/docs.ts";
import { doctorModules } from "./doctor/doctor.ts";
import { PlatformError } from "./errors.ts";
import { buildDependencyGraph } from "./graph/graph.ts";
import { selectBootstrapModules } from "./install/bootstrap.ts";
import { preflightInstallerEnvironment } from "./install/environment.ts";
import { generateInstallDoc } from "./install/install.ts";
import {
	restartModules,
	startModules,
	statusModules,
	stopModules,
} from "./lifecycle/dispatch.ts";
import { buildManifest } from "./manifest/manifest.ts";
import type { ModuleCatalog, ModuleSource } from "./modules.ts";
import { writeDeploymentObserverSummary } from "./observer/deployment-summary.ts";
import { workspacePaths } from "./paths.ts";
import { loadConfig } from "./persistence/config.ts";
import { loadPlan, savePlan } from "./persistence/plans.ts";
import type { PlanInput } from "./planner/plan.ts";
import { planDeployment } from "./planner/plan.ts";
import { diagnoseRepair } from "./planner/repair.ts";
import { runPreflight } from "./preflight/preflight.ts";
import {
	discoverRegistryInstallClosure,
	discoverRegistryModules,
	loadRegistryModuleDescriptor,
} from "./registry/index.ts";
import { verifyModules } from "./verification/verify.ts";

const MODULE_REF = "platform-cli";
const MODULE_VERSION = "0.1.0";

const COMMANDS = [
	"search",
	"modules",
	"docs",
	"install",
	"uninstall",
	"upgrade",
	"preflight",
	"plan",
	"apply",
	"start",
	"stop",
	"restart",
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
	positional: string[];
}

function parseArgs(argv: readonly string[]): ParsedArgs {
	const positional: string[] = [];
	const parsed: ParsedArgs = {
		command: argv[0] ?? "",
		workspace: undefined,
		intent: undefined,
		configFile: undefined,
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
	const selected = modules.filter(
		(module) => module.moduleRef === filter || module.packageName === filter,
	);
	if (selected.length === 0) {
		throw new PlatformError(
			"INVALID_REQUEST",
			`module or package "${filter}" not found`,
		);
	}
	return selected;
}

function moduleSourceOf(module: ResolvedModule): ModuleSource {
	if (module.source.type === "registry") {
		throw new PlatformError(
			"DESCRIPTOR_INVALID",
			`registry bootstrap target ${module.packageName} has no local descriptor`,
		);
	}
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
		workspaceRoot: root,
		modules,
		configByModuleRef,
		importAdapter: (packageName, source) =>
			importRawAdapter(packageName, source),
	});
	return new AutoModuleCatalog(root, bindings);
}

async function handleSearch(
	root: string,
	args: ParsedArgs,
): Promise<CliOutcome> {
	const result = await discoverRegistryModules({
		workspaceRoot: root,
		...(args.positional[0] === undefined
			? {}
			: { packageName: args.positional[0] }),
	});
	if (args.positional[0] !== undefined && result.candidates.length === 0) {
		return outcome("search", "BLOCKED", result);
	}
	return outcome("search", "SUCCEEDED", result);
}

async function handleModules(
	ctx: CliContext,
	args: ParsedArgs,
): Promise<CliOutcome> {
	const modules = await discoverModules({ catalog: ctx.catalog });
	const selected = selectModules(modules, args.positional[0]);
	const descriptors = await loadDescriptors(ctx.catalog, selected);
	return outcome(
		"modules",
		"SUCCEEDED",
		descriptors.map((descriptor) => ({
			moduleRef: descriptor.moduleRef,
			packageName: descriptor.packageName,
			moduleVersion: descriptor.moduleVersion,
			kind: descriptor.kind,
			installClass: descriptor.installClass,
			identity: descriptor.identity,
			lifecycle: descriptor.lifecycle.supported,
			documentation: descriptor.documentation,
		})),
	);
}

async function handleDocs(
	ctx: CliContext,
	args: ParsedArgs,
): Promise<CliOutcome> {
	if (args.positional.length > 2) {
		throw new PlatformError(
			"INVALID_REQUEST",
			"docs accepts at most <moduleRef|packageName> [documentId]",
		);
	}
	const modules = await discoverModules({ catalog: ctx.catalog });
	const moduleFilter = args.positional[0];
	const documentId = args.positional[1];
	if (documentId !== undefined && moduleFilter === undefined) {
		throw new PlatformError(
			"INVALID_REQUEST",
			"docs document read requires a module",
		);
	}
	const selected = selectModules(modules, moduleFilter);
	const descriptors = await loadDescriptors(ctx.catalog, selected);
	if (documentId !== undefined) {
		const module = selected[0];
		const descriptor = descriptors[0];
		if (module === undefined || descriptor === undefined) {
			throw new PlatformError(
				"COMMAND_FAILED",
				"docs module selection invariant failed",
			);
		}
		return outcome(
			"docs",
			"SUCCEEDED",
			await readModuleDocument({
				workspaceRoot: ctx.paths.root,
				source: moduleSourceOf(module),
				descriptor,
				documentId,
			}),
		);
	}

	const views = await Promise.all(
		selected.map((module, index) =>
			describeModule({
				workspaceRoot: ctx.paths.root,
				source: moduleSourceOf(module),
				descriptor:
					descriptors[index] ??
					(() => {
						throw new Error(
							`Missing module descriptor for ${module.packageName}`,
						);
					})(),
			}),
		),
	);
	if (moduleFilter !== undefined) {
		return outcome("docs", "SUCCEEDED", views[0]);
	}
	return outcome(
		"docs",
		"SUCCEEDED",
		views.map((view) => ({
			moduleRef: view.moduleRef,
			packageName: view.packageName,
			moduleVersion: view.moduleVersion,
			kind: view.kind,
			installClass: view.installClass,
			identity: view.identity,
			commands: view.commands,
			publicApiEntries: view.publicApiEntries,
			provides: view.provides,
			requires: view.requires,
			lifecycle: view.lifecycle,
			documentation: view.documentation,
		})),
	);
}

async function handleInstallerPreflight(root: string): Promise<CliOutcome> {
	const result = await preflightInstallerEnvironment({ workspaceRoot: root });
	const status: CliStatus =
		result.status === "READY"
			? "SUCCEEDED"
			: result.status === "ACTION_REQUIRED"
				? "ACTION_REQUIRED"
				: "BLOCKED";
	return outcome("preflight", status, result);
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
		intent !== "uninstall" &&
		intent !== "repair"
	) {
		throw new PlatformError(
			"INVALID_REQUEST",
			"plan requires --intent install|configure|upgrade|uninstall|repair",
		);
	}
	if (intent === "install") {
		const installer = await preflightInstallerEnvironment({
			workspaceRoot: ctx.paths.root,
		});
		if (installer.status !== "READY") {
			return outcome(
				"plan",
				installer.status === "ACTION_REQUIRED" ? "ACTION_REQUIRED" : "BLOCKED",
				installer,
			);
		}
		const registry =
			args.positional[0] === undefined
				? await discoverRegistryModules({ workspaceRoot: ctx.paths.root })
				: await discoverRegistryInstallClosure({
						workspaceRoot: ctx.paths.root,
						packageName: args.positional[0],
					});
		const bootstrapModules = selectBootstrapModules(
			registry.candidates,
			args.positional[0],
		);
		const plan = planDeployment({
			intent: "install",
			modules: bootstrapModules,
		});
		await savePlan(ctx.paths, plan);
		return outcome("plan", "SUCCEEDED", {
			planRef: plan.planRef,
			registry: registry.registry,
			plan,
		});
	}

	const modules = await discoverModules({ catalog: ctx.catalog });
	const selected = selectModules(modules, args.positional[0]);
	const config = await loadConfigFile(args.configFile);
	if (intent === "uninstall") {
		if (args.positional[0] === undefined) {
			throw new PlatformError(
				"INVALID_REQUEST",
				"uninstall plan requires <moduleRef|packageName>",
			);
		}
		if (selected.every((module) => module.installClass !== "core")) {
			const removing = new Set(selected.map((module) => module.moduleRef));
			const remaining = modules.filter(
				(module) => !removing.has(module.moduleRef),
			);
			// Rebuilding the remaining graph is the uninstall dependency gate: if a
			// required contract or moduleRef binding would disappear, graph
			// construction fails closed before any removal plan is persisted.
			buildDependencyGraph(remaining);
		}
		const plan = planDeployment({ intent, modules: selected, config });
		await savePlan(ctx.paths, plan);
		return outcome("plan", "SUCCEEDED", { planRef: plan.planRef, plan });
	}
	if (intent === "upgrade") {
		const installer = await preflightInstallerEnvironment({
			workspaceRoot: ctx.paths.root,
		});
		if (installer.status !== "READY") {
			return outcome(
				"plan",
				installer.status === "ACTION_REQUIRED" ? "ACTION_REQUIRED" : "BLOCKED",
				installer,
			);
		}
		const currentDescriptors = await loadDescriptors(ctx.catalog, modules);
		const currentByRef = new Map(
			currentDescriptors.map((descriptor) => [
				descriptor.moduleRef,
				descriptor,
			]),
		);
		const targetByRef = new Map(currentByRef);
		const targets: { moduleRef: string; targetVersion: string }[] = [];
		let registryUrl: string | undefined;

		for (const module of selected) {
			const discovered = await discoverRegistryModules({
				workspaceRoot: ctx.paths.root,
				packageName: module.packageName,
			});
			registryUrl ??= discovered.registry;
			const candidate = discovered.candidates[0];
			if (candidate === undefined) {
				throw new PlatformError(
					"PACKAGE_NOT_FOUND",
					`no installable Registry target found for managed package ${module.packageName}`,
				);
			}
			targets.push({
				moduleRef: module.moduleRef,
				targetVersion: candidate.moduleVersion,
			});
			if (candidate.moduleVersion === module.moduleVersion) continue;
			const targetDescriptor = await loadRegistryModuleDescriptor({
				workspaceRoot: ctx.paths.root,
				candidate,
			});
			if (targetDescriptor.moduleRef !== module.moduleRef) {
				throw new PlatformError(
					"REGISTRY_RESPONSE_INVALID",
					`Registry target ${module.packageName}@${candidate.moduleVersion} changed moduleRef from ${module.moduleRef} to ${targetDescriptor.moduleRef}`,
				);
			}
			targetByRef.set(module.moduleRef, targetDescriptor);
		}

		const targetDescriptors = modules.map((module) => {
			const descriptor = targetByRef.get(module.moduleRef);
			if (descriptor === undefined) {
				throw new PlatformError(
					"COMMAND_FAILED",
					`upgrade target descriptor invariant failed for ${module.moduleRef}`,
				);
			}
			return descriptor;
		});
		const plan = planDeployment({
			intent,
			currentDescriptors,
			targetDescriptors,
			targets,
		});
		await savePlan(ctx.paths, plan);
		return outcome("plan", "SUCCEEDED", {
			planRef: plan.planRef,
			registry: registryUrl,
			plan,
		});
	}
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
	if (intent === "repair") {
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
		driver: createWorkspacePackageManagerDriver({
			workspaceRoot: ctx.paths.root,
		}),
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

function planRefFromOutcome(result: CliOutcome): string {
	if (
		typeof result.data !== "object" ||
		result.data === null ||
		Array.isArray(result.data)
	) {
		throw new PlatformError(
			"PLAN_INVALID",
			"planned mutation returned no plan data",
		);
	}
	const planRef = Reflect.get(result.data, "planRef");
	if (typeof planRef !== "string" || planRef === "") {
		throw new PlatformError(
			"PLAN_INVALID",
			"planned mutation returned no planRef",
		);
	}
	return planRef;
}

async function handleManagedMutation(
	ctx: CliContext,
	args: ParsedArgs,
	intent: "install" | "uninstall" | "upgrade",
): Promise<CliOutcome> {
	const planned = await handlePlan(ctx, { ...args, command: "plan", intent });
	if (planned.status !== "SUCCEEDED") {
		return { ...planned, command: intent };
	}
	const planRef = planRefFromOutcome(planned);
	const applied = await handleApply(ctx, {
		...args,
		command: "apply",
		intent: undefined,
		positional: [planRef],
	});
	if (applied.status !== "SUCCEEDED") {
		return outcome(intent, applied.status, {
			plan: planned.data,
			apply: applied.data,
		});
	}

	// Package mutations change Workspace package reality. Rebuild the catalog
	// before reporting the managed set so the result can never be sourced from
	// the pre-mutation catalog.
	const refreshed = await buildContext(args.workspace);
	const managed = await handleModules(refreshed, {
		...args,
		command: "modules",
		intent: undefined,
		positional: [],
	});
	return outcome(intent, "SUCCEEDED", {
		plan: planned.data,
		apply: applied.data,
		managedModules: managed.data,
	});
}

async function handleLifecycle(
	ctx: CliContext,
	args: ParsedArgs,
	primitive: "start" | "stop" | "restart" | "status",
): Promise<CliOutcome> {
	const modules = await discoverModules({ catalog: ctx.catalog });
	const selected = selectModules(modules, args.positional[0]);
	const result =
		primitive === "start"
			? await startModules(ctx.catalog, selected)
			: primitive === "stop"
				? await stopModules(ctx.catalog, selected)
				: primitive === "restart"
					? await restartModules(ctx.catalog, selected)
					: await statusModules(ctx.catalog, selected);
	const statuses = result.flatMap((item) =>
		item.result ? [item.result.status] : [],
	);
	const status = aggregateStatus(statuses);
	if (primitive === "status" && !args.positional[0]) {
		await writeDeploymentObserverSummary({
			paths: ctx.paths,
			source: "status",
			selectedModuleCount: selected.length,
			totalModuleCount: modules.length,
			modules: result.flatMap((item) =>
				item.result
					? [{ moduleRef: item.moduleRef, status: item.result.status }]
					: [],
			),
		});
	}
	return outcome(primitive, status, result);
}

async function handleVerify(
	ctx: CliContext,
	args: ParsedArgs,
): Promise<CliOutcome> {
	const modules = await discoverModules({ catalog: ctx.catalog });
	const selected = selectModules(modules, args.positional[0]);
	const result = await verifyModules(ctx.catalog, selected, ctx.paths);
	const status = aggregateStatus(result.map((item) => item.result.status));
	if (!args.positional[0]) {
		await writeDeploymentObserverSummary({
			paths: ctx.paths,
			source: "verify",
			selectedModuleCount: selected.length,
			totalModuleCount: modules.length,
			modules: result.map((item) => ({
				moduleRef: item.moduleRef,
				status: item.result.status,
			})),
		});
	}
	return outcome("verify", status, result);
}

async function handleDoctor(
	ctx: CliContext,
	args: ParsedArgs,
): Promise<CliOutcome> {
	const modules = await discoverModules({ catalog: ctx.catalog });
	const selected = selectModules(modules, args.positional[0]);
	const result = await doctorModules(ctx.catalog, selected);
	const status = aggregateStatus(result.map((item) => item.status));
	if (!args.positional[0]) {
		await writeDeploymentObserverSummary({
			paths: ctx.paths,
			source: "doctor",
			selectedModuleCount: selected.length,
			totalModuleCount: modules.length,
			modules: result.map((item) => ({
				moduleRef: item.moduleRef,
				status: item.status,
			})),
		});
	}
	return outcome("doctor", status, result);
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
		const root = args.workspace ?? process.cwd();
		if (args.command === "search") return await handleSearch(root, args);
		if (args.command === "preflight" && args.intent === "install") {
			return await handleInstallerPreflight(root);
		}
		const ctx = await buildContext(args.workspace);
		switch (args.command as Command) {
			case "search":
				return await handleSearch(root, args);
			case "modules":
				return await handleModules(ctx, args);
			case "docs":
				return await handleDocs(ctx, args);
			case "install":
			case "uninstall":
			case "upgrade":
				return await handleManagedMutation(
					ctx,
					args,
					args.command as "install" | "uninstall" | "upgrade",
				);
			case "preflight":
				return await handlePreflight(ctx, args);
			case "plan":
				return await handlePlan(ctx, args);
			case "apply":
				return await handleApply(ctx, args);
			case "start":
			case "stop":
			case "restart":
			case "status":
				return await handleLifecycle(
					ctx,
					args,
					args.command as "start" | "stop" | "restart" | "status",
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
	if (argv.includes("--help") || argv.includes("-h")) {
		return JSON.stringify({
			contract: "deployment.result.v1",
			ok: true,
			status: "SUCCEEDED",
			moduleRef: MODULE_REF,
			moduleVersion: MODULE_VERSION,
			data: {
				usage:
					"platform <command> [module|package] [--workspace <path>] [--json]",
				commands: [...COMMANDS],
			},
		});
	}
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
