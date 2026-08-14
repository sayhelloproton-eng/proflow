export type { WorkspaceLockHandle } from "./lock.ts";
export {
	acquireWorkspaceLock,
	readWorkspaceLock,
	workspaceLockPath,
} from "./lock.ts";
export {
	redactDeep,
	redactPlanSecrets,
	redactSecretValues,
	SECRET_REDACTED,
} from "./redact.ts";
