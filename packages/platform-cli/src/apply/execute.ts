import type { LifecyclePrimitive } from "@tomflow/proflow-module-contract";

import type {
	DeploymentPlan,
	DeploymentStep,
	ResolvedModule,
} from "../contracts.ts";
import { PlatformError } from "../errors.ts";
import { dispatchLifecycle } from "../lifecycle/index.ts";
import type { ModuleCatalog } from "../modules.ts";
import type { WorkspacePaths } from "../paths.ts";
import { type ModuleConfig, materializeConfig } from "../persistence/index.ts";
import { ExecuteStrategy } from "../planner/index.ts";
import type { PackageManagerDriver } from "./driver.ts";

export interface ExecuteDeps {
	paths: WorkspacePaths;
	catalog: ModuleCatalog;
	driver: PackageManagerDriver;
}

function moduleOf(
	plan: DeploymentPlan,
	step: DeploymentStep,
): ResolvedModule | undefined {
	return plan.resolvedModules.find(
		(module) => module.moduleRef === step.moduleRef,
	);
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
		case ExecuteStrategy.lifecycleMigrate:
			return "migrate";
		default:
			throw new PlatformError(
				"APPLY_FAILED",
				`unsupported lifecycle strategy ${step.executeStrategy ?? "<none>"}`,
			);
	}
}

function assertSucceeded(
	moduleRef: string,
	primitive: LifecyclePrimitive,
	ok: boolean,
	status: string,
): void {
	if (!ok) {
		throw new PlatformError(
			"APPLY_FAILED",
			`module ${moduleRef} "${primitive}" did not succeed (${status})`,
		);
	}
}

/**
 * Executes a single non-human step by kind + execute strategy. A step that
 * cannot complete on its own (a failed/blocked/action-required adapter result)
 * throws, and the caller stops the apply; effects are never blindly repeated.
 */
export async function executeStep(
	deps: ExecuteDeps,
	step: DeploymentStep,
	plan: DeploymentPlan,
): Promise<void> {
	const module = moduleOf(plan, step);
	if (module === undefined) {
		throw new PlatformError(
			"APPLY_FAILED",
			`module ${step.moduleRef} is not in the plan`,
		);
	}

	switch (step.kind) {
		case "package": {
			if (step.executeStrategy === ExecuteStrategy.packageUpgrade) {
				await deps.driver.upgrade(module);
			} else {
				await deps.driver.install(module);
			}
			return;
		}
		case "config": {
			const config = configForStep(plan, step, module);
			if (config === undefined) {
				throw new PlatformError(
					"APPLY_FAILED",
					`module ${step.moduleRef} has no config target to materialize`,
				);
			}
			await materializeConfig(deps.paths, config);
			return;
		}
		case "lifecycle": {
			const primitive = lifecyclePrimitive(step);
			const dispatched = await dispatchLifecycle(
				deps.catalog,
				module,
				primitive,
			);
			assertSucceeded(
				module.moduleRef,
				primitive,
				dispatched.result.ok,
				dispatched.result.status,
			);
			return;
		}
		case "external-resource": {
			// Provisioning/configuring an external resource is its activation
			// primitive. Resources that do not declare `start` are rejected by
			// dispatchLifecycle (LIFECYCLE_UNSUPPORTED) rather than forged.
			const dispatched = await dispatchLifecycle(deps.catalog, module, "start");
			assertSucceeded(
				module.moduleRef,
				"start",
				dispatched.result.ok,
				dispatched.result.status,
			);
			return;
		}
		case "human":
			throw new PlatformError(
				"APPLY_FAILED",
				`human step ${step.stepRef} must be routed to ACTION_REQUIRED, not executed`,
			);
	}
}
