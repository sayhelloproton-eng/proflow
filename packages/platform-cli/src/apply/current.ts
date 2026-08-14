import type { DeploymentPlan, ResolvedModule } from "../contracts.ts";
import { discoverModules } from "../discovery/index.ts";
import type { ModuleCatalog } from "../modules.ts";
import type { PlanInput } from "../planner/plan.ts";

// Rebuilds a plan's stable current assumptions from the CURRENT module catalog.
// The old plan's resolvedModules are never reused: modules are re-discovered and
// re-parsed from the catalog so descriptor drift (version, config slots, …)
// reaches the staleness gate. source absolute paths are not a business
// staleness condition — the fingerprint already excludes them.
export async function rebuildCurrentAssumptions(
	catalog: ModuleCatalog,
	plan: DeploymentPlan,
): Promise<PlanInput> {
	const discovered = await discoverModules({ catalog });
	const byRef = new Map(discovered.map((module) => [module.moduleRef, module]));
	const modules: ResolvedModule[] = [];
	for (const target of plan.moduleTargets) {
		const module = byRef.get(target.moduleRef);
		if (module !== undefined) modules.push(module);
	}
	return {
		intent: plan.intent,
		modules,
		targets: plan.moduleTargets,
	};
}
