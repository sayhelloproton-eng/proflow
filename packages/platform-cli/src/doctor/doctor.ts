import type {
	DeploymentCheck,
	DeploymentError,
	ModuleOperationResult,
} from "@tomflow/proflow-module-contract";

import type { ResolvedModule } from "../contracts.ts";
import { dispatchLifecycle } from "../lifecycle/index.ts";
import type { ModuleCatalog } from "../modules.ts";

export type DoctorNextAction =
	| { kind: "none" }
	| { kind: "human-action"; action: string; description: string }
	| { kind: "repair-plan"; summary: string };

export interface DoctorReport {
	moduleRef: string;
	moduleVersion: string;
	status: ModuleOperationResult["status"];
	checks: DeploymentCheck[];
	errors: DeploymentError[];
	evidenceRefs: string[];
	nextAction: DoctorNextAction;
	observedEffects: string[];
}

/**
 * Maps a doctor result to the recommended next step. Doctor only recommends:
 * it never performs a repair. A failing or blocked module yields a `repair-plan`
 * recommendation (to be followed by `plan --intent repair` → confirm → apply);
 * an ACTION_REQUIRED result yields the recoverable human action as-is.
 */
export function nextActionOf(result: ModuleOperationResult): DoctorNextAction {
	switch (result.status) {
		case "SUCCEEDED":
			return { kind: "none" };
		case "ACTION_REQUIRED": {
			const action = result.actionRequired;
			if (action !== undefined) {
				return {
					kind: "human-action",
					action: action.action,
					description: action.description,
				};
			}
			return {
				kind: "repair-plan",
				summary: "action required but unspecified",
			};
		}
		case "BLOCKED":
		case "FAILED": {
			const summary =
				result.error !== undefined
					? `${result.error.code}: ${result.error.message}`
					: `module ${result.moduleRef} is ${result.status.toLowerCase()}`;
			return { kind: "repair-plan", summary };
		}
	}
}

function evidenceRefsOf(result: ModuleOperationResult): string[] {
	return (result.checks ?? []).map(
		(check) => `check:${check.id}:${check.status}`,
	);
}

/**
 * Diagnoses a single module by dispatching its public `doctor` primitive. The
 * report carries live checks, typed errors, evidence refs, and a recommended
 * next action — but performs no side effects and never auto-repairs.
 */
export async function doctorModule(
	catalog: ModuleCatalog,
	module: ResolvedModule,
): Promise<DoctorReport> {
	const dispatched = await dispatchLifecycle(catalog, module, "doctor");
	const result = dispatched.result;
	return {
		moduleRef: module.moduleRef,
		moduleVersion: module.moduleVersion,
		status: result.status,
		checks: result.checks ?? [],
		errors: result.error !== undefined ? [result.error] : [],
		evidenceRefs: evidenceRefsOf(result),
		nextAction: nextActionOf(result),
		observedEffects: dispatched.observedEffects,
	};
}

/**
 * Diagnoses every module that declares the `doctor` primitive; modules without
 * it are skipped.
 */
export async function doctorModules(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
): Promise<DoctorReport[]> {
	const reports: DoctorReport[] = [];
	for (const module of modules) {
		if (!module.lifecycle.includes("doctor")) continue;
		reports.push(await doctorModule(catalog, module));
	}
	return reports;
}
