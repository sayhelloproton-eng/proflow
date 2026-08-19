export type {
	CliOutcome,
	CliRuntimeOptions,
	CliStatus,
} from "./cli.ts";
export { renderHumanResult, runCli } from "./cli.ts";
export { AutoModuleCatalog, discoverModules } from "./discovery/discover.ts";
export type {
	AggregatedDocument,
	AggregatedModuleDocs,
} from "./docs/aggregate.ts";
export { aggregateModuleDocs } from "./docs/aggregate.ts";
export type { PlatformErrorCode } from "./errors.ts";
export { PlatformError } from "./errors.ts";
export type { ModuleCatalog, ModuleSource } from "./modules.ts";
