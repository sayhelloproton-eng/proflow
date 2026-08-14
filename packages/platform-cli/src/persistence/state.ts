import type { DeploymentState, PendingActionRecord } from "../contracts.ts";
import { readJson, type WorkspacePaths } from "../paths.ts";
import { writeJsonAtomic } from "./atomic.ts";
import { DEPLOYMENT_STATE_CONTRACT, isDeploymentState } from "./guards.ts";

export function emptyDeploymentState(): DeploymentState {
	return {
		contract: DEPLOYMENT_STATE_CONTRACT,
		selectedModules: [],
		lastAppliedPlans: [],
		verificationIndex: [],
		pendingActions: [],
		updatedAt: new Date().toISOString(),
	};
}

export function clearPendingActions(
	state: DeploymentState,
	isResolved: (action: PendingActionRecord) => boolean,
): DeploymentState {
	return {
		...state,
		pendingActions: state.pendingActions.filter(
			(action) => !isResolved(action),
		),
	};
}

export function clearCompletedPendingActions(
	state: DeploymentState,
): DeploymentState {
	const completed = new Set(
		state.lastAppliedPlans.map((entry) => entry.planRef),
	);
	return clearPendingActions(state, (action) => completed.has(action.planRef));
}

// Loaded state is validated at the boundary; a missing or corrupt file resolves
// to undefined so stale persisted facts can never impersonate current reality.
export async function loadDeploymentState(
	paths: WorkspacePaths,
): Promise<DeploymentState | undefined> {
	const value = await readJson<unknown>(paths.stateJson);
	if (value === undefined) return undefined;
	return isDeploymentState(value) ? value : undefined;
}

export async function saveDeploymentState(
	paths: WorkspacePaths,
	state: DeploymentState,
): Promise<void> {
	await writeJsonAtomic(paths.stateJson, state);
}
