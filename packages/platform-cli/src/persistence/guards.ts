import type {
	DeploymentIntent,
	DeploymentPlan,
	DeploymentState,
	LockRecord,
	SelectedModuleFact,
	VerificationRecord,
} from "../contracts.ts";
import { PlatformError } from "../errors.ts";

export const DEPLOYMENT_STATE_CONTRACT = "proflow.deployment-state.v1";

const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function assertSafeFileName(name: string, kind: string): void {
	if (!SAFE_FILE_NAME.test(name)) {
		throw new PlatformError("INVALID_REQUEST", `invalid ${kind} name: ${name}`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(isString);
}

function isDeploymentIntent(value: unknown): value is DeploymentIntent {
	return (
		value === "install" ||
		value === "configure" ||
		value === "upgrade" ||
		value === "repair"
	);
}

function isSelectedModuleFact(value: unknown): value is SelectedModuleFact {
	return (
		isRecord(value) &&
		isString(value.moduleRef) &&
		isString(value.moduleVersion)
	);
}

function isLastAppliedPlan(
	value: unknown,
): value is DeploymentState["lastAppliedPlans"][number] {
	return (
		isRecord(value) &&
		isString(value.planRef) &&
		isDeploymentIntent(value.intent) &&
		isString(value.appliedAt)
	);
}

function isVerificationIndexEntry(
	value: unknown,
): value is DeploymentState["verificationIndex"][number] {
	return (
		isRecord(value) && isString(value.moduleRef) && isString(value.latestRef)
	);
}

function isPendingAction(
	value: unknown,
): value is DeploymentState["pendingActions"][number] {
	return (
		isRecord(value) &&
		isString(value.planRef) &&
		isString(value.action) &&
		isString(value.createdAt)
	);
}

export function isDeploymentState(value: unknown): value is DeploymentState {
	if (!isRecord(value)) return false;
	if (value.contract !== DEPLOYMENT_STATE_CONTRACT) return false;
	if (!Array.isArray(value.selectedModules)) return false;
	if (!value.selectedModules.every(isSelectedModuleFact)) return false;
	if (!Array.isArray(value.lastAppliedPlans)) return false;
	if (!value.lastAppliedPlans.every(isLastAppliedPlan)) return false;
	if (!Array.isArray(value.verificationIndex)) return false;
	if (!value.verificationIndex.every(isVerificationIndexEntry)) return false;
	if (!Array.isArray(value.pendingActions)) return false;
	if (!value.pendingActions.every(isPendingAction)) return false;
	return isString(value.updatedAt);
}

export function isVerificationRecord(
	value: unknown,
): value is VerificationRecord {
	if (!isRecord(value)) return false;
	if (!isString(value.verificationRef)) return false;
	if (!isString(value.moduleRef)) return false;
	if (!isString(value.moduleVersion)) return false;
	if (value.resourceIdentity !== undefined && !isString(value.resourceIdentity))
		return false;
	if (value.resourceVersion !== undefined && !isString(value.resourceVersion))
		return false;
	if (value.result !== "PASS" && value.result !== "FAIL") return false;
	if (!isString(value.summary)) return false;
	if (!isStringArray(value.evidenceRefs)) return false;
	return isString(value.verifiedAt);
}

export function isDeploymentPlan(value: unknown): value is DeploymentPlan {
	if (!isRecord(value)) return false;
	if (!isString(value.planRef)) return false;
	if (!isDeploymentIntent(value.intent)) return false;
	if (!Array.isArray(value.moduleTargets)) return false;
	if (!Array.isArray(value.resolvedModules)) return false;
	if (!Array.isArray(value.steps)) return false;
	if (!Array.isArray(value.effects)) return false;
	if (!Array.isArray(value.humanActions)) return false;
	if (!Array.isArray(value.verification)) return false;
	if (!isString(value.fingerprint)) return false;
	return isString(value.createdAt);
}

export function isLockRecord(value: unknown): value is LockRecord {
	return (
		isRecord(value) &&
		typeof value.pid === "number" &&
		isString(value.createdAt) &&
		isString(value.planRef) &&
		isString(value.workspaceFingerprint)
	);
}
