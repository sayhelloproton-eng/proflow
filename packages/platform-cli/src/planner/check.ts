import type {
	DeploymentPlan,
	DeploymentStep,
	ResolvedModule,
} from "../contracts.ts";
import { CheckStrategy } from "./steps.ts";

export interface VerificationCheckResult {
	id: string;
	status: "PASS" | "FAIL";
}

export interface StepReality {
	installedVersion?: string;
	configValues?: Record<string, string>;
	processRunning?: boolean;
	resourceConfigured?: boolean;
	humanActionVerified?: boolean;
	verificationChecks?: readonly VerificationCheckResult[];
	migrated?: boolean;
}

export type StepCheckStatus = "SATISFIED" | "NOT_SATISFIED" | "UNKNOWN";

export interface StepCheckResult {
	status: StepCheckStatus;
	reason: string;
}

function satisfied(reason: string): StepCheckResult {
	return { status: "SATISFIED", reason };
}

function notSatisfied(reason: string): StepCheckResult {
	return { status: "NOT_SATISFIED", reason };
}

function unknown(reason: string): StepCheckResult {
	return { status: "UNKNOWN", reason };
}

function moduleOf(
	plan: DeploymentPlan,
	step: DeploymentStep,
): ResolvedModule | undefined {
	return plan.resolvedModules.find(
		(module) => module.moduleRef === step.moduleRef,
	);
}

export function evaluateStepCheck(
	step: DeploymentStep,
	plan: DeploymentPlan,
	reality: StepReality,
): StepCheckResult {
	switch (step.checkStrategy) {
		case CheckStrategy.packageInstalled:
			return checkPackage(step, plan, reality);
		case CheckStrategy.packageAbsent:
			return reality.installedVersion === undefined
				? satisfied(`${step.moduleRef} package is absent`)
				: notSatisfied(`${step.moduleRef} package is still installed at ${reality.installedVersion}`);
		case CheckStrategy.configMaterialized:
			return checkConfig(step, plan, reality);
		case CheckStrategy.lifecycleRunning:
			return reality.processRunning === true
				? satisfied(`${step.moduleRef} is running`)
				: notSatisfied(`${step.moduleRef} is not observed running`);
		case CheckStrategy.lifecycleStopped:
			return reality.processRunning === false
				? satisfied(`${step.moduleRef} is stopped`)
				: notSatisfied(`${step.moduleRef} is not observed stopped`);
		case CheckStrategy.externalResourceConfigured:
			return reality.resourceConfigured === true
				? satisfied(`external resource ${step.moduleRef} configured`)
				: notSatisfied(
						`external resource ${step.moduleRef} not observed configured`,
					);
		case CheckStrategy.humanVerified:
			return reality.humanActionVerified === true
				? satisfied(`human action for ${step.moduleRef} verified`)
				: notSatisfied(
						`human action for ${step.moduleRef} not observed verified`,
					);
		case CheckStrategy.migrateComplete:
			return reality.migrated === true
				? satisfied(`${step.moduleRef} migrated`)
				: notSatisfied(`${step.moduleRef} not observed migrated`);
		case CheckStrategy.verifyChecksPass:
			return checkVerify(step, plan, reality);
		default:
			return unknown(`unknown check strategy ${step.checkStrategy}`);
	}
}

function checkPackage(
	step: DeploymentStep,
	plan: DeploymentPlan,
	reality: StepReality,
): StepCheckResult {
	const module = moduleOf(plan, step);
	if (module === undefined) {
		return unknown(`module ${step.moduleRef} is not in the plan`);
	}
	if (reality.installedVersion === undefined) {
		return notSatisfied(
			`installed version for ${step.moduleRef} is not observed`,
		);
	}
	if (reality.installedVersion !== module.moduleVersion) {
		return notSatisfied(
			`installed ${reality.installedVersion} != expected ${module.moduleVersion}`,
		);
	}
	return satisfied(`installed ${module.moduleVersion} matches target`);
}

function checkConfig(
	step: DeploymentStep,
	plan: DeploymentPlan,
	reality: StepReality,
): StepCheckResult {
	const module = moduleOf(plan, step);
	if (module === undefined) {
		return unknown(`module ${step.moduleRef} is not in the plan`);
	}
	if (reality.configValues === undefined) {
		return notSatisfied(`config for ${step.moduleRef} is not materialized`);
	}
	for (const slot of module.configSlots) {
		if (!slot.required) continue;
		const value = reality.configValues[slot.key];
		if (value === undefined || value === "") {
			return notSatisfied(`required config ${slot.key} is missing`);
		}
	}
	return satisfied(`required config materialized for ${step.moduleRef}`);
}

function checkVerify(
	step: DeploymentStep,
	plan: DeploymentPlan,
	reality: StepReality,
): StepCheckResult {
	const module = moduleOf(plan, step);
	if (module === undefined) {
		return unknown(`module ${step.moduleRef} is not in the plan`);
	}
	if (reality.verificationChecks === undefined) {
		return notSatisfied(`verification for ${step.moduleRef} is not run`);
	}
	const byId = new Map(
		reality.verificationChecks.map((check) => [check.id, check.status]),
	);
	for (const check of module.verification.checks) {
		if (byId.get(check.id) !== "PASS") {
			return notSatisfied(`verification check ${check.id} is not passing`);
		}
	}
	return satisfied(`verification checks pass for ${step.moduleRef}`);
}
