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
	ExecuteStrategy,
	evaluateStepCheck,
	type PlanInput,
} from "../planner/index.ts";
import { acquireWorkspaceLock } from "../security/index.ts";
import type { PackageManagerDriver } from "./driver.ts";
import { type ExecuteStepOutcome, executeStep } from "./execute.ts";
import type { RealityObserver } from "./reality.ts";
import { createRealityObserver } from "./reality.ts";

export interface ApplyContext {
	paths: WorkspacePaths;
	planRef: string;
	catalog: ModuleCatalog;
	/** Current stable assumptions the plan must still match (staleness gate). */
	current: PlanInput;
	driver: PackageManagerDriver;
	observer?: RealityObserver;
	/** Rebuilds installed descriptors/bindings after a package mutation. */
	refreshCatalog?: () => Promise<ModuleCatalog>;
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
 * and ACTION_REQUIRED mutations persist a structured pendingAction and STOP with
 * ACTION_REQUIRED, a BLOCKED/FAILED mutation STOPs with the matching outcome,
 * and only a fully applied plan is recorded in `lastAppliedPlans`. The exclusive
 * workspace lock is released in all paths.
 */
export async function applyPlan(context: ApplyContext): Promise<ApplyResult> {
	const driver = context.driver;
	let catalog = context.catalog;
	let observer =
		context.observer ??
		createRealityObserver({
			paths: context.paths,
			catalog,
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
			const reality = await observer.observe(step, plan);
			if (reality === undefined) {
				// UNKNOWN: current reality could not be observed. Stop without
				// replaying any lifecycle/external effect, then doctor/repair.
				stepResults.push({
					stepRef: step.stepRef,
					moduleRef: step.moduleRef,
					status: "FAILED",
					message: `blocked: current reality for ${step.moduleRef} could not be observed`,
				});
				state.updatedAt = nowIso();
				await saveDeploymentState(context.paths, state);
				return {
					planRef: plan.planRef,
					outcome: "BLOCKED",
					stepResults,
					completedAt: nowIso(),
				};
			}
			const check = evaluateStepCheck(step, plan, reality);
			if (check.status === "SATISFIED") {
				// A previously-pending action for this step can no longer block a
				// resume: the step is satisfied in current reality, so clear it.
				state.pendingActions = state.pendingActions.filter(
					(pending) =>
						!(
							pending.planRef === plan.planRef &&
							pending.stepRef === step.stepRef
						),
				);
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
					stepRef: step.stepRef,
					moduleRef: step.moduleRef,
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

			let outcome: ExecuteStepOutcome;
			try {
				outcome = await executeStep(
					{ paths: context.paths, catalog, driver },
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

			switch (outcome.kind) {
				case "SUCCEEDED": {
					if (step.executeStrategy === ExecuteStrategy.lifecycleUninstall) {
						// A lifecycle uninstall is owned by the module adapter. Its typed
						// SUCCEEDED result is the authoritative teardown confirmation. An
						// idempotent uninstall can legitimately leave status UNBOUND/UNKNOWN,
						// so a second status probe must not reinterpret that successful
						// teardown as a failed lifecycle:stopped postcondition.
						stepResults.push({
							stepRef: step.stepRef,
							moduleRef: step.moduleRef,
							status: "EXECUTED",
							message: `${step.moduleRef} owner confirmed lifecycle uninstall`,
						});
						break;
					}

					// Postcondition re-check: only a genuinely successful mutation is
					// confirmed; an effect that cannot be confirmed stops the apply
					// rather than blindly repeating it.
					const postReality = await observer.observe(step, plan);
					if (postReality === undefined) {
						stepResults.push({
							stepRef: step.stepRef,
							moduleRef: step.moduleRef,
							status: "FAILED",
							message: `blocked: postcondition reality for ${step.moduleRef} could not be observed`,
						});
						state.updatedAt = nowIso();
						await saveDeploymentState(context.paths, state);
						return {
							planRef: plan.planRef,
							outcome: "BLOCKED",
							stepResults,
							completedAt: nowIso(),
						};
					}
					const post = evaluateStepCheck(step, plan, postReality);
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

					if (step.kind === "package" && context.refreshCatalog !== undefined) {
						try {
							catalog = await context.refreshCatalog();
							if (context.observer === undefined) {
								observer = createRealityObserver({
									paths: context.paths,
									catalog,
									driver,
								});
							}
						} catch (error) {
							stepResults.push({
								stepRef: step.stepRef,
								moduleRef: step.moduleRef,
								status: "FAILED",
								message: `post-package catalog refresh failed: ${failureMessage(error)}`,
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
					}
					break;
				}
				case "ACTION_REQUIRED": {
					const completedAt = nowIso();
					state.pendingActions.push({
						planRef: plan.planRef,
						stepRef: step.stepRef,
						moduleRef: step.moduleRef,
						action: outcome.actionRequired.action,
						description: outcome.actionRequired.description,
						createdAt: completedAt,
					});
					state.updatedAt = completedAt;
					await saveDeploymentState(context.paths, state);
					stepResults.push({
						stepRef: step.stepRef,
						moduleRef: step.moduleRef,
						status: "ACTION_REQUIRED",
						message: outcome.actionRequired.action,
					});
					return {
						planRef: plan.planRef,
						outcome: "ACTION_REQUIRED",
						stepResults,
						completedAt,
					};
				}
				case "BLOCKED": {
					stepResults.push({
						stepRef: step.stepRef,
						moduleRef: step.moduleRef,
						status: "FAILED",
						message: `blocked: ${outcome.reason}`,
					});
					state.updatedAt = nowIso();
					await saveDeploymentState(context.paths, state);
					return {
						planRef: plan.planRef,
						outcome: "BLOCKED",
						stepResults,
						completedAt: nowIso(),
					};
				}
				case "FAILED": {
					stepResults.push({
						stepRef: step.stepRef,
						moduleRef: step.moduleRef,
						status: "FAILED",
						message: outcome.reason,
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
			}
		}

		const completedAt = nowIso();
		if (plan.intent === "uninstall") {
			const removed = new Set(
				plan.resolvedModules.map((module) => module.moduleRef),
			);
			state.selectedModules = state.selectedModules.filter(
				(module) => !removed.has(module.moduleRef),
			);
		} else if (
			(plan.intent === "install" || plan.intent === "upgrade") &&
			plan.resolvedModules.every((module) => module.source.type === "registry")
		) {
			const byRef = new Map(
				state.selectedModules.map((module) => [module.moduleRef, module]),
			);
			for (const module of plan.resolvedModules) {
				byRef.set(module.moduleRef, {
					moduleRef: module.moduleRef,
					moduleVersion: module.moduleVersion,
				});
			}
			state.selectedModules = [...byRef.values()].sort((left, right) =>
				left.moduleRef.localeCompare(right.moduleRef),
			);
		} else {
			state.selectedModules = plan.resolvedModules.map((module) => ({
				moduleRef: module.moduleRef,
				moduleVersion: module.moduleVersion,
			}));
		}
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
