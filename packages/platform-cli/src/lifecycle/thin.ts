import {
	type ModuleOperationResult,
	type ModuleSetupStatus,
	moduleStatusObservationSchema,
} from "@tomflow/proflow-module-contract";

import type { ResolvedModule } from "../contracts.ts";
import { PlatformError } from "../errors.ts";
import { buildDependencyGraph } from "../graph/graph.ts";
import type { ModuleCatalog } from "../modules.ts";
import {
	dispatchModuleCommand,
	type ModuleDispatchResult,
} from "./dispatch.ts";

export interface ModuleBatchResult {
	phase: "install" | "uninstall" | "setup" | "start" | "stop";
	results: ModuleDispatchResult[];
	completed: boolean;
	blockedBy?: { moduleRef: string; setupStatus: ModuleSetupStatus };
}
const succeeded = (result: ModuleOperationResult) =>
	result.status === "SUCCEEDED";
const context = (workspaceRoot: string, input?: unknown) =>
	input === undefined ? { workspaceRoot } : { workspaceRoot, input };
function ordered(modules: readonly ResolvedModule[], reverse = false) {
	const graph = buildDependencyGraph(modules);
	const refs = reverse ? [...graph.order].reverse() : [...graph.order];
	const byRef = new Map(modules.map((module) => [module.moduleRef, module]));
	return refs
		.map((ref) => byRef.get(ref))
		.filter((item): item is ResolvedModule => item !== undefined);
}
export async function observeStatuses(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
	workspaceRoot: string,
) {
	const results: ModuleDispatchResult[] = [];
	for (const module of [...modules].sort((a, b) =>
		a.moduleRef.localeCompare(b.moduleRef),
	))
		results.push(
			await dispatchModuleCommand(
				catalog,
				module,
				"status",
				context(workspaceRoot),
			),
		);
	return results;
}
export async function observeDocs(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
	workspaceRoot: string,
) {
	const results: ModuleDispatchResult[] = [];
	for (const module of [...modules].sort((a, b) =>
		a.moduleRef.localeCompare(b.moduleRef),
	))
		results.push(
			await dispatchModuleCommand(
				catalog,
				module,
				"docs",
				context(workspaceRoot),
			),
		);
	return results;
}
async function runOrdered(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
	workspaceRoot: string,
	command: "install" | "uninstall" | "stop",
	reverse: boolean,
): Promise<ModuleBatchResult> {
	const results: ModuleDispatchResult[] = [];
	for (const module of ordered(modules, reverse)) {
		const result = await dispatchModuleCommand(
			catalog,
			module,
			command,
			context(workspaceRoot),
		);
		results.push(result);
		if (!succeeded(result.result))
			return { phase: command, results, completed: false };
	}
	return { phase: command, results, completed: true };
}
export const installModulesThin = (
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
	workspaceRoot: string,
) => runOrdered(catalog, modules, workspaceRoot, "install", false);
export const uninstallModulesThin = (
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
	workspaceRoot: string,
) => runOrdered(catalog, modules, workspaceRoot, "uninstall", true);
export const stopModulesThin = (
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
	workspaceRoot: string,
) => runOrdered(catalog, modules, workspaceRoot, "stop", true);
export async function setupModulesThin(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
	workspaceRoot: string,
	target?: { moduleRef: string; input?: unknown },
): Promise<ModuleBatchResult> {
	const results: ModuleDispatchResult[] = [];
	let matched = target === undefined;
	for (const module of ordered(modules)) {
		if (target !== undefined && module.moduleRef !== target.moduleRef) continue;
		matched = true;
		const status = await dispatchModuleCommand(
			catalog,
			module,
			"status",
			context(workspaceRoot),
		);
		if (!succeeded(status.result))
			return {
				phase: "setup",
				results: [...results, status],
				completed: false,
			};
		const observed = moduleStatusObservationSchema.parse(status.result.data);
		if (observed.setupStatus === "READY" && target?.input === undefined)
			continue;
		const setup = await dispatchModuleCommand(
			catalog,
			module,
			"setup",
			context(workspaceRoot, target?.input),
		);
		results.push(setup);
		if (!succeeded(setup.result))
			return { phase: "setup", results, completed: false };
	}
	if (!matched)
		throw new PlatformError(
			"INVALID_REQUEST",
			`setup target module ${target?.moduleRef ?? ""} was not discovered`,
		);
	return { phase: "setup", results, completed: true };
}
export async function startModulesThin(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
	workspaceRoot: string,
): Promise<ModuleBatchResult> {
	const results: ModuleDispatchResult[] = [];
	for (const module of ordered(modules)) {
		const status = await dispatchModuleCommand(
			catalog,
			module,
			"status",
			context(workspaceRoot),
		);
		if (!succeeded(status.result))
			return {
				phase: "start",
				results: [...results, status],
				completed: false,
			};
		const observed = moduleStatusObservationSchema.parse(status.result.data);
		if (observed.setupStatus !== "READY")
			return {
				phase: "start",
				results: [...results, status],
				completed: false,
				blockedBy: {
					moduleRef: module.moduleRef,
					setupStatus: observed.setupStatus,
				},
			};
		const started = await dispatchModuleCommand(
			catalog,
			module,
			"start",
			context(workspaceRoot),
		);
		results.push(started);
		if (!succeeded(started.result))
			return { phase: "start", results, completed: false };
	}
	return { phase: "start", results, completed: true };
}
