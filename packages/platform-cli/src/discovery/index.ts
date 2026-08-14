export { WorkspaceModuleCatalog } from "./catalog.ts";
export type { DiscoverOptions } from "./discover.ts";
export {
	AutoModuleCatalog,
	discoverModules,
	resolveModules,
} from "./discover.ts";
export { InstalledModuleCatalog } from "./installed.ts";
export {
	expandPackageDirs,
	findWorkspaceRoot,
	hasDeploymentArtifacts,
	readWorkspaceGlobs,
} from "./workspace.ts";
