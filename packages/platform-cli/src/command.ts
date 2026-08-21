// Stable programmatic command surface. Terminal entrypoints must consume this
// typed outcome instead of parsing serialized stdout.
export {
	type CliOutcome,
	type CliRuntimeOptions,
	type CliStatus,
	runCli,
} from "./cli.ts";
