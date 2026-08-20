import {
	type ModuleCommandContext,
	type ModuleManagementCommand,
	type ModuleOperationResult,
	moduleOperationResultSchema,
} from "@tomflow/proflow-module-contract";

import type { ResolvedModule } from "../contracts.ts";
import { PlatformError } from "../errors.ts";
import type { ModuleCatalog, ModuleSource } from "../modules.ts";

export interface ModuleDispatchResult {
	moduleRef: string;
	command: ModuleManagementCommand;
	result: ModuleOperationResult;
	observedEffects: string[];
}

type ModuleCommandFn = (context: ModuleCommandContext) => unknown;
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const isCommandFn = (value: unknown): value is ModuleCommandFn =>
	typeof value === "function";
function moduleSource(module: ResolvedModule): ModuleSource {
	return module.source.path === undefined
		? { type: module.source.type, packageName: module.packageName }
		: {
				type: module.source.type,
				packageName: module.packageName,
				path: module.source.path,
			};
}
function resolveBehaviorAdapter(namespace: unknown): Record<string, unknown> {
	if (!isRecord(namespace) || !isRecord(namespace.behaviorAdapter))
		throw new PlatformError(
			"COMMAND_FAILED",
			"module adapter exposes no behaviorAdapter object",
		);
	return namespace.behaviorAdapter;
}
function normalizeInvocation(raw: unknown): {
	result: unknown;
	observedEffects: string[];
} {
	if (!isRecord(raw) || !("result" in raw))
		return { result: raw, observedEffects: [] };
	return {
		result: raw.result,
		observedEffects: Array.isArray(raw.observedEffects)
			? raw.observedEffects.filter(
					(item): item is string => typeof item === "string",
				)
			: [],
	};
}
export async function dispatchModuleCommand(
	catalog: ModuleCatalog,
	module: ResolvedModule,
	command: ModuleManagementCommand,
	context: ModuleCommandContext,
): Promise<ModuleDispatchResult> {
	const namespace = await catalog.loadAdapter(moduleSource(module));
	const adapter = resolveBehaviorAdapter(namespace);
	const invoke = adapter[command];
	if (!isCommandFn(invoke))
		throw new PlatformError(
			"COMMAND_FAILED",
			`module ${module.moduleRef} does not implement standard command "${command}"`,
		);
	const { result, observedEffects } = normalizeInvocation(
		await invoke(context),
	);
	const parsed = moduleOperationResultSchema.safeParse(result);
	if (!parsed.success)
		throw new PlatformError(
			"COMMAND_FAILED",
			`module ${module.moduleRef} "${command}" returned an invalid result: ${parsed.error.message}`,
		);
	return {
		moduleRef: module.moduleRef,
		command,
		result: parsed.data,
		observedEffects,
	};
}
