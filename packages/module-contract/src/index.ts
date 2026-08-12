import { z } from "zod";

const identifier = z
	.string()
	.min(1)
	.regex(/^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$/);
const packageName = z
	.string()
	.min(1)
	.regex(/^@tomflow\/[a-z][a-z0-9-]*$/);
const semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
const versionRange = z.string().min(1);

export const moduleKindSchema = z.enum([
	"library",
	"service",
	"cli",
	"browser-extension",
	"agent-package",
	"external-resource",
]);
export type ModuleKind = z.infer<typeof moduleKindSchema>;

export const moduleProvideSchema = z.strictObject({
	contractRef: identifier,
	version: semver,
});
export type ModuleProvide = z.infer<typeof moduleProvideSchema>;

export const moduleRequireSchema = z.strictObject({
	contractRef: identifier,
	versionRange,
	optional: z.boolean().optional(),
});
export type ModuleRequire = z.infer<typeof moduleRequireSchema>;

const runtimeRequirementSchema = z.strictObject({
	kind: z.literal("runtime"),
	runtime: z.enum(["node", "browser", "system"]),
	versionRange,
});
const executableRequirementSchema = z.strictObject({
	kind: z.literal("executable"),
	command: z.string().min(1),
	versionRange: versionRange.optional(),
});
const fileSystemRequirementSchema = z.strictObject({
	kind: z.literal("filesystem"),
	path: z.string().min(1),
	access: z.enum(["read", "write", "read-write"]),
});
const portRequirementSchema = z.strictObject({
	kind: z.literal("port"),
	port: z.number().int().min(1).max(65_535),
	protocol: z.enum(["tcp", "udp"]),
});
const networkRequirementSchema = z.strictObject({
	kind: z.literal("network"),
	url: z.url(),
});
const moduleContractRequirementSchema = z.strictObject({
	kind: z.literal("module-contract"),
	contractRef: identifier,
	versionRange,
});
const humanRequirementSchema = z.strictObject({
	kind: z.literal("human"),
	action: z.string().min(1),
});

export const moduleRequirementSchema = z.discriminatedUnion("kind", [
	runtimeRequirementSchema,
	executableRequirementSchema,
	fileSystemRequirementSchema,
	portRequirementSchema,
	networkRequirementSchema,
	moduleContractRequirementSchema,
	humanRequirementSchema,
]);
export type ModuleRequirement = z.infer<typeof moduleRequirementSchema>;

export const configValueTypeSchema = z.enum([
	"string",
	"number",
	"boolean",
	"url",
	"path",
	"enum",
	"moduleRef",
	"secretRef",
]);
export type ConfigValueType = z.infer<typeof configValueTypeSchema>;

export const configSlotSchema = z
	.strictObject({
		key: identifier,
		type: configValueTypeSchema,
		required: z.boolean(),
		description: z.string().min(1),
		default: z.unknown().optional(),
		enumValues: z.array(z.string().min(1)).min(1).optional(),
		sensitive: z.boolean().optional(),
	})
	.superRefine((slot, context) => {
		if (slot.type === "secretRef") {
			if (slot.sensitive !== true) {
				context.addIssue({
					code: "custom",
					message: "secretRef config must be sensitive",
					path: ["sensitive"],
				});
			}
			if (slot.default !== undefined) {
				context.addIssue({
					code: "custom",
					message: "secretRef config cannot contain an inline default",
					path: ["default"],
				});
			}
		}
		if (
			slot.type === "moduleRef" &&
			typeof slot.default === "string" &&
			slot.default.includes("://")
		) {
			context.addIssue({
				code: "custom",
				message: "moduleRef config cannot use a physical URL as its default",
				path: ["default"],
			});
		}
		if (slot.type === "enum" && slot.enumValues === undefined) {
			context.addIssue({
				code: "custom",
				message: "enum config requires enumValues",
				path: ["enumValues"],
			});
		}
		if (slot.type !== "enum" && slot.enumValues !== undefined) {
			context.addIssue({
				code: "custom",
				message: "enumValues is only valid for enum config",
				path: ["enumValues"],
			});
		}
	});
export type ConfigSlot = z.infer<typeof configSlotSchema>;

export const lifecyclePrimitiveSchema = z.enum([
	"describe",
	"preflight",
	"status",
	"verify",
	"doctor",
	"start",
	"stop",
	"restart",
	"migrate",
]);
export type LifecyclePrimitive = z.infer<typeof lifecyclePrimitiveSchema>;

export const lifecycleSupportSchema = z.strictObject({
	supported: z
		.array(lifecyclePrimitiveSchema)
		.min(1)
		.superRefine((items, context) => {
			if (new Set(items).size !== items.length) {
				context.addIssue({
					code: "custom",
					message: "lifecycle primitives must be unique",
				});
			}
		}),
});
export type LifecycleSupport = z.infer<typeof lifecycleSupportSchema>;

export const verificationCheckSchema = z.strictObject({
	id: identifier,
	description: z.string().min(1),
	lifecycle: z.enum(["status", "verify", "doctor"]),
});
export const verificationContractSchema = z.strictObject({
	checks: z.array(verificationCheckSchema).min(1),
});
export type VerificationContract = z.infer<typeof verificationContractSchema>;

export const deploymentEffectSchema = z.strictObject({
	kind: z.enum(["filesystem", "process", "network", "external-resource"]),
	description: z.string().min(1),
});
export type DeploymentEffect = z.infer<typeof deploymentEffectSchema>;

export const moduleDescriptorSchema = z
	.strictObject({
		contract: z.literal("module"),
		contractVersion: z.literal("1.0.0"),
		moduleRef: identifier,
		packageName,
		moduleVersion: semver,
		kind: moduleKindSchema,
		templateVersion: semver,
		platformCompatibility: versionRange,
		provides: z.array(moduleProvideSchema),
		requires: z.array(moduleRequireSchema),
		requirements: z.array(moduleRequirementSchema),
		configSlots: z.array(configSlotSchema),
		lifecycle: lifecycleSupportSchema,
		verification: verificationContractSchema,
		effects: z.array(deploymentEffectSchema),
	})
	.superRefine((descriptor, context) => {
		const supported = descriptor.lifecycle.supported;
		if (
			descriptor.kind === "library" &&
			supported.some((item) => ["start", "stop", "restart"].includes(item))
		) {
			context.addIssue({
				code: "custom",
				message: "library modules cannot declare process lifecycle primitives",
				path: ["lifecycle", "supported"],
			});
		}
		for (const check of descriptor.verification.checks) {
			if (!supported.includes(check.lifecycle)) {
				context.addIssue({
					code: "custom",
					message: `verification check requires unsupported ${check.lifecycle} lifecycle`,
					path: ["verification", "checks"],
				});
			}
		}
	});
export type ModuleDescriptor = z.infer<typeof moduleDescriptorSchema>;

export const deploymentCheckSchema = z.strictObject({
	id: identifier,
	status: z.enum(["PASS", "FAIL", "WARN", "SKIP"]),
	message: z.string().min(1),
});
export type DeploymentCheck = z.infer<typeof deploymentCheckSchema>;

export const deploymentErrorCodeSchema = z.enum([
	"INVALID_REQUEST",
	"MODULE_NOT_FOUND",
	"CONTRACT_INVALID",
	"CONFORMANCE_FAILED",
	"COMPATIBILITY_MISMATCH",
	"DEPENDENCY_UNRESOLVED",
	"REQUIREMENT_UNMET",
	"CONFIG_REQUIRED",
	"LIFECYCLE_UNSUPPORTED",
	"EXTERNAL_RESOURCE_UNAVAILABLE",
	"PLAN_INVALID",
	"PLAN_STALE",
	"APPLY_FAILED",
	"VERIFY_FAILED",
	"DOCTOR_FAILED",
	"UPGRADE_FAILED",
	"COMMAND_FAILED",
]);
export const deploymentErrorSchema = z.strictObject({
	code: deploymentErrorCodeSchema,
	message: z.string().min(1),
	retryable: z.boolean(),
});
export type DeploymentError = z.infer<typeof deploymentErrorSchema>;

export const humanActionSchema = z.strictObject({
	action: z.string().min(1),
	description: z.string().min(1),
});
export type HumanAction = z.infer<typeof humanActionSchema>;

export const moduleOperationResultSchema = z
	.strictObject({
		contract: z.literal("deployment.result.v1"),
		ok: z.boolean(),
		status: z.enum(["SUCCEEDED", "BLOCKED", "ACTION_REQUIRED", "FAILED"]),
		moduleRef: identifier,
		moduleVersion: semver,
		data: z.unknown().optional(),
		checks: z.array(deploymentCheckSchema).optional(),
		actionRequired: humanActionSchema.optional(),
		error: deploymentErrorSchema.optional(),
		resourceVersion: z.string().min(1).optional(),
	})
	.superRefine((result, context) => {
		if (result.ok !== (result.status === "SUCCEEDED")) {
			context.addIssue({
				code: "custom",
				message: "ok must match SUCCEEDED status",
				path: ["ok"],
			});
		}
		if (
			result.status === "ACTION_REQUIRED" &&
			result.actionRequired === undefined
		) {
			context.addIssue({
				code: "custom",
				message: "ACTION_REQUIRED must include a recoverable human action",
				path: ["actionRequired"],
			});
		}
		if (result.status === "FAILED" && result.error === undefined) {
			context.addIssue({
				code: "custom",
				message: "FAILED must include a typed error",
				path: ["error"],
			});
		}
	});
export type ModuleOperationResult<T = unknown> = Omit<
	z.infer<typeof moduleOperationResultSchema>,
	"data"
> & { data?: T };

export function parseModuleDescriptor(input: unknown): ModuleDescriptor {
	return moduleDescriptorSchema.parse(input);
}

export function queryRequirements(
	descriptor: ModuleDescriptor,
): ModuleRequirement[] {
	return structuredClone(descriptor.requirements);
}

export interface CompatibilityAssessment {
	compatible: boolean;
	breakingChanges: string[];
}

function major(version: string): number {
	return Number.parseInt(version.split(".")[0] ?? "0", 10);
}

export function assessModuleCompatibility(
	current: ModuleDescriptor,
	target: ModuleDescriptor,
): CompatibilityAssessment {
	const breakingChanges: string[] = [];
	if (current.moduleRef !== target.moduleRef || current.kind !== target.kind) {
		breakingChanges.push("module identity or kind changed");
	}
	if (major(current.contractVersion) !== major(target.contractVersion)) {
		breakingChanges.push("module contract major version changed");
	}
	for (const provided of current.provides) {
		const replacement = target.provides.find(
			(item) => item.contractRef === provided.contractRef,
		);
		if (replacement === undefined) {
			breakingChanges.push(
				`provided contract removed: ${provided.contractRef}`,
			);
		} else if (major(replacement.version) !== major(provided.version)) {
			breakingChanges.push(
				`provided contract major version changed: ${provided.contractRef}`,
			);
		}
	}
	for (const slot of target.configSlots) {
		const previous = current.configSlots.find((item) => item.key === slot.key);
		if (slot.required && previous === undefined && slot.default === undefined) {
			breakingChanges.push(`required config added: ${slot.key}`);
		} else if (previous !== undefined && previous.type !== slot.type) {
			breakingChanges.push(`config type changed: ${slot.key}`);
		}
	}
	for (const primitive of current.lifecycle.supported) {
		if (!target.lifecycle.supported.includes(primitive)) {
			breakingChanges.push(`lifecycle removed: ${primitive}`);
		}
	}
	return { compatible: breakingChanges.length === 0, breakingChanges };
}
