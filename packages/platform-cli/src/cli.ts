#!/usr/bin/env node

import { readFile, rm } from "node:fs/promises";

import {
	type ModuleDescriptor,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";
import { descriptor as platformCliDescriptor } from "../deployment/descriptor.ts";
import { applyPlan } from "./apply/apply.ts";
import { rebuildCurrentAssumptions } from "./apply/current.ts";
import { createWorkspacePackageManagerDriver } from "./apply/driver.ts";
import {
	acquireGlobalOperationLock,
	canonicalizeWorkspace,
	claimWorkspaceBinding,
	clearGlobalBinding,
	forgetMissingWorkspaceBinding,
	type GlobalWorkspaceBinding,
	loadGlobalBinding,
	observeBoundWorkspace,
	requireBoundWorkspace,
	updateGlobalBindingState,
} from "./binding/global-binding.ts";
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
import { mergeEffectiveConfig } from "./persistence/effective-config.ts";
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

const MODULE_REF = platformCliDescriptor.moduleRef;
const MODULE_VERSION = platformCliDescriptor.moduleVersion;

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

export interface CliWorkspaceSummary {
	boundWorkspace: string;
	workspaceInstanceId: string;
	bindingState: GlobalWorkspaceBinding["state"];
}

export interface CliOutcome {
	command: string;
	status: CliStatus;
	data?: unknown;
	workspace?: CliWorkspaceSummary;
	error?: { code: string; message: string };
}

export interface CliRuntimeOptions {
	cwd?: string;
	globalRoot?: string;
}

interface ParsedArgs {
	command: string;
	workspace: string | undefined;
	intent: string | undefined;
	configFile: string | undefined;
	forget: boolean;
	positional: string[];
}

function parseArgs(argv: readonly string[]): ParsedArgs {
	const positional: string[] = [];
	const parsed: ParsedArgs = {
		command: argv[0] ?? "",
		workspace: undefined,
		intent: undefined,
		configFile: undefined,
		forget: false,
		positional,
	};
	for (let index = 1; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === undefined) continue;
		if (token === "--workspace") {
			parsed.workspace = requiredOptionValue(argv, index, token);
			index += 1;
		} else if (token === "--intent") {
			parsed.intent = requiredOptionValue(argv, index, token);
			index += 1;
		} else if (token === "--config") {
			parsed.configFile = requiredOptionValue(argv, index, token);
			index += 1;
		} else if (token === "--forget") {
			parsed.forget = true;
		} else if (token.startsWith("-")) {
			throw new PlatformError("INVALID_REQUEST", `unknown option: ${token}`);
		} else {
			positional.push(token);
		}
	}
	return parsed;
}

function requiredOptionValue(
	argv: readonly string[],
	index: number,
	option: string,
): string {
	const value = argv[index + 1];
	if (value === undefined || value === "" || value.startsWith("-")) {
		throw new PlatformError("INVALID_REQUEST", `${option} requires a value`);
	}
	return value;
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

function workspaceSummary(
	binding: GlobalWorkspaceBinding,
): CliWorkspaceSummary {
	return {
		boundWorkspace: binding.workspaceRealPath,
		workspaceInstanceId: binding.workspaceInstanceId,
		bindingState: binding.state,
	};
}

function withWorkspace(
	result: CliOutcome,
	binding: GlobalWorkspaceBinding,
): CliOutcome {
	return { ...result, workspace: workspaceSummary(binding) };
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

async function buildContext(root: string): Promise<CliContext> {
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
			importRawAdapter(packageName, source, root),
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

async function loadEffectiveConfig(
	paths: ReturnType<typeof workspacePaths>,
	modules: readonly ResolvedModule[],
	configFile: string | undefined,
): Promise<Record<string, Record<string, string>>> {
	return mergeEffectiveConfig(paths, modules, await loadConfigFile(configFile));
}

async function handlePreflight(
	ctx: CliContext,
	args: ParsedArgs,
): Promise<CliOutcome> {
	const modules = await discoverModules({ catalog: ctx.catalog });
	const selected = selectModules(modules, args.positional[0]);
	const config = await loadEffectiveConfig(
		ctx.paths,
		selected,
		args.configFile,
	);
	const result = await runPreflight(selected, {
		config,
		catalog: ctx.catalog,
		paths: ctx.paths,
	});
	const status: CliStatus =
		result.status === "READY"
			? "SUCCEEDED"
			: result.status === "ACTION_REQUIRED"
				? "ACTION_REQUIRED"
				: "BLOCKED";
	return outcome("preflight", status, result);
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
	const config =
		args.intent === "upgrade"
			? await loadEffectiveConfig(ctx.paths, selected, args.configFile)
			: await loadConfigFile(args.configFile);
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
			config,
		});
		await savePlan(ctx.paths, plan);
		return outcome("plan", "SUCCEEDED", {
			planRef: plan.planRef,
			registry: registryUrl,
			plan,
		});
	}
	if (intent === "configure") {
		const plan = planDeployment({ intent, modules: selected, config });
		await savePlan(ctx.paths, plan);
		return outcome("plan", "SUCCEEDED", { planRef: plan.planRef, plan });
	}

	const preflight = await runPreflight(selected, {
		config,
		catalog: ctx.catalog,
		paths: ctx.paths,
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
	const current = await rebuildCurrentAssumptions(ctx.catalog, plan, ctx.paths);
	const result = await applyPlan({
		paths: ctx.paths,
		planRef,
		catalog: ctx.catalog,
		current,
		driver: createWorkspacePackageManagerDriver({
			workspaceRoot: ctx.paths.root,
		}),
		...(plan.intent === "upgrade"
			? {
					refreshCatalog: async () =>
						(await buildContext(ctx.paths.root)).catalog,
				}
			: {}),
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
	if (intent === "upgrade") {
		const data = planned.data;
		if (typeof data === "object" && data !== null && !Array.isArray(data)) {
			const plan = Reflect.get(data, "plan");
			if (
				typeof plan === "object" &&
				plan !== null &&
				!Array.isArray(plan) &&
				Array.isArray(Reflect.get(plan, "steps")) &&
				(Reflect.get(plan, "steps") as unknown[]).length === 0
			) {
				return outcome("upgrade", "SUCCEEDED", {
					...data,
					alreadyLatest: true,
					changed: false,
				});
			}
		}
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
	const refreshed = await buildContext(ctx.paths.root);
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

async function resolveRequestedInstallWorkspace(
	args: ParsedArgs,
	runtime: CliRuntimeOptions,
): Promise<string> {
	const requested = args.workspace ?? runtime.cwd ?? process.cwd();
	return (await canonicalizeWorkspace(requested)).workspaceRealPath;
}

async function handleInstallPlanBeforeBinding(
	args: ParsedArgs,
	runtime: CliRuntimeOptions,
): Promise<CliOutcome> {
	const requestedWorkspace = await resolveRequestedInstallWorkspace(
		args,
		runtime,
	);
	const current = await loadGlobalBinding(runtime.globalRoot);
	if (
		current !== undefined &&
		current.workspaceRealPath !== requestedWorkspace
	) {
		throw new PlatformError(
			"WORKSPACE_ALREADY_BOUND",
			`ProFlow is already bound to ${current.workspaceRealPath}; uninstall it before planning an install for ${requestedWorkspace}`,
		);
	}
	const ctx = await buildContext(
		current?.workspaceRealPath ?? requestedWorkspace,
	);
	const result = await handlePlan(ctx, args);
	return current === undefined ? result : withWorkspace(result, current);
}

async function handleApplyWithGlobalBinding(
	args: ParsedArgs,
	runtime: CliRuntimeOptions,
): Promise<CliOutcome> {
	const planRef = args.positional[0];
	if (planRef === undefined) {
		throw new PlatformError("INVALID_REQUEST", "apply requires <planRef>");
	}
	const operationLock = await acquireGlobalOperationLock(runtime.globalRoot);
	let binding = await loadGlobalBinding(runtime.globalRoot);
	try {
		let ctx: CliContext;
		if (binding === undefined) {
			const requestedWorkspace = await resolveRequestedInstallWorkspace(
				args,
				runtime,
			);
			ctx = await buildContext(requestedWorkspace);
			const plan = await loadPlan(ctx.paths, planRef);
			if (plan === undefined) {
				throw new PlatformError("PLAN_NOT_FOUND", `plan ${planRef} not found`);
			}
			if (plan.intent !== "install") {
				throw new PlatformError(
					"WORKSPACE_NOT_BOUND",
					"only an install plan may establish the first global Workspace binding",
				);
			}
			binding = (
				await claimWorkspaceBinding({
					workspace: requestedWorkspace,
					globalRoot: runtime.globalRoot,
				})
			).binding;
		} else {
			if (args.workspace !== undefined) {
				const requested = await canonicalizeWorkspace(args.workspace);
				if (requested.workspaceRealPath !== binding.workspaceRealPath) {
					throw new PlatformError(
						"WORKSPACE_ALREADY_BOUND",
						`command targets ${requested.workspaceRealPath}, but the global Platform Instance is bound to ${binding.workspaceRealPath}`,
					);
				}
			}
			ctx = await buildContext(binding.workspaceRealPath);
		}

		const plan = await loadPlan(ctx.paths, planRef);
		if (plan === undefined) {
			throw new PlatformError("PLAN_NOT_FOUND", `plan ${planRef} not found`);
		}
		const controlsPlatformState =
			plan.intent === "install" && binding.state !== "INSTALLED";
		if (binding.state === "UNINSTALLING") {
			throw new PlatformError(
				"GLOBAL_OPERATION_LOCKED",
				"the bound Platform Instance is marked UNINSTALLING; finish recovery before apply",
			);
		}
		if (controlsPlatformState && binding.state !== "INSTALLING") {
			binding = await updateGlobalBindingState({
				workspaceInstanceId: binding.workspaceInstanceId,
				state: "INSTALLING",
				globalRoot: runtime.globalRoot,
			});
		}

		try {
			const result = await handleApply(ctx, args);
			if (controlsPlatformState) {
				if (result.status === "SUCCEEDED") {
					binding = await updateGlobalBindingState({
						workspaceInstanceId: binding.workspaceInstanceId,
						state: "INSTALLED",
						globalRoot: runtime.globalRoot,
					});
				} else if (result.status === "FAILED" || result.status === "BLOCKED") {
					binding = await updateGlobalBindingState({
						workspaceInstanceId: binding.workspaceInstanceId,
						state: "BROKEN",
						globalRoot: runtime.globalRoot,
						failure: {
							code: result.error?.code ?? result.status,
							message:
								result.error?.message ??
								"install apply did not reach a successful postcondition",
						},
					});
				}
			}
			return withWorkspace(result, binding);
		} catch (error) {
			if (controlsPlatformState) {
				binding = await updateGlobalBindingState({
					workspaceInstanceId: binding.workspaceInstanceId,
					state: "BROKEN",
					globalRoot: runtime.globalRoot,
					failure: {
						code:
							error instanceof PlatformError ? error.code : "COMMAND_FAILED",
						message: error instanceof Error ? error.message : String(error),
					},
				});
			}
			throw error;
		}
	} finally {
		await operationLock.release();
	}
}

async function handleInstallWithGlobalBinding(
	args: ParsedArgs,
	runtime: CliRuntimeOptions,
): Promise<CliOutcome> {
	const operationLock = await acquireGlobalOperationLock(runtime.globalRoot);
	try {
		const requestedWorkspace = await resolveRequestedInstallWorkspace(
			args,
			runtime,
		);
		const existing = await loadGlobalBinding(runtime.globalRoot);
		if (
			existing !== undefined &&
			existing.workspaceRealPath !== requestedWorkspace
		) {
			throw new PlatformError(
				"WORKSPACE_ALREADY_BOUND",
				`ProFlow is already bound to ${existing.workspaceRealPath}; uninstall it before installing ${requestedWorkspace}`,
			);
		}
		if (existing?.state === "INSTALLED" && args.positional[0] === undefined) {
			return withWorkspace(
				outcome("install", "SUCCEEDED", {
					alreadyInstalled: true,
					changed: false,
					boundWorkspace: existing.workspaceRealPath,
				}),
				existing,
			);
		}
		if (existing?.state === "UNINSTALLING") {
			throw new PlatformError(
				"GLOBAL_OPERATION_LOCKED",
				"the bound Platform Instance is marked UNINSTALLING; finish recovery before installing",
			);
		}

		// Gate A runs before claiming a fresh global binding. Deterministic local
		// failures (package-manager conflict, missing executable, registry down,
		// unwritable Workspace) therefore do not leave a fake BROKEN installation.
		// The global operation lock keeps this preflight + claim sequence atomic
		// against other Platform mutations.
		const installer = await preflightInstallerEnvironment({
			workspaceRoot: requestedWorkspace,
		});
		if (installer.status !== "READY") {
			return outcome(
				"install",
				installer.status === "ACTION_REQUIRED" ? "ACTION_REQUIRED" : "BLOCKED",
				{ requestedWorkspace, preflight: installer },
			);
		}

		const claimed = await claimWorkspaceBinding({
			workspace: requestedWorkspace,
			globalRoot: runtime.globalRoot,
		});
		const initialBinding = claimed.binding;

		let activeBinding = initialBinding;
		const controlsPlatformState =
			!claimed.alreadyBound || initialBinding.state !== "INSTALLED";
		if (controlsPlatformState && initialBinding.state !== "INSTALLING") {
			activeBinding = await updateGlobalBindingState({
				workspaceInstanceId: initialBinding.workspaceInstanceId,
				state: "INSTALLING",
				globalRoot: runtime.globalRoot,
			});
		}

		try {
			const ctx = await buildContext(activeBinding.workspaceRealPath);
			const result = await handleManagedMutation(ctx, args, "install");
			if (controlsPlatformState) {
				if (result.status === "SUCCEEDED") {
					activeBinding = await updateGlobalBindingState({
						workspaceInstanceId: activeBinding.workspaceInstanceId,
						state: "INSTALLED",
						globalRoot: runtime.globalRoot,
					});
				} else if (result.status === "FAILED" || result.status === "BLOCKED") {
					activeBinding = await updateGlobalBindingState({
						workspaceInstanceId: activeBinding.workspaceInstanceId,
						state: "BROKEN",
						globalRoot: runtime.globalRoot,
						failure: {
							code: result.error?.code ?? result.status,
							message:
								result.error?.message ??
								"Platform install did not reach a successful postcondition",
						},
					});
				}
			}
			return withWorkspace(result, activeBinding);
		} catch (error) {
			if (controlsPlatformState) {
				activeBinding = await updateGlobalBindingState({
					workspaceInstanceId: activeBinding.workspaceInstanceId,
					state: "BROKEN",
					globalRoot: runtime.globalRoot,
					failure: {
						code:
							error instanceof PlatformError ? error.code : "COMMAND_FAILED",
						message: error instanceof Error ? error.message : String(error),
					},
				});
			}
			throw error;
		}
	} finally {
		await operationLock.release();
	}
}

async function resolveBoundContext(
	runtime: CliRuntimeOptions,
	requestedWorkspace?: string,
): Promise<{ ctx: CliContext; binding: GlobalWorkspaceBinding }> {
	const binding = await requireBoundWorkspace(runtime.globalRoot);
	if (requestedWorkspace !== undefined) {
		const requested = await canonicalizeWorkspace(requestedWorkspace);
		if (requested.workspaceRealPath !== binding.workspaceRealPath) {
			throw new PlatformError(
				"WORKSPACE_ALREADY_BOUND",
				`command targets ${requested.workspaceRealPath}, but the global Platform Instance is bound to ${binding.workspaceRealPath}`,
			);
		}
	}
	return {
		ctx: await buildContext(binding.workspaceRealPath),
		binding,
	};
}

async function handleBoundMutatingCommand(
	args: ParsedArgs,
	runtime: CliRuntimeOptions,
): Promise<CliOutcome> {
	const operationLock = await acquireGlobalOperationLock(runtime.globalRoot);
	try {
		const { ctx, binding } = await resolveBoundContext(runtime, args.workspace);
		if (binding.state === "UNINSTALLING") {
			throw new PlatformError(
				"GLOBAL_OPERATION_LOCKED",
				"the bound Platform Instance is marked UNINSTALLING; finish uninstall recovery before another mutation",
			);
		}
		let result: CliOutcome;
		if (args.command === "upgrade" || args.command === "uninstall") {
			result = await handleManagedMutation(
				ctx,
				args,
				args.command as "uninstall" | "upgrade",
			);
		} else {
			result = await handleLifecycle(
				ctx,
				args,
				args.command as "start" | "stop" | "restart",
			);
		}
		return withWorkspace(result, binding);
	} finally {
		await operationLock.release();
	}
}

async function handlePlatformInstanceUninstall(
	args: ParsedArgs,
	runtime: CliRuntimeOptions,
): Promise<CliOutcome> {
	const operationLock = await acquireGlobalOperationLock(runtime.globalRoot);
	let binding: GlobalWorkspaceBinding | undefined;
	try {
		binding = await requireBoundWorkspace(runtime.globalRoot);
		if (args.workspace !== undefined) {
			const requested = await canonicalizeWorkspace(args.workspace);
			if (requested.workspaceRealPath !== binding.workspaceRealPath) {
				throw new PlatformError(
					"WORKSPACE_ALREADY_BOUND",
					`uninstall targets ${requested.workspaceRealPath}, but the global Platform Instance is bound to ${binding.workspaceRealPath}`,
				);
			}
		}
		binding = await updateGlobalBindingState({
			workspaceInstanceId: binding.workspaceInstanceId,
			state: "UNINSTALLING",
			globalRoot: runtime.globalRoot,
		});
		const ctx = await buildContext(binding.workspaceRealPath);
		const modules = await discoverModules({ catalog: ctx.catalog });
		let removedModules: string[] = [];
		if (modules.length > 0) {
			const plan = planDeployment({
				intent: "uninstall",
				modules,
				uninstallScope: "platform-instance",
			});
			await savePlan(ctx.paths, plan);
			const current = await rebuildCurrentAssumptions(
				ctx.catalog,
				plan,
				ctx.paths,
			);
			const applied = await applyPlan({
				paths: ctx.paths,
				planRef: plan.planRef,
				catalog: ctx.catalog,
				current,
				driver: createWorkspacePackageManagerDriver({
					workspaceRoot: ctx.paths.root,
				}),
			});
			if (applied.outcome !== "COMPLETE") {
				throw new PlatformError(
					"UNINSTALL_FAILED",
					`Platform Instance uninstall stopped with ${applied.outcome}`,
				);
			}
			removedModules = modules.map((module) => module.moduleRef);
		}

		const refreshed = await buildContext(binding.workspaceRealPath);
		const remaining = await discoverModules({ catalog: refreshed.catalog });
		if (remaining.length > 0) {
			throw new PlatformError(
				"UNINSTALL_FAILED",
				`Platform Instance uninstall left managed modules: ${remaining.map((module) => module.moduleRef).join(", ")}`,
			);
		}

		// Deployment-owned plans/state/verification/instance identity must not leak
		// into a future install of the same directory. Business/domain data outside
		// `.proflow/deployment` is intentionally preserved.
		await rm(ctx.paths.deployment, { recursive: true, force: true });
		const completed = binding;
		await clearGlobalBinding({
			workspaceInstanceId: binding.workspaceInstanceId,
			globalRoot: runtime.globalRoot,
		});
		binding = undefined;
		return outcome("uninstall", "SUCCEEDED", {
			uninstalledWorkspace: completed.workspaceRealPath,
			removedModules,
			bindingCleared: true,
		});
	} catch (error) {
		if (binding !== undefined) {
			await updateGlobalBindingState({
				workspaceInstanceId: binding.workspaceInstanceId,
				state: "BROKEN",
				globalRoot: runtime.globalRoot,
				failure: {
					code:
						error instanceof PlatformError ? error.code : "UNINSTALL_FAILED",
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
		throw error;
	} finally {
		await operationLock.release();
	}
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
	const config = await loadEffectiveConfig(
		ctx.paths,
		selected,
		args.configFile,
	);
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

async function dispatchCommand(
	argv: readonly string[],
	runtime: CliRuntimeOptions = {},
): Promise<CliOutcome> {
	let args: ParsedArgs;
	try {
		args = parseArgs(argv);
	} catch (error) {
		return failure(argv[0] ?? "", error);
	}
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
		const cwd = runtime.cwd ?? process.cwd();
		if (args.command === "search") {
			const current = await loadGlobalBinding(runtime.globalRoot);
			const root = args.workspace ?? current?.workspaceRealPath ?? cwd;
			return await handleSearch(root, args);
		}
		if (args.command === "preflight" && args.intent === "install") {
			const root = await resolveRequestedInstallWorkspace(args, runtime);
			const current = await loadGlobalBinding(runtime.globalRoot);
			if (current !== undefined && current.workspaceRealPath !== root) {
				throw new PlatformError(
					"WORKSPACE_ALREADY_BOUND",
					`ProFlow is already bound to ${current.workspaceRealPath}; uninstall it before installing ${root}`,
				);
			}
			return await handleInstallerPreflight(root);
		}
		if (args.command === "plan") {
			if (args.intent === "install") {
				return await handleInstallPlanBeforeBinding(args, runtime);
			}
			if (
				args.intent === undefined ||
				!["configure", "upgrade", "uninstall", "repair"].includes(args.intent)
			) {
				const current = await loadGlobalBinding(runtime.globalRoot);
				const root =
					args.workspace ??
					current?.workspaceRealPath ??
					runtime.cwd ??
					process.cwd();
				return await handlePlan(await buildContext(root), args);
			}
		}
		if (args.command === "apply") {
			return await handleApplyWithGlobalBinding(args, runtime);
		}
		if (args.command === "install") {
			return await handleInstallWithGlobalBinding(args, runtime);
		}
		if (args.command === "status") {
			const observation = await observeBoundWorkspace(runtime.globalRoot);
			if (observation === undefined) {
				return outcome("status", "SUCCEEDED", {
					installed: false,
					bindingState: "UNBOUND",
					boundWorkspace: null,
					nextAction: "Run platform install [--workspace <path>]",
				});
			}
			if (!observation.workspaceExists) {
				return withWorkspace(
					outcome("status", "BLOCKED", {
						installed: false,
						code: "BOUND_WORKSPACE_MISSING",
						boundWorkspace: observation.binding.workspaceRealPath,
						nextAction:
							"Restore the Workspace or run platform uninstall --forget to clear only the stale binding",
					}),
					observation.binding,
				);
			}
		}
		if (args.command === "uninstall" && args.forget) {
			if (args.positional.length > 0 || args.workspace !== undefined) {
				throw new PlatformError(
					"INVALID_REQUEST",
					"platform uninstall --forget only clears the current stale global binding; do not combine it with a module/package or --workspace",
				);
			}
			const operationLock = await acquireGlobalOperationLock(
				runtime.globalRoot,
			);
			try {
				const forgotten = await forgetMissingWorkspaceBinding({
					globalRoot: runtime.globalRoot,
				});
				return outcome("uninstall", "SUCCEEDED", {
					forgottenWorkspace: forgotten.workspaceRealPath,
					bindingCleared: true,
					resourcesCleaned: false,
				});
			} finally {
				await operationLock.release();
			}
		}
		if (args.command === "uninstall" && args.positional.length === 0) {
			const current = await loadGlobalBinding(runtime.globalRoot);
			if (current === undefined) {
				return outcome("uninstall", "SUCCEEDED", {
					alreadyUninstalled: true,
					bindingCleared: true,
				});
			}
			return await handlePlatformInstanceUninstall(args, runtime);
		}
		if (
			args.command === "upgrade" ||
			(args.command === "uninstall" && args.positional.length > 0) ||
			args.command === "start" ||
			args.command === "stop" ||
			args.command === "restart"
		) {
			return await handleBoundMutatingCommand(args, runtime);
		}

		const { ctx, binding } = await resolveBoundContext(runtime, args.workspace);
		let result: CliOutcome | undefined;
		switch (args.command as Command) {
			case "search":
			case "install":
				throw new PlatformError(
					"COMMAND_FAILED",
					"unreachable command routing",
				);
			case "modules":
				result = await handleModules(ctx, args);
				break;
			case "docs":
				result = await handleDocs(ctx, args);
				break;
			case "uninstall":
			case "upgrade":
			case "start":
			case "stop":
			case "restart":
				throw new PlatformError(
					"COMMAND_FAILED",
					"unreachable mutating command routing",
				);
			case "preflight":
				result = await handlePreflight(ctx, args);
				break;
			case "plan":
				result = await handlePlan(ctx, args);
				break;
			case "apply":
				result = await handleApply(ctx, args);
				break;
			case "status":
				result = await handleLifecycle(ctx, args, "status");
				break;
			case "verify":
				result = await handleVerify(ctx, args);
				break;
			case "doctor":
				result = await handleDoctor(ctx, args);
				break;
			case "manifest":
				result = await handleManifest(ctx, args);
				break;
		}
		if (result === undefined) {
			throw new PlatformError("COMMAND_FAILED", "unreachable command routing");
		}
		return withWorkspace(result, binding);
	} catch (error) {
		return failure(args.command, error);
	}
}

function toMachineResult(outcomeResult: CliOutcome): string {
	const ok = outcomeResult.status === "SUCCEEDED";
	return JSON.stringify({
		contract: "deployment.result.v1",
		ok,
		status: outcomeResult.status,
		moduleRef: MODULE_REF,
		moduleVersion: MODULE_VERSION,
		...(outcomeResult.workspace !== undefined
			? { workspace: outcomeResult.workspace }
			: {}),
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function humanDetailLines(data: unknown): string[] {
	if (!isRecord(data)) {
		return data === undefined ? [] : [String(data)];
	}
	const lines: string[] = [];
	for (const key of [
		"installed",
		"bindingState",
		"boundWorkspace",
		"requestedWorkspace",
		"alreadyInstalled",
		"alreadyLatest",
		"changed",
		"bindingCleared",
		"resourcesCleaned",
		"planRef",
		"outcome",
	] as const) {
		const value = data[key];
		if (
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean"
		) {
			lines.push(`${key}: ${String(value)}`);
		}
	}
	if (typeof data.nextAction === "string" && data.nextAction !== "") {
		lines.push(`Next: ${data.nextAction}`);
	}
	const findings = data.findings;
	let hasMissingConfig = false;
	if (Array.isArray(findings) && findings.length > 0) {
		lines.push("Findings:");
		for (const finding of findings) {
			if (!isRecord(finding)) continue;
			const severity =
				typeof finding.severity === "string"
					? finding.severity.toUpperCase()
					: "INFO";
			const code = typeof finding.code === "string" ? finding.code : "CHECK";
			if (code === "CONFIG_MISSING") hasMissingConfig = true;
			const moduleRef =
				typeof finding.moduleRef === "string" ? ` ${finding.moduleRef}` : "";
			const message =
				typeof finding.message === "string" ? finding.message : "";
			lines.push(
				`- [${severity}] ${code}${moduleRef}${message === "" ? "" : `: ${message}`}`,
			);
		}
	}
	if (hasMissingConfig) {
		lines.push(
			"Next: review .proflow/deployment/generated/INSTALL.md, create the required config file, then run platform plan --intent configure --config <file> and platform apply <planRef>.",
		);
	}
	const preflight = data.preflight;
	if (isRecord(preflight)) {
		const nested = humanDetailLines(preflight);
		if (nested.length > 0) {
			lines.push("Preflight:", ...nested.map((line) => `  ${line}`));
		}
	}
	return lines;
}

export function renderHumanResult(machineOutput: string): string {
	const parsed: unknown = JSON.parse(machineOutput);
	if (!isRecord(parsed)) return machineOutput;
	const data = parsed.data;
	if (isRecord(data) && typeof data.version === "string") {
		return `ProFlow Platform CLI ${data.version}`;
	}
	if (isRecord(data) && typeof data.usage === "string") {
		const commands = Array.isArray(data.commands)
			? data.commands.filter((item): item is string => typeof item === "string")
			: [];
		const examples = Array.isArray(data.examples)
			? data.examples.filter((item): item is string => typeof item === "string")
			: [];
		return [
			"ProFlow Platform CLI",
			"",
			`Usage: ${data.usage}`,
			...(commands.length === 0
				? []
				: ["", `Commands: ${commands.join(", ")}`]),
			...(examples.length === 0
				? []
				: ["", "Common flows:", ...examples.map((item) => `  ${item}`)]),
		].join("\n");
	}

	const status = typeof parsed.status === "string" ? parsed.status : "UNKNOWN";
	const lines = [`ProFlow: ${status}`];
	const workspace = parsed.workspace;
	if (isRecord(workspace) && typeof workspace.boundWorkspace === "string") {
		lines.push(`Workspace: ${workspace.boundWorkspace}`);
	}
	const error = parsed.error;
	if (isRecord(error)) {
		const code = typeof error.code === "string" ? error.code : "COMMAND_FAILED";
		const message =
			typeof error.message === "string" ? error.message : "Unknown error";
		lines.push(`Error: ${code}: ${message}`);
	}
	lines.push(...humanDetailLines(data));
	if (lines.length === 1 && status === "SUCCEEDED") {
		lines.push(`Version: ${MODULE_VERSION}`, "Next: run platform --help");
	}
	return lines.join("\n");
}

export async function runCli(
	argv: readonly string[],
	runtime: CliRuntimeOptions = {},
): Promise<string> {
	const filtered = argv.filter((argument) => argument !== "--json");
	if (
		filtered.length === 1 &&
		(filtered[0] === "--version" || filtered[0] === "-v")
	) {
		return JSON.stringify({
			contract: "deployment.result.v1",
			ok: true,
			status: "SUCCEEDED",
			moduleRef: MODULE_REF,
			moduleVersion: MODULE_VERSION,
			data: { version: MODULE_VERSION },
		});
	}
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
				examples: [
					"platform preflight --intent install --workspace <path>",
					"platform install [module|package] [--workspace <path>]",
					"platform preflight  # startup/runtime readiness for the bound Workspace",
					"platform plan --intent configure --config <file>",
					"platform apply <planRef>",
					"platform start | status | verify | doctor | stop | restart",
					"platform uninstall  # uninstall the bound Platform Instance, not the global CLI",
					"append --json for the stable machine-readable contract",
				],
			},
		});
	}
	if (filtered.length === 0) {
		return JSON.stringify({
			contract: "deployment.result.v1",
			ok: true,
			status: "SUCCEEDED",
			moduleRef: MODULE_REF,
			moduleVersion: MODULE_VERSION,
		});
	}
	return toMachineResult(await dispatchCommand(filtered, runtime));
}

if (import.meta.main) {
	const argv = process.argv.slice(2);
	const output = await runCli(argv);
	const rendered = argv.includes("--json") ? output : renderHumanResult(output);
	process.stdout.write(`${rendered}\n`);
	const parsed: unknown = JSON.parse(output);
	if (
		typeof parsed === "object" &&
		parsed !== null &&
		Reflect.get(parsed, "ok") === false
	) {
		process.exitCode = 1;
	}
}
