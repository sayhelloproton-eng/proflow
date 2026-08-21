import { z } from "zod";

const identifier = z
	.string()
	.min(1)
	.regex(/^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$/);
const packageName = z
	.string()
	.min(1)
	.regex(/^@tomflow\/proflow-[a-z][a-z0-9-]*$/);
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

export const proflowPackageMetadataSchema = z.strictObject({
	module: z.literal(true),
	descriptor: z.string().min(1),
	manifest: z.literal("./proflow.module.json"),
});
export type ProFlowPackageMetadata = z.infer<
	typeof proflowPackageMetadataSchema
>;

export const moduleIdentitySchema = z.strictObject({
	domain: identifier,
	summary: z.string().min(1),
});
export type ModuleIdentity = z.infer<typeof moduleIdentitySchema>;

export const moduleDocumentationSchema = z.strictObject({
	docs: z.literal("DOCS.md"),
	setup: z.literal("SETUP.md"),
});
export type ModuleDocumentation = z.infer<typeof moduleDocumentationSchema>;

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

export const moduleSetupStatusSchema = z.enum([
	"READY",
	"ACTION_REQUIRED",
	"FAILED",
]);
export type ModuleSetupStatus = z.infer<typeof moduleSetupStatusSchema>;

export const moduleRuntimeStatusSchema = z.enum([
	"RUNNING",
	"STOPPED",
	"FAILED",
	"NOT_APPLICABLE",
]);
export type ModuleRuntimeStatus = z.infer<typeof moduleRuntimeStatusSchema>;

export const moduleStatusObservationSchema = z.strictObject({
	setupStatus: moduleSetupStatusSchema,
	runtimeStatus: moduleRuntimeStatusSchema,
});
export type ModuleStatusObservation = z.infer<
	typeof moduleStatusObservationSchema
>;

export const moduleDocsDataSchema = z.strictObject({
	docs: z.string().min(1),
});
export type ModuleDocsData = z.infer<typeof moduleDocsDataSchema>;

export const moduleSetupStepSchema = z
	.strictObject({
		id: z.string().regex(/^STEP-[A-Z0-9-]+-[0-9]{2}$/),
		title: z.string().min(1),
		state: z.enum(["TODO", "BLOCKED"]),
		responsible: z.enum(["AI", "USER", "EXTERNAL"]),
		execution: z.strictObject({
			interactive: z.string().min(1),
			nonInteractive: z.string().min(1),
		}),
		requiredInputs: z.array(
			z.strictObject({
				name: identifier,
				description: z.string().min(1),
				sensitive: z.boolean(),
			}),
		),
		verify: z.string().min(1),
		successCondition: z.string().min(1),
		blockedReason: z.string().min(1).optional(),
	})
	.superRefine((step, context) => {
		if (step.state === "BLOCKED" && step.blockedReason === undefined) {
			context.addIssue({
				code: "custom",
				message: "BLOCKED setup step requires blockedReason",
				path: ["blockedReason"],
			});
		}
	});
export type ModuleSetupStep = z.infer<typeof moduleSetupStepSchema>;

export const moduleSetupPlanDataSchema = z.strictObject({
	steps: z.array(moduleSetupStepSchema).min(1),
});
export type ModuleSetupPlanData = z.infer<typeof moduleSetupPlanDataSchema>;

export const standardModuleManagementCommands = [
	"install",
	"uninstall",
	"status",
	"setup",
	"docs",
	"start",
	"stop",
] as const;
export const moduleManagementCommandSchema = z.enum(
	standardModuleManagementCommands,
);
export type ModuleManagementCommand = z.infer<
	typeof moduleManagementCommandSchema
>;

export const moduleCommandContextSchema = z.strictObject({
	workspaceRoot: z.string().min(1),
	input: z.unknown().optional(),
});
export type ModuleCommandContext = z.infer<typeof moduleCommandContextSchema>;

export const effectRetentionSchema = z.enum([
	"remove",
	"preserve",
	"explicit-purge",
]);
export type EffectRetention = z.infer<typeof effectRetentionSchema>;

export const deploymentEffectSchema = z.strictObject({
	kind: z.enum(["filesystem", "process", "network", "external-resource"]),
	description: z.string().min(1),
	path: z.string().min(1).optional(),
	retention: effectRetentionSchema,
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
		identity: moduleIdentitySchema,
		provides: z.array(moduleProvideSchema),
		requires: z.array(moduleRequireSchema),
		requirements: z.array(moduleRequirementSchema),
		configSlots: z.array(configSlotSchema),
		effects: z.array(deploymentEffectSchema),
		documentation: moduleDocumentationSchema,
	})
	.superRefine((descriptor, context) => {
		const expectedModuleRef = descriptor.packageName.slice(
			"@tomflow/proflow-".length,
		);
		if (descriptor.moduleRef !== expectedModuleRef) {
			context.addIssue({
				code: "custom",
				message:
					"moduleRef must equal the @tomflow/proflow-* package-name suffix",
				path: ["moduleRef"],
			});
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
	"CORE_PACKAGE_REQUIRED",
	"EXTERNAL_RESOURCE_UNAVAILABLE",
	"INSTALL_FAILED",
	"SETUP_FAILED",
	"START_FAILED",
	"STOP_FAILED",
	"UNINSTALL_FAILED",
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
		status: z.enum(["SUCCEEDED", "ACTION_REQUIRED", "FAILED"]),
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
		if (
			result.status !== "ACTION_REQUIRED" &&
			result.actionRequired !== undefined
		) {
			context.addIssue({
				code: "custom",
				message: "actionRequired is only valid for ACTION_REQUIRED",
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
		if (result.status !== "FAILED" && result.error !== undefined) {
			context.addIssue({
				code: "custom",
				message: "error is only valid for FAILED",
				path: ["error"],
			});
		}
		if (
			result.status === "SUCCEEDED" &&
			result.checks?.some((check) => check.status === "FAIL")
		) {
			context.addIssue({
				code: "custom",
				message: "SUCCEEDED cannot contain a failed deployment check",
				path: ["checks"],
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

function versionParts(version: string): [number, number, number] {
	const [majorPart = "0", minorPart = "0", patchPart = "0"] =
		version.split(".");
	return [
		Number.parseInt(majorPart, 10),
		Number.parseInt(minorPart, 10),
		Number.parseInt(patchPart, 10),
	];
}

function compareVersions(left: string, right: string): number {
	const leftParts = versionParts(left);
	const rightParts = versionParts(right);
	for (let index = 0; index < leftParts.length; index += 1) {
		const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

interface VersionBounds {
	minimum?: string;
	minimumInclusive: boolean;
	maximum?: string;
	maximumInclusive: boolean;
}

function versionBounds(range: string): VersionBounds | undefined {
	const bounds: VersionBounds = {
		minimumInclusive: true,
		maximumInclusive: false,
	};
	for (const token of range.trim().split(/\s+/)) {
		const match = /^(>=|>|<=|<|=)?(\d+\.\d+\.\d+)$/.exec(token);
		if (match?.[2] === undefined) return undefined;
		const operator = match[1] ?? "=";
		if (operator === ">=" || operator === ">") {
			bounds.minimum = match[2];
			bounds.minimumInclusive = operator === ">=";
		} else if (operator === "<=" || operator === "<") {
			bounds.maximum = match[2];
			bounds.maximumInclusive = operator === "<=";
		} else {
			bounds.minimum = match[2];
			bounds.maximum = match[2];
			bounds.minimumInclusive = true;
			bounds.maximumInclusive = true;
		}
	}
	return bounds;
}

function rangeIsTighter(currentRange: string, targetRange: string): boolean {
	if (currentRange === targetRange) return false;
	const current = versionBounds(currentRange);
	const target = versionBounds(targetRange);
	if (current === undefined || target === undefined) return true;
	if (current.minimum === undefined && target.minimum !== undefined)
		return true;
	if (
		current.minimum !== undefined &&
		target.minimum !== undefined &&
		(compareVersions(target.minimum, current.minimum) > 0 ||
			(compareVersions(target.minimum, current.minimum) === 0 &&
				current.minimumInclusive &&
				!target.minimumInclusive))
	) {
		return true;
	}
	if (current.maximum === undefined && target.maximum !== undefined)
		return true;
	if (
		current.maximum !== undefined &&
		target.maximum !== undefined &&
		(compareVersions(target.maximum, current.maximum) < 0 ||
			(compareVersions(target.maximum, current.maximum) === 0 &&
				current.maximumInclusive &&
				!target.maximumInclusive))
	) {
		return true;
	}
	return false;
}

export function assessModuleCompatibility(
	current: ModuleDescriptor,
	target: ModuleDescriptor,
): CompatibilityAssessment {
	const breakingChanges: string[] = [];
	if (
		current.moduleRef !== target.moduleRef ||
		current.packageName !== target.packageName ||
		current.kind !== target.kind
	) {
		breakingChanges.push("module identity or kind changed");
	}
	if (
		current.identity.domain !== target.identity.domain ||
		current.identity.summary !== target.identity.summary
	) {
		breakingChanges.push("module identity metadata changed");
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
		} else if (
			major(replacement.version) !== major(provided.version) ||
			compareVersions(replacement.version, provided.version) < 0
		) {
			breakingChanges.push(
				`provided contract major version changed: ${provided.contractRef}`,
			);
		}
	}
	for (const required of target.requires) {
		const previous = current.requires.find(
			(item) => item.contractRef === required.contractRef,
		);
		if (previous === undefined && required.optional !== true) {
			breakingChanges.push(`required contract added: ${required.contractRef}`);
		} else if (
			previous !== undefined &&
			previous.optional === true &&
			required.optional !== true
		) {
			breakingChanges.push(
				`optional contract became required: ${required.contractRef}`,
			);
		} else if (
			previous !== undefined &&
			rangeIsTighter(previous.versionRange, required.versionRange)
		) {
			breakingChanges.push(
				`required contract range tightened: ${required.contractRef}`,
			);
		}
	}
	for (const previous of current.configSlots) {
		if (!target.configSlots.some((slot) => slot.key === previous.key)) {
			breakingChanges.push(`config removed: ${previous.key}`);
		}
	}
	for (const slot of target.configSlots) {
		const previous = current.configSlots.find((item) => item.key === slot.key);
		if (slot.required && previous === undefined && slot.default === undefined) {
			breakingChanges.push(`required config added: ${slot.key}`);
		} else if (previous !== undefined && previous.type !== slot.type) {
			breakingChanges.push(`config type changed: ${slot.key}`);
		} else if (
			previous !== undefined &&
			previous.required === false &&
			slot.required &&
			slot.default === undefined
		) {
			breakingChanges.push(`config became required: ${slot.key}`);
		}
	}
	if (JSON.stringify(current.effects) !== JSON.stringify(target.effects)) {
		breakingChanges.push("deployment effects changed");
	}
	if (
		JSON.stringify(current.documentation) !==
		JSON.stringify(target.documentation)
	) {
		breakingChanges.push("module documentation entries changed");
	}
	if (
		rangeIsTighter(current.platformCompatibility, target.platformCompatibility)
	) {
		breakingChanges.push("platform compatibility tightened");
	}
	return { compatible: breakingChanges.length === 0, breakingChanges };
}

export * from "./workspace.ts";
