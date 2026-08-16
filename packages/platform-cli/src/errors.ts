export const platformErrorCodes = [
	"INVALID_REQUEST",
	"DESCRIPTOR_INVALID",
	"DUPLICATE_IDENTITY",
	"DEPENDENCY_UNRESOLVED",
	"DEPENDENCY_INCOMPATIBLE",
	"DEPENDENCY_CYCLE",
	"CONFIG_MISSING",
	"SECRET_REF_INVALID",
	"PLAN_STALE",
	"PLAN_NOT_FOUND",
	"PLAN_INVALID",
	"WORKSPACE_LOCKED",
	"LIFECYCLE_UNSUPPORTED",
	"SECRET_LEAK",
	"APPLY_FAILED",
	"UPGRADE_FAILED",
	"CORE_PACKAGE_REQUIRED",
	"UNINSTALL_FAILED",
	"VERIFY_FAILED",
	"REGISTRY_UNAVAILABLE",
	"REGISTRY_AUTH_REQUIRED",
	"REGISTRY_RESPONSE_INVALID",
	"PACKAGE_NOT_FOUND",
	"PACKAGE_NOT_PROFLOW",
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
