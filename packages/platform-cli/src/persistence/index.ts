export type { MaterializedConfig, ModuleConfig } from "./config.ts";
export { loadConfig, materializeConfig } from "./config.ts";
export { writeInstallDoc } from "./generated.ts";
export { listPlans, loadPlan, savePlan } from "./plans.ts";
export {
	emptyDeploymentState,
	loadDeploymentState,
	saveDeploymentState,
} from "./state.ts";
export {
	appendVerification,
	loadLatestVerification,
	loadVerificationHistory,
} from "./verification.ts";
export type { WorkspaceMetadata } from "./workspace-metadata.ts";
export { ensureWorkspaceMetadata } from "./workspace-metadata.ts";
