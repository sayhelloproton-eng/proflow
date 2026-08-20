export type { ModuleDispatchResult } from "./dispatch.ts";
export { dispatchModuleCommand } from "./dispatch.ts";
export type { ModuleBatchResult } from "./thin.ts";
export {
	installModulesThin,
	observeDocs,
	observeStatuses,
	setupModulesThin,
	startModulesThin,
	stopModulesThin,
	uninstallModulesThin,
} from "./thin.ts";
