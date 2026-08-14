import type { PlatformState } from "../contracts.ts";
import type { PlatformErrorCode } from "../errors.ts";
import type { DependencyGraph } from "../graph/graph.ts";
import type { RequirementProbe } from "./requirements.ts";

export type FindingSeverity = "error" | "warning" | "action";

export type PreflightFindingCode =
	| PlatformErrorCode
	| "REQUIREMENT_FAIL"
	| "HUMAN_ACTION";

export interface PreflightFinding {
	code: PreflightFindingCode;
	severity: FindingSeverity;
	moduleRef?: string;
	message: string;
}

export interface PreflightResult {
	ok: boolean;
	status: PlatformState;
	findings: PreflightFinding[];
	requirementProbes: RequirementProbe[];
	dependency: DependencyGraph | undefined;
}
