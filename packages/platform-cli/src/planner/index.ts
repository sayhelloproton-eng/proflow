export type {
	StepCheckResult,
	StepCheckStatus,
	StepReality,
	VerificationCheckResult,
} from "./check.ts";
export { evaluateStepCheck } from "./check.ts";
export type { FingerprintSource } from "./fingerprint.ts";
export { computeFingerprint } from "./fingerprint.ts";
export type { PlanInput } from "./plan.ts";
export { planDeployment } from "./plan.ts";
export type { RepairFact, RepairFactCode, RepairPlanInput } from "./repair.ts";
export { planRepair, repairFactCodes } from "./repair.ts";
export type { StalenessResult } from "./stale.ts";
export { checkPlanStale } from "./stale.ts";
export { CheckStrategy, ExecuteStrategy } from "./steps.ts";
export type { UpgradeAssessment } from "./upgrade.ts";
export { assessUpgrade, planUpgrade } from "./upgrade.ts";
