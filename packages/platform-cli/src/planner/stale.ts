import type { DeploymentPlan } from "../contracts.ts";
import { buildFingerprintSource } from "./fingerprint.ts";
import { type PlanInput, planDeployment } from "./plan.ts";

export interface StalenessResult {
	stale: boolean;
	reasons: string[];
}

const COMPARED_FIELDS = [
	"intent",
	"targets",
	"modules",
	"steps",
	"effects",
	"humanActions",
	"verification",
] as const;

export function checkPlanStale(
	plan: DeploymentPlan,
	current: PlanInput,
): StalenessResult {
	const fresh = planDeployment(current);
	const before = buildFingerprintSource(plan);
	const after = buildFingerprintSource(fresh);
	const reasons: string[] = [];
	for (const field of COMPARED_FIELDS) {
		if (before[field] !== after[field]) {
			reasons.push(`${field} changed`);
		}
	}
	return { stale: reasons.length > 0, reasons };
}
