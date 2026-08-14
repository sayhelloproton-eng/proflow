import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { DeploymentPlan } from "../contracts.ts";
import { readJson, type WorkspacePaths } from "../paths.ts";
import { writeJsonAtomic } from "./atomic.ts";
import { assertSafeFileName, isDeploymentPlan } from "./guards.ts";

function planFilePath(paths: WorkspacePaths, planRef: string): string {
	assertSafeFileName(planRef, "planRef");
	return join(paths.plans, `${planRef}.json`);
}

// Plans are public DTOs: secretRef config values are opaque reference
// identities (e.g. `secret://model-provider/default`), safe to persist verbatim.
// No raw secret ever enters a plan, so no redaction is applied on save.
export async function savePlan(
	paths: WorkspacePaths,
	plan: DeploymentPlan,
): Promise<void> {
	await writeJsonAtomic(planFilePath(paths, plan.planRef), plan);
}

export async function loadPlan(
	paths: WorkspacePaths,
	planRef: string,
): Promise<DeploymentPlan | undefined> {
	const value = await readJson<unknown>(planFilePath(paths, planRef));
	if (value === undefined) return undefined;
	return isDeploymentPlan(value) ? value : undefined;
}

export async function listPlans(paths: WorkspacePaths): Promise<string[]> {
	let entries: string[];
	try {
		entries = await readdir(paths.plans);
	} catch {
		return [];
	}
	return entries
		.filter((entry) => entry.endsWith(".json"))
		.map((entry) => entry.slice(0, -".json".length))
		.sort();
}
