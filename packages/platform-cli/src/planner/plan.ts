import type { ModuleDescriptor } from "@tomflow/proflow-module-contract";

import type {
	DeploymentIntent,
	DeploymentPlan,
	DeploymentStep,
	ModuleTarget,
	ResolvedModule,
} from "../contracts.ts";
import { PlatformError } from "../errors.ts";
import { buildDependencyGraph, type DependencyGraph } from "../graph/graph.ts";
import { assemblePlan } from "./assemble.ts";
import type { RepairFact } from "./repair.ts";
import { planRepair } from "./repair.ts";
import {
	configStep,
	createSequencer,
	externalResourceStep,
	humanActionsFromModules,
	humanStep,
	lifecycleStep,
	packageStep,
	upstreamDependencies,
} from "./steps.ts";
import { planUpgrade } from "./upgrade.ts";

export interface PlanInput {
	intent: DeploymentIntent;
	modules?: readonly ResolvedModule[];
	targets?: readonly ModuleTarget[];
	config?: Record<string, Record<string, string>>;
	currentDescriptors?: readonly ModuleDescriptor[];
	targetDescriptors?: readonly ModuleDescriptor[];
	facts?: readonly RepairFact[];
	now?: Date;
}

export function planDeployment(input: PlanInput): DeploymentPlan {
	switch (input.intent) {
		case "upgrade":
			return input.modules?.every((module) => module.source.type === "registry")
				? planRegistryPackageUpgrade(input)
				: planUpgrade(input);
		case "repair":
			return planRepair(input);
		case "uninstall":
			return planUninstall(input);
		case "install":
		case "configure":
			return planInstallOrConfigure(input);
	}
}

function planRegistryPackageUpgrade(input: PlanInput): DeploymentPlan {
	const modules = input.modules;
	if (modules === undefined) {
		throw new PlatformError(
			"INVALID_REQUEST",
			"registry-backed upgrade requires modules",
		);
	}
	const graph = buildDependencyGraph(modules);
	const byRef = new Map(modules.map((module) => [module.moduleRef, module]));
	const seq = createSequencer();
	const steps: DeploymentStep[] = [];
	for (const ref of graph.order) {
		const module = byRef.get(ref);
		if (module === undefined) continue;
		steps.push(packageStep(seq, module, "upgrade", []));
	}
	return assemblePlan({
		intent: "upgrade",
		modules,
		targets: input.targets ?? [],
		config: undefined,
		steps,
		humanActions: [],
		now: input.now ?? new Date(),
	});
}

function planInstallOrConfigure(input: PlanInput): DeploymentPlan {
	const modules = input.modules;
	if (modules === undefined) {
		throw new PlatformError(
			"INVALID_REQUEST",
			`${input.intent} requires modules`,
		);
	}
	const graph = buildDependencyGraph(modules);
	const steps =
		input.intent === "install"
			? installSteps(modules, graph)
			: configureSteps(modules, graph);
	return assemblePlan({
		intent: input.intent,
		modules,
		targets: input.targets ?? [],
		config: input.config,
		steps,
		humanActions: humanActionsFromModules(modules),
		now: input.now ?? new Date(),
	});
}

function installSteps(
	modules: readonly ResolvedModule[],
	graph: DependencyGraph,
): DeploymentStep[] {
	const seq = createSequencer();
	const deps = upstreamDependencies(graph);
	const byRef = new Map(modules.map((module) => [module.moduleRef, module]));
	const steps: DeploymentStep[] = [];
	for (const ref of graph.order) {
		const module = byRef.get(ref);
		if (module === undefined) continue;
		const dependencies = deps.get(ref) ?? [];
		steps.push(packageStep(seq, module, "install", dependencies));
		if (module.configSlots.length > 0) {
			steps.push(configStep(seq, module));
		}
		if (module.kind === "external-resource") {
			const step = externalResourceStep(seq, module);
			if (step !== undefined) steps.push(step);
		}
		for (const requirement of module.requirements) {
			if (requirement.kind === "human") {
				steps.push(humanStep(seq, module, requirement.action));
			}
		}
	}
	return steps;
}

function configureSteps(
	modules: readonly ResolvedModule[],
	graph: DependencyGraph,
): DeploymentStep[] {
	const seq = createSequencer();
	const byRef = new Map(modules.map((module) => [module.moduleRef, module]));
	const steps: DeploymentStep[] = [];
	for (const ref of graph.order) {
		const module = byRef.get(ref);
		if (module === undefined) continue;
		if (module.configSlots.length > 0) {
			steps.push(configStep(seq, module));
		}
		if (module.kind === "external-resource") {
			const step = externalResourceStep(seq, module);
			if (step !== undefined) steps.push(step);
		}
		if (module.kind === "service") {
			if (module.lifecycle.includes("restart")) {
				steps.push(lifecycleStep(seq, module, "restart"));
			} else if (module.lifecycle.includes("start")) {
				steps.push(lifecycleStep(seq, module, "start"));
			}
		}
		for (const requirement of module.requirements) {
			if (requirement.kind === "human") {
				steps.push(humanStep(seq, module, requirement.action));
			}
		}
	}
	return steps;
}

function planUninstall(input: PlanInput): DeploymentPlan {
	const modules = input.modules;
	if (modules === undefined || modules.length === 0) {
		throw new PlatformError("INVALID_REQUEST", "uninstall requires modules");
	}
	const core = modules.find((module) => module.installClass === "core");
	if (core !== undefined) {
		throw new PlatformError(
			"CORE_PACKAGE_REQUIRED",
			`core module ${core.moduleRef} cannot be individually uninstalled`,
		);
	}
	const graph = buildDependencyGraph(modules);
	const byRef = new Map(modules.map((module) => [module.moduleRef, module]));
	const seq = createSequencer();
	const steps: DeploymentStep[] = [];
	for (const ref of [...graph.order].reverse()) {
		const module = byRef.get(ref);
		if (module === undefined) continue;
		if (module.lifecycle.includes("uninstall")) {
			steps.push(lifecycleStep(seq, module, "uninstall"));
		}
		steps.push(packageStep(seq, module, "remove", []));
	}
	return assemblePlan({
		intent: "uninstall",
		modules,
		targets: input.targets ?? [],
		config: undefined,
		steps,
		humanActions: [],
		now: input.now ?? new Date(),
	});
}
