import { join } from "node:path";

import type { PlatformState } from "../contracts.ts";
import { atomicWrite, type WorkspacePaths } from "../paths.ts";

export type DeploymentObserverSource = "status" | "verify" | "doctor";
export type DeploymentObserverModuleStatus =
	| "SUCCEEDED"
	| "BLOCKED"
	| "ACTION_REQUIRED"
	| "FAILED";

export interface DeploymentObserverSummary {
	contract: "proflow.deployment-observer-summary.v1";
	scope: "PLATFORM";
	source: DeploymentObserverSource;
	state: PlatformState;
	selectedModuleCount: number;
	totalModuleCount: number;
	observedModuleCount: number;
	blockingModuleCount: number;
	modules: readonly {
		moduleRef: string;
		status: DeploymentObserverModuleStatus;
	}[];
	observedAt: string;
	freshUntil: string;
}

function stateOf(
	statuses: readonly DeploymentObserverModuleStatus[],
): PlatformState {
	if (statuses.includes("FAILED") || statuses.includes("BLOCKED"))
		return "NOT_READY";
	if (statuses.includes("ACTION_REQUIRED")) return "ACTION_REQUIRED";
	return statuses.length === 0 ? "NOT_READY" : "READY";
}

export const DEPLOYMENT_OBSERVER_SUMMARY_TTL_MS = 60_000;

export async function writeDeploymentObserverSummary(input: {
	paths: WorkspacePaths;
	source: DeploymentObserverSource;
	selectedModuleCount: number;
	totalModuleCount: number;
	modules: readonly {
		moduleRef: string;
		status: DeploymentObserverModuleStatus;
	}[];
}): Promise<DeploymentObserverSummary> {
	const modules = [...input.modules].sort((a, b) =>
		a.moduleRef.localeCompare(b.moduleRef),
	);
	const observedAt = new Date();
	const isCompletePlatformObservation =
		input.selectedModuleCount === input.totalModuleCount &&
		modules.length === input.totalModuleCount;
	const summary: DeploymentObserverSummary = {
		contract: "proflow.deployment-observer-summary.v1",
		scope: "PLATFORM",
		source: input.source,
		state: isCompletePlatformObservation
			? stateOf(modules.map((item) => item.status))
			: "NOT_READY",
		selectedModuleCount: input.selectedModuleCount,
		totalModuleCount: input.totalModuleCount,
		observedModuleCount: modules.length,
		blockingModuleCount: modules.filter((item) => item.status !== "SUCCEEDED")
			.length,
		modules,
		observedAt: observedAt.toISOString(),
		freshUntil: new Date(
			observedAt.getTime() + DEPLOYMENT_OBSERVER_SUMMARY_TTL_MS,
		).toISOString(),
	};
	await atomicWrite(
		join(input.paths.deployment, "observer-summary.json"),
		`${JSON.stringify(summary, null, 2)}\n`,
	);
	return summary;
}
