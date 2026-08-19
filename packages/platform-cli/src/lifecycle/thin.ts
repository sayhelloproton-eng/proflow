import type { ModuleOperationResult } from "@tomflow/proflow-module-contract";

import type { ResolvedModule } from "../contracts.ts";
import { buildDependencyGraph } from "../graph/graph.ts";
import type { ModuleCatalog } from "../modules.ts";
import { dispatchLifecycle, type LifecycleDispatchResult } from "./dispatch.ts";

export interface ThinLifecycleResult {
	phase: "preflight" | "start" | "stop";
	results: LifecycleDispatchResult[];
	completed: boolean;
}

function succeeded(result: ModuleOperationResult): boolean {
	return result.status === "SUCCEEDED";
}

async function dispatchIfSupported(
	catalog: ModuleCatalog,
	module: ResolvedModule,
	primitive: "preflight" | "start" | "stop",
): Promise<LifecycleDispatchResult | undefined> {
	if (!module.lifecycle.includes(primitive)) return undefined;
	return dispatchLifecycle(catalog, module, primitive);
}
export async function observeStatuses(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
): Promise<LifecycleDispatchResult[]> {
	const results: LifecycleDispatchResult[] = [];
	for (const module of [...modules].sort((a, b) =>
		a.moduleRef.localeCompare(b.moduleRef),
	)) {
		if (!module.lifecycle.includes("status")) continue;
		results.push(await dispatchLifecycle(catalog, module, "status"));
	}
	return results;
}

export async function preflightAndStartModules(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
): Promise<ThinLifecycleResult> {
	const graph = buildDependencyGraph(modules);
	const byRef = new Map(modules.map((module) => [module.moduleRef, module]));
	const preflight: LifecycleDispatchResult[] = [];
	for (const moduleRef of graph.order) {
		const module = byRef.get(moduleRef);
		if (module === undefined) continue;
		const result = await dispatchIfSupported(catalog, module, "preflight");
		if (result === undefined) continue;
		preflight.push(result);
		if (!succeeded(result.result)) {
			return { phase: "preflight", results: preflight, completed: false };
		}
	}
	const started: LifecycleDispatchResult[] = [];
	for (const moduleRef of graph.order) {
		const module = byRef.get(moduleRef);
		if (module === undefined) continue;
		const result = await dispatchIfSupported(catalog, module, "start");
		if (result === undefined) continue;
		started.push(result);
		if (!succeeded(result.result)) {
			return { phase: "start", results: started, completed: false };
		}
	}
	return { phase: "start", results: started, completed: true };
}

export async function stopModulesThin(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
): Promise<ThinLifecycleResult> {
	const order = [...buildDependencyGraph(modules).order].reverse();
	const byRef = new Map(modules.map((module) => [module.moduleRef, module]));
	const stopped: LifecycleDispatchResult[] = [];
	for (const moduleRef of order) {
		const module = byRef.get(moduleRef);
		if (module === undefined) continue;
		const result = await dispatchIfSupported(catalog, module, "stop");
		if (result === undefined) continue;
		stopped.push(result);
		if (!succeeded(result.result)) {
			return { phase: "stop", results: stopped, completed: false };
		}
	}
	return { phase: "stop", results: stopped, completed: true };
}
