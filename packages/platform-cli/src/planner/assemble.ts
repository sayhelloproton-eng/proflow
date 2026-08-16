import { createHash } from "node:crypto";

import type {
	DeploymentEffect,
	HumanAction,
	ModuleDescriptor,
} from "@tomflow/proflow-module-contract";

import type {
	DeploymentIntent,
	DeploymentPlan,
	DeploymentStep,
	ModuleTarget,
	ResolvedModule,
} from "../contracts.ts";
import { buildDependencyGraph } from "../graph/graph.ts";
import { computeFingerprint } from "./fingerprint.ts";

function compareRef(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function toResolvedModule(descriptor: ModuleDescriptor): ResolvedModule {
	return {
		moduleRef: descriptor.moduleRef,
		packageName: descriptor.packageName,
		moduleVersion: descriptor.moduleVersion,
		kind: descriptor.kind,
		installClass: descriptor.installClass,
		identity: descriptor.identity,
		documentation: descriptor.documentation,
		provides: descriptor.provides,
		requires: descriptor.requires,
		requirements: descriptor.requirements,
		configSlots: descriptor.configSlots,
		lifecycle: descriptor.lifecycle.supported,
		verification: descriptor.verification,
		effects: descriptor.effects,
		source: { type: "installed" },
	};
}

export function generatePlanRef(
	intent: DeploymentIntent,
	moduleTargets: readonly ModuleTarget[],
	now: Date,
): string {
	const key = JSON.stringify({
		intent,
		targets: [...moduleTargets]
			.sort((a, b) => compareRef(a.moduleRef, b.moduleRef))
			.map((target) => ({
				moduleRef: target.moduleRef,
				targetVersion: target.targetVersion ?? null,
			})),
	});
	const hash = createHash("sha256").update(key).digest("hex").slice(0, 8);
	return `plan-${intent}-${now.getTime()}-${hash}`;
}

export function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const key of Object.keys(value)) {
			deepFreeze((value as Record<string, unknown>)[key]);
		}
	}
	return value;
}

export interface AssembleArgs {
	intent: DeploymentIntent;
	modules: readonly ResolvedModule[];
	targets: readonly ModuleTarget[];
	config: Record<string, Record<string, string>> | undefined;
	steps: DeploymentStep[];
	humanActions: HumanAction[];
	now: Date;
	targetDescriptors?: readonly ModuleDescriptor[];
}

export function assemblePlan(args: AssembleArgs): DeploymentPlan {
	const graph = buildDependencyGraph(args.modules);
	const byRef = new Map(
		args.modules.map((module) => [module.moduleRef, module]),
	);
	const targetByRef = new Map(
		args.targets.map((target) => [target.moduleRef, target]),
	);

	const moduleTargets: ModuleTarget[] = [];
	for (const ref of graph.order) {
		const explicit = targetByRef.get(ref);
		const merged: Record<string, string> = {
			...(explicit?.config ?? {}),
			...(args.config?.[ref] ?? {}),
		};
		const target: ModuleTarget = { moduleRef: ref };
		if (explicit?.targetVersion !== undefined) {
			target.targetVersion = explicit.targetVersion;
		}
		if (Object.keys(merged).length > 0) {
			target.config = merged;
		}
		moduleTargets.push(target);
	}

	const verification = graph.order.map((ref) => ({
		moduleRef: ref,
		checks: (byRef.get(ref)?.verification.checks ?? []).map(
			(check) => check.id,
		),
	}));

	const effectMap = new Map<string, DeploymentEffect>();
	for (const module of args.modules) {
		for (const effect of module.effects) {
			const key = `${effect.kind}:${effect.description}`;
			if (!effectMap.has(key)) effectMap.set(key, effect);
		}
	}
	const effects = [...effectMap.values()].sort((a, b) =>
		compareRef(`${a.kind}:${a.description}`, `${b.kind}:${b.description}`),
	);

	const humanByAction = new Map<string, HumanAction>();
	for (const action of args.humanActions) {
		if (!humanByAction.has(action.action)) {
			humanByAction.set(action.action, action);
		}
	}
	const humanActions = [...humanByAction.values()].sort((a, b) =>
		compareRef(a.action, b.action),
	);

	const resolvedModules = [...args.modules].sort((a, b) =>
		compareRef(a.moduleRef, b.moduleRef),
	);

	const plan: DeploymentPlan = {
		planRef: "",
		intent: args.intent,
		moduleTargets,
		resolvedModules,
		...(args.targetDescriptors !== undefined
			? { targetDescriptors: [...args.targetDescriptors] }
			: {}),
		steps: args.steps,
		effects,
		humanActions,
		verification,
		fingerprint: "",
		createdAt: args.now.toISOString(),
	};
	plan.planRef = generatePlanRef(args.intent, moduleTargets, args.now);
	plan.fingerprint = computeFingerprint(plan);
	return deepFreeze(plan);
}
