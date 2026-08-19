import {
	type LifecyclePrimitive,
	type ModuleOperationResult,
	moduleOperationResultSchema,
} from "@tomflow/proflow-module-contract";

import type { ResolvedModule } from "../contracts.ts";
import { PlatformError } from "../errors.ts";
import { buildDependencyGraph } from "../graph/graph.ts";
import type { ModuleCatalog, ModuleSource } from "../modules.ts";

export interface LifecycleDispatchResult {
	moduleRef: string;
	primitive: LifecyclePrimitive;
	result: ModuleOperationResult;
	observedEffects: string[];
}

export type LifecycleRunStatus = "EXECUTED" | "SKIP_UNSUPPORTED";

export interface LifecycleRunResult {
	moduleRef: string;
	primitive: LifecyclePrimitive;
	status: LifecycleRunStatus;
	result: ModuleOperationResult | undefined;
	observedEffects: string[];
}

type PrimitiveFn = () => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isPrimitiveFn(value: unknown): value is PrimitiveFn {
	return typeof value === "function";
}

function isWrappedResult(
	value: unknown,
): value is { result?: unknown; observedEffects?: unknown } {
	return isRecord(value) && "result" in value;
}

function moduleSource(module: ResolvedModule): ModuleSource {
	if (module.source.type === "registry") {
		throw new PlatformError(
			"DESCRIPTOR_INVALID",
			`registry bootstrap target ${module.packageName} has no local lifecycle adapter`,
		);
	}
	const source: ModuleSource = {
		type: module.source.type,
		packageName: module.packageName,
	};
	if (module.source.path !== undefined) source.path = module.source.path;
	return source;
}

function resolveBehaviorAdapter(namespace: unknown): Record<string, unknown> {
	if (!isRecord(namespace)) {
		throw new PlatformError(
			"COMMAND_FAILED",
			"lifecycle adapter namespace is not an object",
		);
	}
	const behaviorAdapter = namespace.behaviorAdapter;
	if (!isRecord(behaviorAdapter)) {
		throw new PlatformError(
			"COMMAND_FAILED",
			"lifecycle adapter exposes no behaviorAdapter object",
		);
	}
	return behaviorAdapter;
}

function observedEffectsOf(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

function normalizeInvocation(raw: unknown): {
	result: unknown;
	observedEffects: string[];
} {
	if (isWrappedResult(raw)) {
		return {
			result: raw.result,
			observedEffects: observedEffectsOf(raw.observedEffects),
		};
	}
	return { result: raw, observedEffects: [] };
}

/**
 * Dispatches a single lifecycle primitive against one module through its
 * public deployment adapter. The descriptor is the source of truth for what is
 * supported: a primitive not declared in `lifecycle` is rejected with
 * `LIFECYCLE_UNSUPPORTED` rather than faked. The adapter result is always
 * runtime-validated against the Module Operation Result schema.
 */
export async function dispatchLifecycle(
	catalog: ModuleCatalog,
	module: ResolvedModule,
	primitive: LifecyclePrimitive,
): Promise<LifecycleDispatchResult> {
	if (!module.lifecycle.includes(primitive)) {
		throw new PlatformError(
			"LIFECYCLE_UNSUPPORTED",
			`module ${module.moduleRef} does not declare lifecycle primitive "${primitive}"`,
		);
	}

	const namespace = await catalog.loadAdapter(moduleSource(module));
	const adapter = resolveBehaviorAdapter(namespace);
	const invoke = adapter[primitive];
	if (!isPrimitiveFn(invoke)) {
		throw new PlatformError(
			"COMMAND_FAILED",
			`module ${module.moduleRef} declares "${primitive}" but its adapter does not implement it`,
		);
	}

	const { result, observedEffects } = normalizeInvocation(await invoke());
	const parsed = moduleOperationResultSchema.safeParse(result);
	if (!parsed.success) {
		throw new PlatformError(
			"COMMAND_FAILED",
			`module ${module.moduleRef} "${primitive}" returned an invalid result: ${parsed.error.message}`,
		);
	}

	return {
		moduleRef: module.moduleRef,
		primitive,
		result: parsed.data,
		observedEffects,
	};
}

async function runOne(
	catalog: ModuleCatalog,
	module: ResolvedModule,
	primitive: LifecyclePrimitive,
): Promise<LifecycleRunResult> {
	if (!module.lifecycle.includes(primitive)) {
		return {
			moduleRef: module.moduleRef,
			primitive,
			status: "SKIP_UNSUPPORTED",
			result: undefined,
			observedEffects: [],
		};
	}
	const dispatched = await dispatchLifecycle(catalog, module, primitive);
	return {
		moduleRef: dispatched.moduleRef,
		primitive,
		status: "EXECUTED",
		result: dispatched.result,
		observedEffects: dispatched.observedEffects,
	};
}

async function runInOrder(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
	order: readonly string[],
	primitive: LifecyclePrimitive,
): Promise<LifecycleRunResult[]> {
	const byRef = new Map(modules.map((module) => [module.moduleRef, module]));
	const results: LifecycleRunResult[] = [];
	for (const moduleRef of order) {
		const module = byRef.get(moduleRef);
		if (module === undefined) continue;
		results.push(await runOne(catalog, module, primitive));
	}
	return results;
}

/**
 * Starts a module set in forward dependency topological order, dispatching the
 * `start` primitive only to modules that declare it.
 */
export async function startModules(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
): Promise<LifecycleRunResult[]> {
	const graph = buildDependencyGraph(modules);
	const byRef = new Map(modules.map((module) => [module.moduleRef, module]));
	const resultByRef = new Map<string, LifecycleRunResult>();
	const results: LifecycleRunResult[] = [];

	for (const moduleRef of graph.order) {
		const module = byRef.get(moduleRef);
		if (module === undefined) continue;
		if (!module.lifecycle.includes("start")) {
			const skipped = await runOne(catalog, module, "start");
			results.push(skipped);
			resultByRef.set(moduleRef, skipped);
			continue;
		}

		const blockingDependency = graph.edges
			.filter((edge) => edge.from === moduleRef)
			.map((edge) => edge.to)
			.find((dependencyRef) => {
				const dependencyModule = byRef.get(dependencyRef);
				if (!dependencyModule?.lifecycle.includes("start")) return false;
				const dependencyResult = resultByRef.get(dependencyRef);
				return dependencyResult?.result?.status !== "SUCCEEDED";
			});

		if (blockingDependency !== undefined) {
			const blocked: LifecycleRunResult = {
				moduleRef,
				primitive: "start",
				status: "EXECUTED",
				result: {
					contract: "deployment.result.v1",
					ok: false,
					status: "BLOCKED",
					moduleRef: module.moduleRef,
					moduleVersion: module.moduleVersion,
					error: {
						code: "COMMAND_FAILED",
						message: `dependency ${blockingDependency} did not start successfully; ${moduleRef} was not started`,
						retryable: true,
					},
				},
				observedEffects: [],
			};
			results.push(blocked);
			resultByRef.set(moduleRef, blocked);
			continue;
		}

		const result = await runOne(catalog, module, "start");
		results.push(result);
		resultByRef.set(moduleRef, result);
	}
	return results;
}

/**
 * Stops a module set in reverse dependency topological order, dispatching the
 * `stop` primitive only to modules that declare it.
 */
export async function stopModules(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
): Promise<LifecycleRunResult[]> {
	const order = [...buildDependencyGraph(modules).order].reverse();
	return runInOrder(catalog, modules, order, "stop");
}

/**
 * Restarts a module set as a platform-level stop → start sequence. Stop runs in
 * reverse dependency order; only after every executed stop succeeds does start
 * run in forward dependency order with the same dependency blocking rules as a
 * normal start. Module-native `restart` primitives are not used here.
 */
export async function restartModules(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
): Promise<LifecycleRunResult[]> {
	const stopped = await stopModules(catalog, modules);
	const stopBlocked = stopped.some(
		(item) => item.result !== undefined && item.result.status !== "SUCCEEDED",
	);
	if (stopBlocked) return stopped;
	return startModules(catalog, modules);
}

/**
 * Queries current reality by dispatching the `status` primitive to every
 * module that declares it. Status is always read live from the adapter; no
 * persisted or cached value is substituted for current reality.
 */
export async function statusModules(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
): Promise<LifecycleRunResult[]> {
	const results: LifecycleRunResult[] = [];
	for (const module of modules) {
		results.push(await runOne(catalog, module, "status"));
	}
	return results;
}
