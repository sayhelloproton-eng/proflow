import type { HumanAction } from "@tomflow/proflow-module-contract";

import type {
	DeploymentPlan,
	DeploymentStep,
	ModuleTarget,
	ResolvedModule,
} from "../contracts.ts";
import type { DoctorReport } from "../doctor/doctor.ts";
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
	code: RepairFactCode;
	message: string;
}

export interface RepairPlanInput {
	modules?: readonly ResolvedModule[];
	targets?: readonly ModuleTarget[];
	config?: Record<string, Record<string, string>>;
	facts?: readonly RepairFact[];
	now?: Date;
}

// Frozen error codes that carry an automatic repair mapping. Everything else
// is left BLOCKED for human review rather than inventing a mutation.
const ERROR_CODE_TO_FACT: Readonly<Record<string, RepairFactCode>> = {
	CONFIG_REQUIRED: "CONFIG_MISSING",
	DEPENDENCY_UNRESOLVED: "DEPENDENCY_UNRESOLVED",
	EXTERNAL_RESOURCE_UNAVAILABLE: "EXTERNAL_RESOURCE_UNAVAILABLE",
	VERIFY_FAILED: "VERIFY_FAILED",
};

export interface RepairBlockedReason {
	moduleRef: string;
	code: string;
	message: string;
}

export interface RepairDiagnosis {
	facts: RepairFact[];
	blocked: RepairBlockedReason[];
}

export function repairFactsFromDoctor(report: DoctorReport): RepairDiagnosis {
	const facts: RepairFact[] = [];
	const blocked: RepairBlockedReason[] = [];

	if (report.nextAction.kind === "human-action") {
		facts.push({
			moduleRef: report.moduleRef,
			code: "ACTION_REQUIRED",
			message: report.nextAction.action,
		});
		return { facts, blocked };
	}

	if (report.status === "SUCCEEDED") {
		return { facts, blocked };
	}

	if (report.errors.length === 0) {
		blocked.push({
			moduleRef: report.moduleRef,
			code: report.status,
			message: `module ${report.moduleRef} is ${report.status.toLowerCase()} with no typed error`,
		});
		return { facts, blocked };
	}

	for (const error of report.errors) {
		const factCode = ERROR_CODE_TO_FACT[error.code];
		if (factCode === undefined) {
			blocked.push({
				moduleRef: report.moduleRef,
				code: error.code,
				message: error.message,
			});
			continue;
		}
		facts.push({
			moduleRef: report.moduleRef,
			code: factCode,
			message: error.message,
		});
	}
	return { facts, blocked };
}

export function diagnoseRepair(
	reports: readonly DoctorReport[],
): RepairDiagnosis {
	const facts: RepairFact[] = [];
	const blocked: RepairBlockedReason[] = [];
	for (const report of reports) {
		const diagnosis = repairFactsFromDoctor(report);
		facts.push(...diagnosis.facts);
		blocked.push(...diagnosis.blocked);
	}
	return { facts, blocked };
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
					const step = externalResourceStep(seq, module);
					if (step !== undefined) steps.push(step);
				}
				break;
			case "ACTION_REQUIRED":
				steps.push(humanStep(seq, module, fact.message));
				humanActions.push({
					action: fact.message,
					description: `action required for ${module.moduleRef}`,
				});
				break;
			case "VERIFY_FAILED":
				// Verification re-runs after repair; no mutation is invented here.
				break;
			case "DEPENDENCY_UNRESOLVED":
				// Resolution requires a plan/human decision; no mutation is invented.
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
