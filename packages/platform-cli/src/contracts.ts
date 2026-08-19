import type {
	ConfigSlot,
	DeploymentEffect,
	HumanAction,
	ModuleDescriptor,
	ModuleRequirement,
} from "@tomflow/proflow-module-contract";

export type DeploymentIntent =
	| "install"
	| "configure"
	| "upgrade"
	| "uninstall"
	| "repair";

export interface ModuleTarget {
	moduleRef: string;
	targetVersion?: string;
	config?: Record<string, string>;
}

export interface ResolvedModule {
	moduleRef: string;
	packageName: string;
	moduleVersion: string;
	kind: ModuleDescriptor["kind"] | "registry-package";
	identity?: ModuleDescriptor["identity"];
	documentation: ModuleDescriptor["documentation"];
	provides: ModuleDescriptor["provides"];
	requires: ModuleDescriptor["requires"];
	requirements: ModuleRequirement[];
	configSlots: ConfigSlot[];
	lifecycle: string[];
	verification: ModuleDescriptor["verification"];
	effects: DeploymentEffect[];
	source: { type: "workspace" | "installed" | "registry"; path?: string };
}

export interface DeploymentStep {
	stepRef: string;
	moduleRef: string;
	kind: "config" | "package" | "lifecycle" | "external-resource" | "human";
	preconditions: string[];
	expectedEffect: string;
	checkStrategy: string;
	executeStrategy?: string;
	postcondition: string;
}

export interface VerificationStep {
	moduleRef: string;
	checks: string[];
}

export interface DeploymentPlan {
	planRef: string;
	intent: DeploymentIntent;
	moduleTargets: ModuleTarget[];
	resolvedModules: ResolvedModule[];
	targetDescriptors?: ModuleDescriptor[];
	steps: DeploymentStep[];
	effects: DeploymentEffect[];
	humanActions: HumanAction[];
	verification: VerificationStep[];
	fingerprint: string;
	createdAt: string;
}

export interface VerificationRecord {
	verificationRef: string;
	moduleRef: string;
	moduleVersion: string;
	resourceIdentity?: string;
	resourceVersion?: string;
	result: "PASS" | "FAIL";
	summary: string;
	evidenceRefs: string[];
	verifiedAt: string;
}

export type PlatformState =
	| "READY"
	| "DEGRADED"
	| "ACTION_REQUIRED"
	| "NOT_READY";

export interface SelectedModuleFact {
	moduleRef: string;
	moduleVersion: string;
}

export interface DeploymentState {
	contract: "proflow.deployment-state.v1";
	selectedModules: SelectedModuleFact[];
	lastAppliedPlans: {
		planRef: string;
		intent: DeploymentIntent;
		appliedAt: string;
	}[];
	verificationIndex: { moduleRef: string; latestRef: string }[];
	pendingActions: PendingActionRecord[];
	updatedAt: string;
}

export interface PendingActionRecord {
	planRef: string;
	stepRef: string;
	moduleRef: string;
	action: string;
	description?: string;
	createdAt: string;
}

export interface LockRecord {
	pid: number;
	createdAt: string;
	planRef: string;
	workspaceFingerprint: string;
}

export type ApplyStepStatus =
	| "SKIP"
	| "EXECUTED"
	| "ACTION_REQUIRED"
	| "FAILED";

export interface ApplyStepResult {
	stepRef: string;
	moduleRef: string;
	status: ApplyStepStatus;
	message: string;
}

export type ApplyOutcome =
	| "COMPLETE"
	| "ACTION_REQUIRED"
	| "FAILED"
	| "BLOCKED";

export interface ApplyResult {
	planRef: string;
	outcome: ApplyOutcome;
	stepResults: ApplyStepResult[];
	completedAt: string;
}
