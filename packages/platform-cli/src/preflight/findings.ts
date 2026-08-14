import type { PlatformState } from "../contracts.ts";
import type { PlatformErrorCode } from "../errors.ts";
import type { DependencyGraph } from "../graph/graph.ts";
import type { RequirementProbe } from "./requirements.ts";

export type FindingSeverity = "error" | "warning" | "action";

export type PreflightFindingCode =
	| PlatformErrorCode
	| "REQUIREMENT_FAIL"
	| "HUMAN_ACTION"
	| "MODULE_REF_UNRESOLVED"
	| "MODULE_PREFLIGHT_BLOCKED"
	| "MODULE_PREFLIGHT_FAILED"
	| "MODULE_PREFLIGHT_ACTION_REQUIRED";

export interface PreflightFinding {
	code: PreflightFindingCode;
	severity: FindingSeverity;
	moduleRef?: string;
	message: string;
}

export type ModulePreflightStatus =
	| "SUCCEEDED"
	| "ACTION_REQUIRED"
	| "BLOCKED"
	| "FAILED"
	| "UNBOUND";

export interface ModulePreflightResult {
	moduleRef: string;
	status: ModulePreflightStatus;
	message: string;
}

export interface PreflightResult {
	ok: boolean;
	status: PlatformState;
	findings: PreflightFinding[];
	requirementProbes: RequirementProbe[];
	modulePreflight: ModulePreflightResult[];
	dependency: DependencyGraph | undefined;
}
