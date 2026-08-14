export { WorkspaceModuleCatalog } from "./catalog.ts";
export type { DiscoverOptions } from "./discover.ts";
export { discoverModules, resolveModules } from "./discover.ts";
export {
	expandPackageDirs,
	findWorkspaceRoot,
	hasDeploymentArtifacts,
	readWorkspaceGlobs,
} from "./workspace.ts";
