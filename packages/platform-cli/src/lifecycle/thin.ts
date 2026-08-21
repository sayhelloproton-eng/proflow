import {
	type ModuleOperationResult,
	type ModuleSetupStatus,
	moduleStatusObservationSchema,
} from "@tomflow/proflow-module-contract";

import type { ResolvedModule } from "../contracts.ts";
import { PlatformError } from "../errors.ts";
import { buildDependencyGraph } from "../graph/graph.ts";
import type { ModuleCatalog } from "../modules.ts";
import { type PlatformProgressReporter, reportProgress } from "../progress.ts";
import {
	dispatchModuleCommand,
	type ModuleDispatchResult,
} from "./dispatch.ts";

export interface ModuleBatchResult {
	phase: "install" | "uninstall" | "setup" | "start" | "stop";
	results: ModuleDispatchResult[];
	completed: boolean;
	blockedBy?: { moduleRef: string; setupStatus: ModuleSetupStatus };
	blockers?: Array<{ moduleRef: string; setupStatus: ModuleSetupStatus }>;
	skipped?: Array<{
		moduleRef: string;
		reason: "READY" | "RUNNING" | "STOPPED" | "NOT_APPLICABLE" | "NO_EFFECT";
	}>;
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
	reporter?: PlatformProgressReporter,
) {
	const results: ModuleDispatchResult[] = [];
	const modulesInOrder = [...modules].sort((a, b) =>
		a.moduleRef.localeCompare(b.moduleRef),
	);
	for (const [index, module] of modulesInOrder.entries()) {
		reportProgress(reporter, {
			command: "status",
			phase: "status",
			current: index + 1,
			total: modulesInOrder.length,
			moduleRef: module.moduleRef,
			status: "STARTED",
			message: module.moduleRef,
		});
		const result = await dispatchModuleCommand(
			catalog,
			module,
			"status",
			context(workspaceRoot),
		);
		results.push(result);
		reportProgress(reporter, {
			command: "status",
			phase: "status",
			current: index + 1,
			total: modulesInOrder.length,
			moduleRef: module.moduleRef,
			status: succeeded(result.result) ? "SUCCEEDED" : "FAILED",
			message: module.moduleRef,
		});
	}
	return results;
}
export async function observeDocs(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
	workspaceRoot: string,
	reporter?: PlatformProgressReporter,
) {
	const results: ModuleDispatchResult[] = [];
	const modulesInOrder = [...modules].sort((a, b) =>
		a.moduleRef.localeCompare(b.moduleRef),
	);
	for (const [index, module] of modulesInOrder.entries()) {
		reportProgress(reporter, {
			command: "docs",
			phase: "docs",
			current: index + 1,
			total: modulesInOrder.length,
			moduleRef: module.moduleRef,
			status: "STARTED",
			message: module.moduleRef,
		});
		const result = await dispatchModuleCommand(
			catalog,
			module,
			"docs",
			context(workspaceRoot),
		);
		results.push(result);
		reportProgress(reporter, {
			command: "docs",
			phase: "docs",
			current: index + 1,
			total: modulesInOrder.length,
			moduleRef: module.moduleRef,
			status: succeeded(result.result) ? "SUCCEEDED" : "FAILED",
			message: module.moduleRef,
		});
	}
	return results;
}
async function runOrdered(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
	workspaceRoot: string,
	command: "install" | "uninstall" | "stop",
	reverse: boolean,
	reporter?: PlatformProgressReporter,
): Promise<ModuleBatchResult> {
	const results: ModuleDispatchResult[] = [];
	const modulesInOrder = ordered(modules, reverse);
	for (const [index, module] of modulesInOrder.entries()) {
		reportProgress(reporter, {
			command,
			phase: command,
			current: index + 1,
			total: modulesInOrder.length,
			moduleRef: module.moduleRef,
			status: "STARTED",
			message: `${module.moduleRef}`,
		});
		const result = await dispatchModuleCommand(
			catalog,
			module,
			command,
			context(workspaceRoot),
		);
		results.push(result);
		reportProgress(reporter, {
			command,
			phase: command,
			current: index + 1,
			total: modulesInOrder.length,
			moduleRef: module.moduleRef,
			status: succeeded(result.result) ? "SUCCEEDED" : "FAILED",
			message: `${module.moduleRef}`,
		});
		if (!succeeded(result.result))
			return { phase: command, results, completed: false };
	}
	return { phase: command, results, completed: true };
}
export const installModulesThin = (
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
	workspaceRoot: string,
	reporter?: PlatformProgressReporter,
) => runOrdered(catalog, modules, workspaceRoot, "install", false, reporter);
export const uninstallModulesThin = (
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
	workspaceRoot: string,
	reporter?: PlatformProgressReporter,
) => runOrdered(catalog, modules, workspaceRoot, "uninstall", true, reporter);
export async function stopModulesThin(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
	workspaceRoot: string,
	reporter?: PlatformProgressReporter,
): Promise<ModuleBatchResult> {
	const results: ModuleDispatchResult[] = [];
	const skipped: NonNullable<ModuleBatchResult["skipped"]> = [];
	const modulesInOrder = ordered(modules, true);
	for (const [index, module] of modulesInOrder.entries()) {
		reportProgress(reporter, {
			command: "stop",
			phase: "status",
			current: index + 1,
			total: modulesInOrder.length,
			moduleRef: module.moduleRef,
			status: "STARTED",
			message: `${module.moduleRef}`,
		});
		const status = await dispatchModuleCommand(
			catalog,
			module,
			"status",
			context(workspaceRoot),
		);
		results.push(status);
		if (!succeeded(status.result))
			return { phase: "stop", results, completed: false, skipped };
		const observed = moduleStatusObservationSchema.parse(status.result.data);
		if (
			observed.runtimeStatus === "STOPPED" ||
			observed.runtimeStatus === "NOT_APPLICABLE"
		) {
			skipped.push({
				moduleRef: module.moduleRef,
				reason: observed.runtimeStatus,
			});
			reportProgress(reporter, {
				command: "stop",
				phase: "stop",
				current: index + 1,
				total: modulesInOrder.length,
				moduleRef: module.moduleRef,
				status: "SKIPPED",
				message: `${module.moduleRef}`,
			});
			continue;
		}
		const stopped = await dispatchModuleCommand(
			catalog,
			module,
			"stop",
			context(workspaceRoot),
		);
		results.push(stopped);
		const noOwnedEffect =
			succeeded(stopped.result) && stopped.observedEffects.length === 0;
		if (noOwnedEffect)
			skipped.push({ moduleRef: module.moduleRef, reason: "NO_EFFECT" });
		reportProgress(reporter, {
			command: "stop",
			phase: "stop",
			current: index + 1,
			total: modulesInOrder.length,
			moduleRef: module.moduleRef,
			status: noOwnedEffect
				? "SKIPPED"
				: succeeded(stopped.result)
					? "SUCCEEDED"
					: "FAILED",
			message: `${module.moduleRef}`,
		});
		if (!succeeded(stopped.result))
			return { phase: "stop", results, completed: false, skipped };
	}
	return { phase: "stop", results, completed: true, skipped };
}
export async function setupModulesThin(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
	workspaceRoot: string,
	target?: { moduleRef: string; input?: unknown },
	reporter?: PlatformProgressReporter,
): Promise<ModuleBatchResult> {
	const results: ModuleDispatchResult[] = [];
	const skipped: NonNullable<ModuleBatchResult["skipped"]> = [];
	let matched = target === undefined;
	let completed = true;
	const modulesInOrder = ordered(modules);
	for (const [index, module] of modulesInOrder.entries()) {
		if (target !== undefined && module.moduleRef !== target.moduleRef) continue;
		reportProgress(reporter, {
			command: "setup",
			phase: "setup",
			current: index + 1,
			total: modulesInOrder.length,
			moduleRef: module.moduleRef,
			status: "STARTED",
			message: module.moduleRef,
		});
		matched = true;
		const status = await dispatchModuleCommand(
			catalog,
			module,
			"status",
			context(workspaceRoot),
		);
		if (!succeeded(status.result)) {
			results.push(status);
			completed = false;
			if (target !== undefined) break;
			continue;
		}
		const observed = moduleStatusObservationSchema.parse(status.result.data);
		if (observed.setupStatus === "READY" && target?.input === undefined) {
			skipped.push({ moduleRef: module.moduleRef, reason: "READY" });
			reportProgress(reporter, {
				command: "setup",
				phase: "setup",
				current: index + 1,
				total: modulesInOrder.length,
				moduleRef: module.moduleRef,
				status: "SKIPPED",
				message: module.moduleRef,
			});
			continue;
		}
		const setup = await dispatchModuleCommand(
			catalog,
			module,
			"setup",
			context(workspaceRoot, target?.input),
		);
		results.push(setup);
		reportProgress(reporter, {
			command: "setup",
			phase: "setup",
			current: index + 1,
			total: modulesInOrder.length,
			moduleRef: module.moduleRef,
			status: succeeded(setup.result)
				? "SUCCEEDED"
				: setup.result.status === "ACTION_REQUIRED"
					? "ACTION_REQUIRED"
					: "FAILED",
			message: module.moduleRef,
		});
		if (!succeeded(setup.result)) {
			completed = false;
			if (target !== undefined) break;
		}
	}
	if (!matched)
		throw new PlatformError(
			"INVALID_REQUEST",
			`setup target module ${target?.moduleRef ?? ""} was not discovered`,
		);
	return { phase: "setup", results, completed, skipped };
}
export async function startModulesThin(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
	workspaceRoot: string,
	reporter?: PlatformProgressReporter,
): Promise<ModuleBatchResult> {
	const results: ModuleDispatchResult[] = [];
	const modulesInOrder = ordered(modules);
	const blockers: NonNullable<ModuleBatchResult["blockers"]> = [];
	const runtimeByRef = new Map<
		string,
		ReturnType<typeof moduleStatusObservationSchema.parse>["runtimeStatus"]
	>();
	for (const [index, module] of modulesInOrder.entries()) {
		reportProgress(reporter, {
			command: "start",
			phase: "status",
			current: index + 1,
			total: modulesInOrder.length,
			moduleRef: module.moduleRef,
			status: "STARTED",
			message: `${module.moduleRef}`,
		});
		const status = await dispatchModuleCommand(
			catalog,
			module,
			"status",
			context(workspaceRoot),
		);
		results.push(status);
		reportProgress(reporter, {
			command: "start",
			phase: "status",
			current: index + 1,
			total: modulesInOrder.length,
			moduleRef: module.moduleRef,
			status: succeeded(status.result) ? "SUCCEEDED" : "FAILED",
			message: `${module.moduleRef}`,
		});
		if (!succeeded(status.result)) {
			blockers.push({ moduleRef: module.moduleRef, setupStatus: "FAILED" });
			continue;
		}
		const observed = moduleStatusObservationSchema.parse(status.result.data);
		runtimeByRef.set(module.moduleRef, observed.runtimeStatus);
		if (observed.setupStatus !== "READY")
			blockers.push({
				moduleRef: module.moduleRef,
				setupStatus: observed.setupStatus,
			});
	}
	if (results.some((item) => !succeeded(item.result)) || blockers.length > 0)
		return {
			phase: "start",
			results,
			completed: false,
			...(blockers[0] ? { blockedBy: blockers[0], blockers } : {}),
		};
	const skipped: NonNullable<ModuleBatchResult["skipped"]> = [];
	for (const [index, module] of modulesInOrder.entries()) {
		const runtimeStatus = runtimeByRef.get(module.moduleRef);
		if (runtimeStatus === "RUNNING" || runtimeStatus === "NOT_APPLICABLE") {
			skipped.push({ moduleRef: module.moduleRef, reason: runtimeStatus });
			reportProgress(reporter, {
				command: "start",
				phase: "start",
				current: index + 1,
				total: modulesInOrder.length,
				moduleRef: module.moduleRef,
				status: "SKIPPED",
				message: `${module.moduleRef}`,
			});
			continue;
		}
		const started = await dispatchModuleCommand(
			catalog,
			module,
			"start",
			context(workspaceRoot),
		);
		results.push(started);
		reportProgress(reporter, {
			command: "start",
			phase: "start",
			current: index + 1,
			total: modulesInOrder.length,
			moduleRef: module.moduleRef,
			status: succeeded(started.result) ? "SUCCEEDED" : "FAILED",
			message: `${module.moduleRef}`,
		});
		if (!succeeded(started.result))
			return { phase: "start", results, completed: false, skipped };
	}
	return { phase: "start", results, completed: true, skipped };
}
