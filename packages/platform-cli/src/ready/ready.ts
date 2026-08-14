import type {
	PlatformState,
	ResolvedModule,
	VerificationRecord,
} from "../contracts.ts";
import { PlatformError, type PlatformErrorCode } from "../errors.ts";
import { buildDependencyGraph } from "../graph/index.ts";
import type { LifecycleRunResult } from "../lifecycle/index.ts";
import { checkConfigReadiness } from "../preflight/index.ts";

export type ReadyFindingSeverity = "blocking" | "degraded";

export type ReadyFindingCode =
	| "DEPENDENCY_UNRESOLVED"
	| "DEPENDENCY_INCOMPATIBLE"
	| "DEPENDENCY_CYCLE"
	| "MODULE_REF_UNRESOLVED"
	| "CONFIG_MISSING"
	| "RUNTIME_STATUS_UNAVAILABLE"
	| "RUNTIME_NOT_READY"
	| "RUNTIME_ACTION_REQUIRED"
	| "RUNTIME_CHECK_FAIL"
	| "RUNTIME_CHECK_WARN"
	| "VERIFICATION_MISSING"
	| "VERIFICATION_STALE"
	| "VERIFICATION_FAIL"
	| "BLOCKING_ACTION";

export interface ReadyFinding {
	severity: ReadyFindingSeverity;
	code: ReadyFindingCode;
	moduleRef?: string;
	message: string;
}

export interface BlockingAction {
	moduleRef?: string;
	action: string;
	description?: string;
}

export interface PlatformReadyInput {
	modules: readonly ResolvedModule[];
	status: readonly LifecycleRunResult[];
	verification: readonly VerificationRecord[];
	config?: Record<string, Record<string, string>>;
	blockingActions?: readonly BlockingAction[];
}

export interface PlatformReadyResult {
	state: PlatformState;
	findings: ReadyFinding[];
}

function compareRef(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function toDependencyCode(
	code: PlatformErrorCode,
): ReadyFindingCode | undefined {
	switch (code) {
		case "DEPENDENCY_UNRESOLVED":
		case "DEPENDENCY_INCOMPATIBLE":
		case "DEPENDENCY_CYCLE":
			return code;
		default:
			return undefined;
	}
}

function isHumanAction(code: ReadyFindingCode): boolean {
	return code === "RUNTIME_ACTION_REQUIRED" || code === "BLOCKING_ACTION";
}

function deriveState(findings: readonly ReadyFinding[]): PlatformState {
	let hardFailure = false;
	let humanAction = false;
	let degraded = false;
	for (const finding of findings) {
		if (finding.severity === "degraded") {
			degraded = true;
			continue;
		}
		if (isHumanAction(finding.code)) humanAction = true;
		else hardFailure = true;
	}
	if (hardFailure) return "NOT_READY";
	if (humanAction) return "ACTION_REQUIRED";
	if (degraded) return "DEGRADED";
	return "READY";
}

/**
 * Aggregates current reality into a single PlatformState. READY is derived only
 * from live runtime status, current-version verification records, resolved
 * dependencies, required config, and the absence of blocking human actions.
 * Persisted PASS history, a bare SUCCEEDED operation, or a schema-valid but
 * non-success structured result can never fabricate READY on their own.
 */
export function assessPlatformReady(
	input: PlatformReadyInput,
): PlatformReadyResult {
	const findings: ReadyFinding[] = [];
	const modules = [...input.modules].sort((a, b) =>
		compareRef(a.moduleRef, b.moduleRef),
	);
	const nodeSet = new Set(modules.map((module) => module.moduleRef));

	// logical dependencies resolved + cross-module compatibility
	try {
		buildDependencyGraph(modules);
	} catch (error) {
		if (!(error instanceof PlatformError)) throw error;
		const code = toDependencyCode(error.code);
		if (code === undefined) throw error;
		findings.push({ severity: "blocking", code, message: error.message });
	}

	// moduleRef bindings resolved
	for (const module of modules) {
		for (const slot of module.configSlots) {
			if (slot.type !== "moduleRef" || typeof slot.default !== "string") {
				continue;
			}
			if (!nodeSet.has(slot.default)) {
				findings.push({
					severity: "blocking",
					code: "MODULE_REF_UNRESOLVED",
					moduleRef: module.moduleRef,
					message: `moduleRef binding ${slot.key}=${slot.default} for ${module.moduleRef} does not resolve to a selected module`,
				});
			}
		}
	}

	// required config ready
	for (const finding of checkConfigReadiness(modules, input.config)) {
		findings.push({
			severity: "blocking",
			code: "CONFIG_MISSING",
			...(finding.moduleRef !== undefined
				? { moduleRef: finding.moduleRef }
				: {}),
			message: finding.message,
		});
	}

	// required runtimes current READY (live status, never persisted)
	const statusByRef = new Map(
		input.status.map((run) => [run.moduleRef, run] as const),
	);
	for (const module of modules) {
		if (!module.lifecycle.includes("status")) continue;
		const run = statusByRef.get(module.moduleRef);
		if (
			run === undefined ||
			run.status !== "EXECUTED" ||
			run.result === undefined
		) {
			findings.push({
				severity: "blocking",
				code: "RUNTIME_STATUS_UNAVAILABLE",
				moduleRef: module.moduleRef,
				message: `no live status observed for ${module.moduleRef}`,
			});
			continue;
		}
		const result = run.result;
		if (result.status === "ACTION_REQUIRED") {
			const action = result.actionRequired;
			findings.push({
				severity: "blocking",
				code: "RUNTIME_ACTION_REQUIRED",
				moduleRef: module.moduleRef,
				message:
					action !== undefined
						? `${module.moduleRef} requires action "${action.action}"`
						: `${module.moduleRef} requires an unspecified human action`,
			});
		} else if (result.status !== "SUCCEEDED") {
			findings.push({
				severity: "blocking",
				code: "RUNTIME_NOT_READY",
				moduleRef: module.moduleRef,
				message: `runtime ${module.moduleRef} is ${result.status.toLowerCase()}`,
			});
		}
		for (const runtimeCheck of result.checks ?? []) {
			if (runtimeCheck.status === "FAIL") {
				findings.push({
					severity: "blocking",
					code: "RUNTIME_CHECK_FAIL",
					moduleRef: module.moduleRef,
					message: `runtime check ${runtimeCheck.id} failed for ${module.moduleRef}`,
				});
			} else if (runtimeCheck.status === "WARN") {
				findings.push({
					severity: "degraded",
					code: "RUNTIME_CHECK_WARN",
					moduleRef: module.moduleRef,
					message: `runtime check ${runtimeCheck.id} warns for ${module.moduleRef}`,
				});
			}
		}
	}

	// current-version verification PASS
	const recordsByRef = new Map<string, VerificationRecord[]>();
	for (const record of input.verification) {
		const list = recordsByRef.get(record.moduleRef) ?? [];
		list.push(record);
		recordsByRef.set(record.moduleRef, list);
	}
	for (const module of modules) {
		if (!module.lifecycle.includes("verify")) continue;
		const records = recordsByRef.get(module.moduleRef) ?? [];
		const current = records.filter(
			(record) => record.moduleVersion === module.moduleVersion,
		);
		const latestCurrent = current[current.length - 1];
		if (latestCurrent === undefined) {
			const code: ReadyFindingCode =
				records.length === 0 ? "VERIFICATION_MISSING" : "VERIFICATION_STALE";
			findings.push({
				severity: "blocking",
				code,
				moduleRef: module.moduleRef,
				message: `no current-version verification record for ${module.moduleRef}@${module.moduleVersion}`,
			});
		} else if (latestCurrent.result !== "PASS") {
			findings.push({
				severity: "blocking",
				code: "VERIFICATION_FAIL",
				moduleRef: module.moduleRef,
				message: `current-version verification FAIL for ${module.moduleRef}@${module.moduleVersion}`,
			});
		}
	}

	// blocking ACTION_REQUIRED count must be zero
	for (const action of input.blockingActions ?? []) {
		findings.push({
			severity: "blocking",
			code: "BLOCKING_ACTION",
			...(action.moduleRef !== undefined
				? { moduleRef: action.moduleRef }
				: {}),
			message: action.description ?? action.action,
		});
	}

	return { state: deriveState(findings), findings };
}
