export const platformErrorCodes = [
	"INVALID_REQUEST",
	"DESCRIPTOR_INVALID",
	"DUPLICATE_IDENTITY",
	"DEPENDENCY_UNRESOLVED",
	"DEPENDENCY_INCOMPATIBLE",
	"DEPENDENCY_CYCLE",
	"CONFIG_INVALID",
	"WORKSPACE_NOT_FOUND",
	"WORKSPACE_INSTANCE_INVALID",
	"PACKAGE_MANAGER_UNSUPPORTED",
	"PACKAGE_MANAGER_CONFLICT",
	"PACKAGE_MANAGER_UNAVAILABLE",
	"LIFECYCLE_UNSUPPORTED",
	"UNINSTALL_FAILED",
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
