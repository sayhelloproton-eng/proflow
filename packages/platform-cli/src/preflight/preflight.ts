import type { ModuleOperationResult } from "@tomflow/proflow-module-contract";

import type { PlatformState, ResolvedModule } from "../contracts.ts";
import { PlatformError } from "../errors.ts";
import {
	buildDependencyGraph,
	type DependencyGraph,
	ModuleRefUnresolvedError,
} from "../graph/graph.ts";
import { dispatchLifecycle } from "../lifecycle/index.ts";
import type { ModuleCatalog } from "../modules.ts";
import type { WorkspacePaths } from "../paths.ts";
import { loadLatestVerification } from "../persistence/index.ts";
import { checkConfigReadiness, checkConfigReality } from "./config.ts";
import type {
	ModulePreflightResult,
	PreflightFinding,
	PreflightResult,
} from "./findings.ts";
import { probeAllRequirements } from "./requirements.ts";

export interface PreflightOptions {
	config?: Record<string, Record<string, string>>;
	catalog?: ModuleCatalog;
	paths?: WorkspacePaths;
}

function compareRef(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

async function humanVerifiedModules(
	modules: readonly ResolvedModule[],
	paths: WorkspacePaths | undefined,
): Promise<ReadonlySet<string>> {
	const verified = new Set<string>();
	if (paths === undefined) return verified;
	for (const module of modules) {
		const latest = await loadLatestVerification(paths, module.moduleRef);
		if (
			latest?.result === "PASS" &&
			latest.moduleVersion === module.moduleVersion
		) {
			verified.add(module.moduleRef);
		}
	}
	return verified;
}

export async function runPreflight(
	modules: readonly ResolvedModule[],
	options: PreflightOptions = {},
): Promise<PreflightResult> {
	const findings: PreflightFinding[] = [];

	let dependency: DependencyGraph | undefined;
	try {
		dependency = buildDependencyGraph(
			modules,
			options.config === undefined ? {} : { config: options.config },
		);
	} catch (error) {
		if (error instanceof ModuleRefUnresolvedError) {
			findings.push({
				code: "MODULE_REF_UNRESOLVED",
				severity: "error",
				moduleRef: error.from,
				message: error.message,
			});
		} else if (error instanceof PlatformError) {
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
	findings.push(...(await checkConfigReality(modules, options.config)));

	const verifiedHumanModules = await humanVerifiedModules(
		modules,
		options.paths,
	);
	const requirementProbes = await probeAllRequirements(
		modules,
		verifiedHumanModules,
	);
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

	const modulePreflight = await runModulePreflight(modules, options.catalog);
	for (const result of modulePreflight) {
		findings.push(...toFindings(result));
	}

	const status = deriveStatus(findings);
	return {
		ok: status === "READY",
		status,
		findings,
		requirementProbes,
		modulePreflight,
		dependency,
	};
}

async function runModulePreflight(
	modules: readonly ResolvedModule[],
	catalog: ModuleCatalog | undefined,
): Promise<ModulePreflightResult[]> {
	if (catalog === undefined) return [];
	const sorted = [...modules].sort((a, b) =>
		compareRef(a.moduleRef, b.moduleRef),
	);
	const results: ModulePreflightResult[] = [];
	for (const module of sorted) {
		if (!module.lifecycle.includes("preflight")) continue;
		results.push(await preflightOne(catalog, module));
	}
	return results;
}

async function preflightOne(
	catalog: ModuleCatalog,
	module: ResolvedModule,
): Promise<ModulePreflightResult> {
	try {
		const dispatched = await dispatchLifecycle(catalog, module, "preflight");
		const result = dispatched.result;
		return {
			moduleRef: module.moduleRef,
			status: result.status,
			message: modulePreflightMessage(module.moduleRef, result),
		};
	} catch (error) {
		return {
			moduleRef: module.moduleRef,
			status: "UNBOUND",
			message: `module ${module.moduleRef} preflight unavailable: adapter is not bound to a runtime (${errorMessage(error)})`,
		};
	}
}

function modulePreflightMessage(
	moduleRef: string,
	result: ModuleOperationResult,
): string {
	switch (result.status) {
		case "SUCCEEDED":
			return `module ${moduleRef} preflight succeeded`;
		case "ACTION_REQUIRED": {
			const action = result.actionRequired;
			return action !== undefined
				? `module ${moduleRef} preflight requires action "${action.action}": ${action.description}`
				: `module ${moduleRef} preflight requires an unspecified human action`;
		}
		case "BLOCKED":
		case "FAILED": {
			const error = result.error;
			return error !== undefined
				? `module ${moduleRef} preflight ${result.status.toLowerCase()}: ${error.code}: ${error.message}`
				: `module ${moduleRef} preflight ${result.status.toLowerCase()}`;
		}
	}
}

function toFindings(result: ModulePreflightResult): PreflightFinding[] {
	switch (result.status) {
		case "SUCCEEDED":
			return [];
		case "ACTION_REQUIRED":
		case "UNBOUND":
			return [
				{
					code: "MODULE_PREFLIGHT_ACTION_REQUIRED",
					severity: "action",
					moduleRef: result.moduleRef,
					message: result.message,
				},
			];
		case "BLOCKED":
			return [
				{
					code: "MODULE_PREFLIGHT_BLOCKED",
					severity: "error",
					moduleRef: result.moduleRef,
					message: result.message,
				},
			];
		case "FAILED":
			return [
				{
					code: "MODULE_PREFLIGHT_FAILED",
					severity: "error",
					moduleRef: result.moduleRef,
					message: result.message,
				},
			];
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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
