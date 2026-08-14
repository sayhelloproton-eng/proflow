import type { ResolvedModule } from "../contracts.ts";
import { PlatformError } from "../errors.ts";
import { versionSatisfies } from "../modules.ts";

export type DependencyEdgeKind = "moduleRef" | "capability";

export interface DependencyEdge {
	from: string;
	to: string;
	kind: DependencyEdgeKind;
	contractRef?: string;
}

export interface DependencyGraph {
	nodes: string[];
	edges: DependencyEdge[];
	order: string[];
}

export interface GraphOptions {
	config?: Record<string, Record<string, string>>;
}

export class ModuleRefUnresolvedError extends Error {
	readonly code = "MODULE_REF_UNRESOLVED" as const;
	readonly from: string;
	readonly target: string;

	constructor(from: string, target: string, message: string) {
		super(message);
		this.from = from;
		this.target = target;
		this.name = "ModuleRefUnresolvedError";
	}
}

function compareRef(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function buildDependencyGraph(
	modules: readonly ResolvedModule[],
	options: GraphOptions = {},
): DependencyGraph {
	const nodes = [...new Set(modules.map((module) => module.moduleRef))].sort(
		compareRef,
	);
	const nodeSet = new Set(nodes);

	const providersByContract = new Map<
		string,
		{ moduleRef: string; version: string }[]
	>();
	for (const module of modules) {
		for (const provide of module.provides) {
			const list = providersByContract.get(provide.contractRef) ?? [];
			list.push({ moduleRef: module.moduleRef, version: provide.version });
			providersByContract.set(provide.contractRef, list);
		}
	}

	const edges: DependencyEdge[] = [];
	const edgeSet = new Set<string>();
	const addEdge = (
		from: string,
		to: string,
		kind: DependencyEdgeKind,
		contractRef?: string,
	): void => {
		const key = `${kind}|${from}|${to}|${contractRef ?? ""}`;
		if (edgeSet.has(key)) return;
		edgeSet.add(key);
		const edge: DependencyEdge = { from, to, kind };
		if (contractRef !== undefined) edge.contractRef = contractRef;
		edges.push(edge);
	};

	const sorted = [...modules].sort((a, b) =>
		compareRef(a.moduleRef, b.moduleRef),
	);

	for (const module of sorted) {
		for (const slot of module.configSlots) {
			if (slot.type !== "moduleRef") continue;
			const effective =
				options.config?.[module.moduleRef]?.[slot.key] ?? slot.default;
			if (typeof effective !== "string") continue;
			if (!nodeSet.has(effective)) {
				throw new ModuleRefUnresolvedError(
					module.moduleRef,
					effective,
					`moduleRef binding ${slot.key}=${effective} for ${module.moduleRef} does not resolve to a selected module`,
				);
			}
			addEdge(module.moduleRef, effective, "moduleRef");
		}

		for (const requirement of module.requires) {
			const candidates = providersByContract.get(requirement.contractRef) ?? [];
			const matching = candidates
				.filter((provider) =>
					versionSatisfies(provider.version, requirement.versionRange),
				)
				.sort((a, b) => compareRef(a.moduleRef, b.moduleRef));
			if (matching.length > 0) {
				for (const provider of matching) {
					addEdge(
						module.moduleRef,
						provider.moduleRef,
						"capability",
						requirement.contractRef,
					);
				}
				continue;
			}
			if (candidates.length > 0) {
				throw new PlatformError(
					"DEPENDENCY_INCOMPATIBLE",
					`${module.moduleRef} requires ${requirement.contractRef} ${requirement.versionRange} but no provider satisfies it`,
				);
			}
			if (requirement.optional !== true) {
				throw new PlatformError(
					"DEPENDENCY_UNRESOLVED",
					`${module.moduleRef} requires ${requirement.contractRef} ${requirement.versionRange} but no module provides it`,
				);
			}
		}
	}

	edges.sort((a, b) => {
		const byFrom = compareRef(a.from, b.from);
		if (byFrom !== 0) return byFrom;
		const byTo = compareRef(a.to, b.to);
		if (byTo !== 0) return byTo;
		return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
	});

	const order = computeOrder(nodes, edges);

	return { nodes, edges, order };
}

function computeOrder(
	nodes: readonly string[],
	edges: readonly DependencyEdge[],
): string[] {
	const deps = new Map<string, Set<string>>();
	for (const node of nodes) deps.set(node, new Set());
	for (const edge of edges) {
		const set = deps.get(edge.from);
		if (set === undefined) continue;
		set.add(edge.to);
	}

	const depth = new Map<string, number>();
	const state = new Map<string, "visiting" | "done">();

	const visit = (node: string): number => {
		const current = state.get(node);
		if (current === "done") return depth.get(node) ?? 0;
		if (current === "visiting") {
			throw new PlatformError(
				"DEPENDENCY_CYCLE",
				`dependency cycle detected at ${node}`,
			);
		}
		state.set(node, "visiting");
		let maxDepth = 0;
		const nodeDeps = [...(deps.get(node) ?? new Set<string>())].sort(
			compareRef,
		);
		for (const dependency of nodeDeps) {
			const dependencyDepth = visit(dependency);
			if (dependencyDepth + 1 > maxDepth) maxDepth = dependencyDepth + 1;
		}
		state.set(node, "done");
		depth.set(node, maxDepth);
		return maxDepth;
	};

	for (const node of nodes) visit(node);

	const layers = new Map<number, string[]>();
	for (const node of nodes) {
		const nodeDepth = depth.get(node) ?? 0;
		const layer = layers.get(nodeDepth) ?? [];
		layer.push(node);
		layers.set(nodeDepth, layer);
	}
	const depths = [...layers.keys()].sort((a, b) => a - b);
	const order: string[] = [];
	for (const nodeDepth of depths) {
		const layer = layers.get(nodeDepth) ?? [];
		layer.sort(compareRef);
		order.push(...layer);
	}
	return order;
}
