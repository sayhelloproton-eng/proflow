export type { PackageManagerDriver } from "./apply/driver.ts";
export { applyPlan, workspaceResidentDriver } from "./apply/index.ts";
export type { CliOutcome, CliStatus } from "./cli.ts";
export { runCli } from "./cli.ts";
export type {
	DeploymentIntent,
	DeploymentPlan,
	DeploymentState,
	DeploymentStep,
	ModuleTarget,
	PlatformState,
	ResolvedModule,
	VerificationRecord,
	VerificationStep,
} from "./contracts.ts";
export { AutoModuleCatalog, discoverModules } from "./discovery/discover.ts";
export { doctorModule, doctorModules } from "./doctor/index.ts";
export type { PlatformErrorCode } from "./errors.ts";
export { PlatformError } from "./errors.ts";
export { generateInstallDoc, renderInstallDoc } from "./install/index.ts";
export {
	dispatchLifecycle,
	startModules,
	statusModules,
	stopModules,
} from "./lifecycle/index.ts";
export { buildManifest, MANIFEST_CONTRACT } from "./manifest/index.ts";
export type { ModuleCatalog, ModuleSource } from "./modules.ts";
export { versionSatisfies } from "./modules.ts";
export type { WorkspacePaths } from "./paths.ts";
export { atomicWrite, workspacePaths } from "./paths.ts";
export {
	appendVerification,
	emptyDeploymentState,
	listPlans,
	loadConfig,
	loadDeploymentState,
	loadLatestVerification,
	loadPlan,
	loadVerificationHistory,
	materializeConfig,
	saveDeploymentState,
	savePlan,
	writeInstallDoc,
} from "./persistence/index.ts";
export {
	assessUpgrade,
	CheckStrategy,
	checkPlanStale,
	computeFingerprint,
	ExecuteStrategy,
	evaluateStepCheck,
	planDeployment,
	planRepair,
	planUpgrade,
	repairFactCodes,
} from "./planner/index.ts";
export type { PlanInput } from "./planner/plan.ts";
export type { PreflightResult } from "./preflight/findings.ts";
export { runPreflight } from "./preflight/preflight.ts";
export { assessPlatformReady } from "./ready/index.ts";
export {
	acquireWorkspaceLock,
	readWorkspaceLock,
	redactDeep,
	redactPlanSecrets,
	redactSecretValues,
	SECRET_REDACTED,
	workspaceLockPath,
} from "./security/index.ts";
export { verifyModule, verifyModules } from "./verification/index.ts";
