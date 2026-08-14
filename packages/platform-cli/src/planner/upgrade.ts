import {
	assessModuleCompatibility,
	type ModuleDescriptor,
} from "@tomflow/proflow-module-contract";

import type { DeploymentPlan, DeploymentStep } from "../contracts.ts";
import { PlatformError } from "../errors.ts";
import { buildDependencyGraph } from "../graph/graph.ts";
import { assemblePlan, toResolvedModule } from "./assemble.ts";
import type { PlanInput } from "./plan.ts";
import {
	configStep,
	createSequencer,
	humanActionsFromModules,
	humanStep,
	lifecycleStep,
	packageStep,
	upstreamDependencies,
} from "./steps.ts";

export interface UpgradeAssessment {
	compatible: boolean;
	breakingChanges: string[];
	templateVersionChanged: boolean;
	migrationDeclared: boolean;
	migrationRequired: boolean;
}

export function assessUpgrade(
	current: ModuleDescriptor,
	target: ModuleDescriptor,
): UpgradeAssessment {
	const assessment = assessModuleCompatibility(current, target);
	const migrationDeclared = target.lifecycle.supported.includes("migrate");
	return {
		compatible: assessment.compatible,
		breakingChanges: assessment.breakingChanges,
		templateVersionChanged: current.templateVersion !== target.templateVersion,
		migrationDeclared,
		migrationRequired:
			migrationDeclared && assessment.breakingChanges.length > 0,
	};
}

export function planUpgrade(input: PlanInput): DeploymentPlan {
	const currentDescriptors = input.currentDescriptors;
	const targetDescriptors = input.targetDescriptors;
	if (currentDescriptors === undefined || targetDescriptors === undefined) {
		throw new PlatformError(
			"INVALID_REQUEST",
			"upgrade requires currentDescriptors and targetDescriptors",
		);
	}

	const modules = targetDescriptors.map(toResolvedModule);
	const graph = buildDependencyGraph(modules);
	const byRef = new Map(modules.map((module) => [module.moduleRef, module]));
	const currentByRef = new Map(
		currentDescriptors.map((descriptor) => [descriptor.moduleRef, descriptor]),
	);
	const targetByRef = new Map(
		targetDescriptors.map((descriptor) => [descriptor.moduleRef, descriptor]),
	);

	const seq = createSequencer();
	const deps = upstreamDependencies(graph);
	const steps: DeploymentStep[] = [];

	for (const ref of graph.order) {
		const module = byRef.get(ref);
		if (module === undefined) continue;
		const current = currentByRef.get(ref);
		const target = targetByRef.get(ref);
		const assessment =
			current !== undefined && target !== undefined
				? assessUpgrade(current, target)
				: undefined;
		const dependencies = deps.get(ref) ?? [];

		steps.push(packageStep(seq, module, "upgrade", dependencies));
		if (module.configSlots.length > 0) {
			steps.push(configStep(seq, module));
		}
		if (assessment?.migrationRequired === true) {
			steps.push(lifecycleStep(seq, module, "migrate"));
		}
		if (module.kind === "service") {
			if (module.lifecycle.includes("restart")) {
				steps.push(lifecycleStep(seq, module, "restart"));
			} else if (module.lifecycle.includes("start")) {
				steps.push(lifecycleStep(seq, module, "start"));
			}
		}
		for (const requirement of module.requirements) {
			if (requirement.kind === "human") {
				steps.push(humanStep(seq, module, requirement.action));
			}
		}
	}

	return assemblePlan({
		intent: "upgrade",
		modules,
		targets: input.targets ?? [],
		config: input.config,
		steps,
		humanActions: humanActionsFromModules(modules),
		now: input.now ?? new Date(),
	});
}
