import type { HumanAction } from "@tomflow/proflow-module-contract";

import type { DeploymentStep, ResolvedModule } from "../contracts.ts";
import type { DependencyGraph } from "../graph/graph.ts";

export const CheckStrategy = {
	packageInstalled: "package:installed",
	configMaterialized: "config:materialized",
	lifecycleRunning: "lifecycle:running",
	lifecycleStopped: "lifecycle:stopped",
	externalResourceConfigured: "external-resource:configured",
	humanVerified: "human:verified",
	verifyChecksPass: "verify:checks-pass",
	migrateComplete: "migrate:complete",
} as const;

export const ExecuteStrategy = {
	packageInstall: "package:install",
	packageUpgrade: "package:upgrade",
	configWrite: "config:write",
	lifecycleStart: "lifecycle:start",
	lifecycleStop: "lifecycle:stop",
	lifecycleRestart: "lifecycle:restart",
	lifecycleMigrate: "lifecycle:migrate",
	externalResourceConfigure: "external-resource:configure",
} as const;

export interface StepSequencer {
	next(kind: string, moduleRef: string): string;
}

export function createSequencer(): StepSequencer {
	let counter = 0;
	return {
		next(kind, moduleRef) {
			counter += 1;
			return `step-${String(counter).padStart(3, "0")}-${kind}-${moduleRef}`;
		},
	};
}

function compareRef(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function upstreamDependencies(
	graph: DependencyGraph,
): Map<string, string[]> {
	const map = new Map<string, string[]>();
	for (const edge of graph.edges) {
		const list = map.get(edge.from) ?? [];
		list.push(edge.to);
		map.set(edge.from, list);
	}
	for (const list of map.values()) list.sort(compareRef);
	return map;
}

export function packageStep(
	seq: StepSequencer,
	module: ResolvedModule,
	verb: "install" | "upgrade",
	dependencies: readonly string[],
): DeploymentStep {
	return {
		stepRef: seq.next("package", module.moduleRef),
		moduleRef: module.moduleRef,
		kind: "package",
		preconditions: dependencies.map(
			(dependency) => `dependency ${dependency} installed and verified`,
		),
		expectedEffect: `module package ${module.packageName}@${module.moduleVersion} ${
			verb === "install" ? "installed" : "upgraded"
		}`,
		checkStrategy: CheckStrategy.packageInstalled,
		executeStrategy:
			verb === "install"
				? ExecuteStrategy.packageInstall
				: ExecuteStrategy.packageUpgrade,
		postcondition: `installed version ${module.moduleVersion} satisfies ${module.moduleRef}`,
	};
}

export function configStep(
	seq: StepSequencer,
	module: ResolvedModule,
): DeploymentStep {
	return {
		stepRef: seq.next("config", module.moduleRef),
		moduleRef: module.moduleRef,
		kind: "config",
		preconditions: [`module package ${module.packageName} installed`],
		expectedEffect: `configuration materialized for ${module.moduleRef}`,
		checkStrategy: CheckStrategy.configMaterialized,
		executeStrategy: ExecuteStrategy.configWrite,
		postcondition: `all required config slots materialized for ${module.moduleRef}`,
	};
}

export function externalResourceStep(
	seq: StepSequencer,
	module: ResolvedModule,
): DeploymentStep {
	return {
		stepRef: seq.next("external-resource", module.moduleRef),
		moduleRef: module.moduleRef,
		kind: "external-resource",
		preconditions: [
			`module package ${module.packageName} installed`,
			`configuration materialized for ${module.moduleRef}`,
		],
		expectedEffect: `external resource ${module.moduleRef} configured`,
		checkStrategy: CheckStrategy.externalResourceConfigured,
		executeStrategy: ExecuteStrategy.externalResourceConfigure,
		postcondition: `external resource ${module.moduleRef} configured and reachable`,
	};
}

export function humanStep(
	seq: StepSequencer,
	module: ResolvedModule,
	action: string,
): DeploymentStep {
	return {
		stepRef: seq.next("human", module.moduleRef),
		moduleRef: module.moduleRef,
		kind: "human",
		preconditions: [],
		expectedEffect: `human action completed: ${action}`,
		checkStrategy: CheckStrategy.humanVerified,
		postcondition: `human action "${action}" verified`,
	};
}

export function lifecycleStep(
	seq: StepSequencer,
	module: ResolvedModule,
	action: "start" | "stop" | "restart" | "migrate",
): DeploymentStep {
	const executeStrategy =
		action === "start"
			? ExecuteStrategy.lifecycleStart
			: action === "stop"
				? ExecuteStrategy.lifecycleStop
				: action === "restart"
					? ExecuteStrategy.lifecycleRestart
					: ExecuteStrategy.lifecycleMigrate;
	const checkStrategy =
		action === "migrate"
			? CheckStrategy.migrateComplete
			: action === "stop"
				? CheckStrategy.lifecycleStopped
				: CheckStrategy.lifecycleRunning;
	const settled =
		action === "start" || action === "restart"
			? "running"
			: action === "stop"
				? "stopped"
				: "migrated";
	return {
		stepRef: seq.next("lifecycle", module.moduleRef),
		moduleRef: module.moduleRef,
		kind: "lifecycle",
		preconditions: [],
		expectedEffect: `lifecycle ${action} completed for ${module.moduleRef}`,
		checkStrategy,
		executeStrategy,
		postcondition: `module ${module.moduleRef} is ${settled}`,
	};
}

export function humanActionsFromModules(
	modules: readonly ResolvedModule[],
): HumanAction[] {
	const actions: HumanAction[] = [];
	const seen = new Set<string>();
	for (const module of modules) {
		for (const requirement of module.requirements) {
			if (requirement.kind !== "human") continue;
			if (seen.has(requirement.action)) continue;
			seen.add(requirement.action);
			actions.push({
				action: requirement.action,
				description: `human requirement for ${module.moduleRef}`,
			});
		}
	}
	return actions;
}
