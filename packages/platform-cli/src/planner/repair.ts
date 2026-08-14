import type { HumanAction } from "@tomflow/proflow-module-contract";

import type {
	DeploymentPlan,
	DeploymentStep,
	ModuleTarget,
	ResolvedModule,
} from "../contracts.ts";
import { PlatformError } from "../errors.ts";
import { assemblePlan } from "./assemble.ts";
import {
	configStep,
	createSequencer,
	externalResourceStep,
	humanStep,
	lifecycleStep,
} from "./steps.ts";

export const repairFactCodes = [
	"CONFIG_MISSING",
	"LIFECYCLE_NOT_RUNNING",
	"VERIFY_FAILED",
	"EXTERNAL_RESOURCE_UNAVAILABLE",
	"ACTION_REQUIRED",
	"DEPENDENCY_UNRESOLVED",
] as const;

export type RepairFactCode = (typeof repairFactCodes)[number];

export interface RepairFact {
	moduleRef: string;
	code: string;
	message: string;
}

export interface RepairPlanInput {
	modules?: readonly ResolvedModule[];
	targets?: readonly ModuleTarget[];
	config?: Record<string, Record<string, string>>;
	facts?: readonly RepairFact[];
	now?: Date;
}

export function planRepair(input: RepairPlanInput): DeploymentPlan {
	const modules = input.modules;
	if (modules === undefined) {
		throw new PlatformError("INVALID_REQUEST", "repair requires modules");
	}
	const facts = input.facts ?? [];

	const byRef = new Map(modules.map((module) => [module.moduleRef, module]));

	const seq = createSequencer();
	const steps: DeploymentStep[] = [];
	const humanActions: HumanAction[] = [];
	const seen = new Set<string>();

	for (const fact of facts) {
		const module = byRef.get(fact.moduleRef);
		if (module === undefined) continue;
		const dedupeKey = `${fact.moduleRef}|${fact.code}`;
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);

		switch (fact.code) {
			case "CONFIG_MISSING":
				if (module.configSlots.length > 0) {
					steps.push(configStep(seq, module));
				}
				break;
			case "LIFECYCLE_NOT_RUNNING":
				if (module.lifecycle.includes("start")) {
					steps.push(lifecycleStep(seq, module, "start"));
				}
				break;
			case "EXTERNAL_RESOURCE_UNAVAILABLE":
				if (module.kind === "external-resource") {
					steps.push(externalResourceStep(seq, module));
				}
				break;
			case "ACTION_REQUIRED":
				steps.push(humanStep(seq, module, fact.message));
				humanActions.push({
					action: fact.message,
					description: `action required for ${module.moduleRef}`,
				});
				break;
			default:
				// VERIFY_FAILED / DEPENDENCY_UNRESOLVED / unknown → no invented step
				break;
		}
	}

	return assemblePlan({
		intent: "repair",
		modules,
		targets: input.targets ?? [],
		config: input.config,
		steps,
		humanActions,
		now: input.now ?? new Date(),
	});
}
