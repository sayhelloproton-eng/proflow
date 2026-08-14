import type { ApplyResult, ApplyStepResult } from "../contracts.ts";
import { PlatformError } from "../errors.ts";
import type { ModuleCatalog } from "../modules.ts";
import { ensureLayout, type WorkspacePaths } from "../paths.ts";
import {
	emptyDeploymentState,
	loadDeploymentState,
	loadPlan,
	saveDeploymentState,
} from "../persistence/index.ts";
import {
	checkPlanStale,
	evaluateStepCheck,
	type PlanInput,
} from "../planner/index.ts";
import { acquireWorkspaceLock } from "../security/index.ts";
import type { PackageManagerDriver } from "./driver.ts";
import { workspaceResidentDriver } from "./driver.ts";
import { executeStep } from "./execute.ts";
import type { RealityObserver } from "./reality.ts";
import { createRealityObserver } from "./reality.ts";

export interface ApplyContext {
	paths: WorkspacePaths;
	planRef: string;
	catalog: ModuleCatalog;
	/** Current stable assumptions the plan must still match (staleness gate). */
	current: PlanInput;
	driver?: PackageManagerDriver;
	observer?: RealityObserver;
}

function nowIso(): string {
	return new Date().toISOString();
}

function failureMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Applies a frozen deployment plan deterministically. Every step is re-checked
 * against current reality before any action: satisfied steps SKIP, human steps
 * persist a pendingAction and STOP with ACTION_REQUIRED, a failed/unknown effect
 * STOPs with FAILED, and only a fully applied plan is recorded in
 * `lastAppliedPlans`. The exclusive workspace lock is released in all paths.
 */
export async function applyPlan(context: ApplyContext): Promise<ApplyResult> {
	const driver = context.driver ?? workspaceResidentDriver();
	const observer =
		context.observer ??
		createRealityObserver({
			paths: context.paths,
			catalog: context.catalog,
			driver,
		});

	await ensureLayout(context.paths);
	const lock = await acquireWorkspaceLock(context.paths, context.planRef);
	try {
		const plan = await loadPlan(context.paths, context.planRef);
		if (plan === undefined) {
			throw new PlatformError(
				"PLAN_NOT_FOUND",
				`plan ${context.planRef} not found`,
			);
		}

		const staleness = checkPlanStale(plan, context.current);
		if (staleness.stale) {
			return {
				planRef: plan.planRef,
				outcome: "BLOCKED",
				stepResults: [],
				completedAt: nowIso(),
			};
		}

		const state =
			(await loadDeploymentState(context.paths)) ?? emptyDeploymentState();
		const stepResults: ApplyStepResult[] = [];

		for (const step of plan.steps) {
			const check = evaluateStepCheck(
				step,
				plan,
				await observer.observe(step, plan),
			);
			if (check.status === "SATISFIED") {
				stepResults.push({
					stepRef: step.stepRef,
					moduleRef: step.moduleRef,
					status: "SKIP",
					message: check.reason,
				});
				continue;
			}

			if (step.kind === "human") {
				const completedAt = nowIso();
				state.pendingActions.push({
					planRef: plan.planRef,
					action: step.expectedEffect,
					createdAt: completedAt,
				});
				state.updatedAt = completedAt;
				await saveDeploymentState(context.paths, state);
				stepResults.push({
					stepRef: step.stepRef,
					moduleRef: step.moduleRef,
					status: "ACTION_REQUIRED",
					message: check.reason,
				});
				return {
					planRef: plan.planRef,
					outcome: "ACTION_REQUIRED",
					stepResults,
					completedAt,
				};
			}

			try {
				await executeStep(
					{ paths: context.paths, catalog: context.catalog, driver },
					step,
					plan,
				);
			} catch (error) {
				stepResults.push({
					stepRef: step.stepRef,
					moduleRef: step.moduleRef,
					status: "FAILED",
					message: failureMessage(error),
				});
				state.updatedAt = nowIso();
				await saveDeploymentState(context.paths, state);
				return {
					planRef: plan.planRef,
					outcome: "FAILED",
					stepResults,
					completedAt: nowIso(),
				};
			}

			// Postcondition re-check: an effect that cannot be confirmed after
			// execution stops the apply rather than blindly repeating it.
			const post = evaluateStepCheck(
				step,
				plan,
				await observer.observe(step, plan),
			);
			if (post.status !== "SATISFIED") {
				stepResults.push({
					stepRef: step.stepRef,
					moduleRef: step.moduleRef,
					status: "FAILED",
					message: `postcondition not satisfied after execution: ${post.reason}`,
				});
				state.updatedAt = nowIso();
				await saveDeploymentState(context.paths, state);
				return {
					planRef: plan.planRef,
					outcome: "FAILED",
					stepResults,
					completedAt: nowIso(),
				};
			}

			stepResults.push({
				stepRef: step.stepRef,
				moduleRef: step.moduleRef,
				status: "EXECUTED",
				message: post.reason,
			});
		}

		const completedAt = nowIso();
		state.selectedModules = plan.resolvedModules.map((module) => ({
			moduleRef: module.moduleRef,
			moduleVersion: module.moduleVersion,
		}));
		state.lastAppliedPlans.push({
			planRef: plan.planRef,
			intent: plan.intent,
			appliedAt: completedAt,
		});
		state.updatedAt = completedAt;
		await saveDeploymentState(context.paths, state);

		return {
			planRef: plan.planRef,
			outcome: "COMPLETE",
			stepResults,
			completedAt,
		};
	} finally {
		await lock.release();
	}
}
