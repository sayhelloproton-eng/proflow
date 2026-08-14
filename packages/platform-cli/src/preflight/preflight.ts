import type { PlatformState, ResolvedModule } from "../contracts.ts";
import { PlatformError } from "../errors.ts";
import { buildDependencyGraph, type DependencyGraph } from "../graph/graph.ts";
import { checkConfigReadiness } from "./config.ts";
import type { PreflightFinding, PreflightResult } from "./findings.ts";
import { probeAllRequirements } from "./requirements.ts";

export interface PreflightOptions {
	config?: Record<string, Record<string, string>>;
}

export async function runPreflight(
	modules: readonly ResolvedModule[],
	options: PreflightOptions = {},
): Promise<PreflightResult> {
	const findings: PreflightFinding[] = [];

	let dependency: DependencyGraph | undefined;
	try {
		dependency = buildDependencyGraph(modules);
	} catch (error) {
		if (error instanceof PlatformError) {
			findings.push({
				code: error.code,
				severity: "error",
				message: error.message,
			});
		} else {
			throw error;
		}
	}

	findings.push(...checkConfigReadiness(modules, options.config));

	const requirementProbes = await probeAllRequirements(modules);
	for (const probe of requirementProbes) {
		if (probe.status === "ACTION_REQUIRED") {
			findings.push({
				code: "HUMAN_ACTION",
				severity: "action",
				moduleRef: probe.moduleRef,
				message: probe.message,
			});
		} else if (probe.status === "FAIL") {
			findings.push({
				code: "REQUIREMENT_FAIL",
				severity: "warning",
				moduleRef: probe.moduleRef,
				message: probe.message,
			});
		}
	}

	const status = deriveStatus(findings);
	return {
		ok: status === "READY",
		status,
		findings,
		requirementProbes,
		dependency,
	};
}

function deriveStatus(findings: readonly PreflightFinding[]): PlatformState {
	let hasError = false;
	let hasAction = false;
	let hasWarning = false;
	for (const finding of findings) {
		if (finding.severity === "error") hasError = true;
		else if (finding.severity === "action") hasAction = true;
		else if (finding.severity === "warning") hasWarning = true;
	}
	if (hasError) return "NOT_READY";
	if (hasAction) return "ACTION_REQUIRED";
	if (hasWarning) return "DEGRADED";
	return "READY";
}
