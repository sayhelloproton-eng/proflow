import type {
	HumanAction,
	LifecyclePrimitive,
	ModuleOperationResult,
} from "@tomflow/proflow-module-contract";

import type {
	DeploymentPlan,
	DeploymentStep,
	ResolvedModule,
} from "../contracts.ts";
import { PlatformError } from "../errors.ts";
import { dispatchLifecycle } from "../lifecycle/index.ts";
import type { ModuleCatalog, ModuleSource } from "../modules.ts";
import type { WorkspacePaths } from "../paths.ts";
import { type ModuleConfig, materializeConfig } from "../persistence/index.ts";
import { ExecuteStrategy } from "../planner/index.ts";
import { cleanupRemovableFilesystemEffects } from "./cleanup.ts";
import type { PackageManagerDriver } from "./driver.ts";

export interface ExecuteDeps {
	paths: WorkspacePaths;
	catalog: ModuleCatalog;
	driver: PackageManagerDriver;
}

/**
 * Structured result of executing one non-human step. A lifecycle adapter's
 * `ModuleOperationResult` is preserved verbatim: ACTION_REQUIRED / BLOCKED /
 * FAILED are returned as values, never collapsed into a thrown APPLY_FAILED.
 * Only genuine boundary violations (missing module, unsupported strategy,
 * malformed adapter result) still throw.
 */
export type ExecuteStepOutcome =
	| { kind: "SUCCEEDED" }
	| { kind: "ACTION_REQUIRED"; actionRequired: HumanAction }
	| { kind: "BLOCKED"; reason: string }
	| { kind: "FAILED"; reason: string };

function moduleOf(
	plan: DeploymentPlan,
	step: DeploymentStep,
): ResolvedModule | undefined {
	return plan.resolvedModules.find(
		(module) => module.moduleRef === step.moduleRef,
	);
}

type ProductionConfigMaterializer = (input: {
	moduleRef: string;
	config: Record<string, string>;
	workspaceRoot: string;
}) => Promise<unknown> | unknown;

function moduleSourceForMaterialization(module: ResolvedModule): ModuleSource {
	if (module.source.type === "registry") {
		throw new PlatformError(
			"APPLY_FAILED",
			`registry bootstrap target ${module.packageName} has no local config materializer`,
		);
	}
	return {
		type: module.source.type,
		packageName: module.packageName,
		...(module.source.path === undefined ? {} : { path: module.source.path }),
	};
}

async function materializeModuleOwnedConfig(
	deps: ExecuteDeps,
	module: ResolvedModule,
	config: ModuleConfig,
): Promise<void> {
	const namespace = await deps.catalog.loadAdapter(
		moduleSourceForMaterialization(module),
	);
	if (typeof namespace !== "object" || namespace === null) return;
	const materializer = Reflect.get(namespace, "materializeProductionConfig");
	if (typeof materializer !== "function") return;
	await (materializer as ProductionConfigMaterializer)({
		moduleRef: module.moduleRef,
		config: config.values,
		workspaceRoot: deps.paths.root,
	});
}

function configForStep(
	plan: DeploymentPlan,
	step: DeploymentStep,
	module: ResolvedModule,
): ModuleConfig | undefined {
	const target = plan.moduleTargets.find(
		(entry) => entry.moduleRef === step.moduleRef,
	);
	if (target?.config === undefined) return undefined;
	const secretRefs = module.configSlots
		.filter((slot) => slot.type === "secretRef")
		.map((slot) => slot.key);
	return {
		moduleRef: step.moduleRef,
		values: target.config,
		secretRefs,
	};
}

function lifecyclePrimitive(step: DeploymentStep): LifecyclePrimitive {
	switch (step.executeStrategy) {
		case ExecuteStrategy.lifecycleStart:
			return "start";
		case ExecuteStrategy.lifecycleStop:
			return "stop";
		case ExecuteStrategy.lifecycleRestart:
			return "restart";
		case ExecuteStrategy.lifecycleUninstall:
			return "uninstall";
		case ExecuteStrategy.lifecycleMigrate:
			return "migrate";
		default:
			throw new PlatformError(
				"APPLY_FAILED",
				`unsupported lifecycle strategy ${step.executeStrategy ?? "<none>"}`,
			);
	}
}

function externalResourcePrimitive(step: DeploymentStep): LifecyclePrimitive {
	if (step.executeStrategy === ExecuteStrategy.externalResourceConfigure) {
		return "start";
	}
	throw new PlatformError(
		"APPLY_FAILED",
		`unsupported external-resource strategy ${step.executeStrategy ?? "<none>"}`,
	);
}

function requiredActionRequired(result: ModuleOperationResult): HumanAction {
	const actionRequired = result.actionRequired;
	if (actionRequired === undefined) {
		throw new PlatformError(
			"APPLY_FAILED",
			`module ${result.moduleRef} reported ACTION_REQUIRED without a recoverable action`,
		);
	}
	return actionRequired;
}

function operationOutcome(result: ModuleOperationResult): ExecuteStepOutcome {
	switch (result.status) {
		case "SUCCEEDED":
			return { kind: "SUCCEEDED" };
		case "ACTION_REQUIRED":
			return {
				kind: "ACTION_REQUIRED",
				actionRequired: requiredActionRequired(result),
			};
		case "BLOCKED":
			return {
				kind: "BLOCKED",
				reason: `module ${result.moduleRef} is blocked`,
			};
		case "FAILED":
			return {
				kind: "FAILED",
				reason: result.error?.message ?? `module ${result.moduleRef} failed`,
			};
	}
}

/**
 * Executes a single non-human step by kind + execute strategy, returning a
 * structured outcome instead of throwing for ACTION_REQUIRED / BLOCKED / FAILED
 * lifecycle results. Package/config mutations still throw on genuine driver or
 * boundary errors; those are not lifecycle outcomes and must not be swallowed.
 */
export async function executeStep(
	deps: ExecuteDeps,
	step: DeploymentStep,
	plan: DeploymentPlan,
): Promise<ExecuteStepOutcome> {
	const module = moduleOf(plan, step);
	if (module === undefined) {
		throw new PlatformError(
			"APPLY_FAILED",
			`module ${step.moduleRef} is not in the plan`,
		);
	}

	switch (step.kind) {
		case "package": {
			if (step.executeStrategy === ExecuteStrategy.packageRemove) {
				await deps.driver.remove(module);
			} else if (step.executeStrategy === ExecuteStrategy.packageUpgrade) {
				await deps.driver.upgrade(module);
			} else {
				await deps.driver.install(module);
			}
			return { kind: "SUCCEEDED" };
		}
		case "config": {
			const config = configForStep(plan, step, module);
			if (config === undefined) {
				throw new PlatformError(
					"APPLY_FAILED",
					`module ${step.moduleRef} has no config target to materialize`,
				);
			}
			// The Platform-owned public config is authoritative apply reality. Do not
			// commit it until the module-owned materializer has accepted the target;
			// otherwise a failed materializer can leave a false-satisfied config step
			// that a same-plan resume would incorrectly SKIP.
			await materializeModuleOwnedConfig(deps, module, config);
			await materializeConfig(deps.paths, config);
			return { kind: "SUCCEEDED" };
		}
		case "lifecycle": {
			const primitive = lifecyclePrimitive(step);
			const dispatched = await dispatchLifecycle(
				deps.catalog,
				module,
				primitive,
			);
			const operation = operationOutcome(dispatched.result);
			if (primitive === "uninstall" && operation.kind === "SUCCEEDED") {
				await cleanupRemovableFilesystemEffects({
					workspaceRoot: deps.paths.root,
					effects: module.effects,
				});
			}
			return operation;
		}
		case "external-resource": {
			const primitive = externalResourcePrimitive(step);
			const dispatched = await dispatchLifecycle(
				deps.catalog,
				module,
				primitive,
			);
			return operationOutcome(dispatched.result);
		}
		case "human":
			throw new PlatformError(
				"APPLY_FAILED",
				`human step ${step.stepRef} must be routed to ACTION_REQUIRED, not executed`,
			);
	}
}
