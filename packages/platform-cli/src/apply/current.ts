import {
	type ModuleDescriptor,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";

import type { DeploymentPlan, ResolvedModule } from "../contracts.ts";
import { discoverModules } from "../discovery/index.ts";
import { doctorModules } from "../doctor/index.ts";
import type { ModuleCatalog, ModuleSource } from "../modules.ts";
import type { PlanInput } from "../planner/plan.ts";
import { diagnoseRepair } from "../planner/repair.ts";

function moduleSourceOf(module: ResolvedModule): ModuleSource {
	if (module.source.type === "registry") {
		throw new Error(
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

// Rebuilds a plan's stable current assumptions from the CURRENT module catalog
// and current reality. The old plan's resolvedModules are never reused: modules
// are re-discovered and re-parsed so descriptor drift reaches the staleness
// gate. Upgrade additionally re-discovers current descriptors and reuses the
// plan's frozen target descriptors; repair re-runs doctor for fresh facts.
export async function rebuildCurrentAssumptions(
	catalog: ModuleCatalog,
	plan: DeploymentPlan,
): Promise<PlanInput> {
	if (
		(plan.intent === "install" || plan.intent === "upgrade") &&
		plan.resolvedModules.every((module) => module.source.type === "registry")
	) {
		return {
			intent: plan.intent,
			modules: plan.resolvedModules,
			targets: plan.moduleTargets,
		};
	}
	const discovered = await discoverModules({ catalog });
	const byRef = new Map(discovered.map((module) => [module.moduleRef, module]));
	const modules: ResolvedModule[] = [];
	for (const target of plan.moduleTargets) {
		const module = byRef.get(target.moduleRef);
		if (module !== undefined) modules.push(module);
	}

	if (plan.intent === "upgrade") {
		const currentDescriptors = await loadDescriptors(catalog, modules);
		if (plan.targetDescriptors === undefined)
			return { intent: plan.intent, modules, targets: plan.moduleTargets };
		return {
			intent: plan.intent,
			modules,
			targets: plan.moduleTargets,
			currentDescriptors,
			targetDescriptors: plan.targetDescriptors,
		};
	}

	if (plan.intent === "repair") {
		const diagnosis = diagnoseRepair(await doctorModules(catalog, modules));
		return {
			intent: plan.intent,
			modules,
			targets: plan.moduleTargets,
			facts: diagnosis.facts,
		};
	}

	if (plan.intent === "uninstall") {
		// A persisted uninstall plan does not store uninstallScope. Recover the only
		// legal scope from its module set for the staleness re-plan: any core module
		// can only have entered the plan through whole-instance uninstall.
		const uninstallScope = plan.resolvedModules.some(
			(module) => module.installClass === "core",
		)
			? "platform-instance"
			: "module";
		return {
			intent: plan.intent,
			modules,
			targets: plan.moduleTargets,
			uninstallScope,
		};
	}

	return {
		intent: plan.intent,
		modules,
		targets: plan.moduleTargets,
	};
}
