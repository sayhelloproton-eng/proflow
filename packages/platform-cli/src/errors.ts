export const platformErrorCodes = [
	"INVALID_REQUEST",
	"DESCRIPTOR_INVALID",
	"DUPLICATE_IDENTITY",
	"DEPENDENCY_UNRESOLVED",
	"DEPENDENCY_INCOMPATIBLE",
	"DEPENDENCY_CYCLE",
	"CONFIG_MISSING",
	"PLAN_STALE",
	"PLAN_NOT_FOUND",
	"WORKSPACE_LOCKED",
	"LIFECYCLE_UNSUPPORTED",
	"SECRET_LEAK",
	"APPLY_FAILED",
	"UPGRADE_FAILED",
	"VERIFY_FAILED",
	"COMMAND_FAILED",
] as const;

export type PlatformErrorCode = (typeof platformErrorCodes)[number];

export class PlatformError extends Error {
	readonly code: PlatformErrorCode;
	constructor(code: PlatformErrorCode, message: string) {
		super(message);
		this.code = code;
		this.name = "PlatformError";
	}
}
