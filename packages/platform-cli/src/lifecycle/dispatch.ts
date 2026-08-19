import {
	type LifecyclePrimitive,
	type ModuleOperationResult,
	moduleOperationResultSchema,
} from "@tomflow/proflow-module-contract";

import type { ResolvedModule } from "../contracts.ts";
import { PlatformError } from "../errors.ts";
import type { ModuleCatalog, ModuleSource } from "../modules.ts";

export interface LifecycleDispatchResult {
	moduleRef: string;
	primitive: LifecyclePrimitive;
	result: ModuleOperationResult;
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
