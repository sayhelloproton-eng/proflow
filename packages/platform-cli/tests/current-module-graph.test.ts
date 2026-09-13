import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

import type { ResolvedModule } from "../src/contracts.ts";
import { buildDependencyGraph } from "../src/graph/graph.ts";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const packagesRoot = resolve(repositoryRoot, "packages");

async function currentModules(): Promise<ResolvedModule[]> {
	const entries = await readdir(packagesRoot, { withFileTypes: true });
	const modules: ResolvedModule[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const manifestPath = resolve(packagesRoot, entry.name, "proflow.module.json");
		let manifest: Record<string, unknown>;
		try {
			manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
				string,
				unknown
			>;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		modules.push({
			...manifest,
			source: { type: "workspace", path: resolve(packagesRoot, entry.name) },
		} as unknown as ResolvedModule);
	}
	return modules;
}

function edge(
	graph: ReturnType<typeof buildDependencyGraph>,
	from: string,
	to: string,
	contractRef: string,
) {
	return graph.edges.some(
		(item) =>
			item.from === from &&
			item.to === to &&
			item.kind === "capability" &&
			item.contractRef === contractRef,
	);
}

test("W07 current module descriptor graph is acyclic and preserves owner direction", async () => {
	const modules = await currentModules();
	const graph = buildDependencyGraph(modules);
	const byRef = new Map(modules.map((module) => [module.moduleRef, module]));

	for (const required of [
		"task-orchestration",
		"agent-runtime",
		"execution-browser-extension",
		"execution-runtime",
		"platform-host",
		"agent-gateway",
	])
		assert.ok(byRef.has(required), `missing current module descriptor: ${required}`);

	assert.equal(graph.order.length, graph.nodes.length);
	assert.equal(byRef.get("task-orchestration")?.requires.length, 0);
	assert.deepEqual(
		byRef
			.get("agent-runtime")
			?.requires.map((item) => item.contractRef)
			.sort(),
		["task-orchestration"],
	);

	assert.equal(
		edge(
			graph,
			"execution-browser-extension",
			"agent-runtime",
			"agent-runtime",
		),
		true,
	);
	assert.equal(
		edge(
			graph,
			"execution-browser-extension",
			"task-orchestration",
			"task-orchestration",
		),
		true,
	);
	assert.equal(
		graph.edges.some(
			(item) =>
				item.from === "execution-browser-extension" &&
				item.contractRef === "execution",
		),
		false,
	);

	assert.equal(
		edge(
			graph,
			"execution-runtime",
			"execution-browser-extension",
			"execution-browser-executor",
		),
		true,
	);
	assert.equal(
		graph.edges.some(
			(item) =>
				item.from === "execution-runtime" &&
				["task-orchestration", "agent-runtime", "platform-host"].includes(
					item.contractRef ?? "",
				),
		),
		false,
	);

	for (const [to, contractRef] of [
		["execution-browser-extension", "local-tool-bridge"],
		["task-orchestration", "task-orchestration"],
		["agent-runtime", "agent-runtime"],
	] as const)
		assert.equal(edge(graph, "platform-host", to, contractRef), true);
	assert.equal(
		graph.edges.some(
			(item) =>
				item.from === "platform-host" &&
				item.contractRef === "execution",
		),
		false,
	);

	for (const contractRef of [
		"platform-host",
		"task-orchestration",
		"agent-runtime",
		"public-ingress",
	])
		assert.equal(
			graph.edges.some(
				(item) =>
					item.from === "agent-gateway" &&
					item.contractRef === contractRef,
			),
			true,
			contractRef,
		);
});

test("W07 reintroducing agent-runtime -> execution recreates the forbidden owner cycle", async () => {
	const modules = await currentModules();
	const broken = modules.map((module) =>
		module.moduleRef === "agent-runtime"
			? {
					...module,
					requires: [
						...module.requires,
						{
							contractRef: "execution",
							versionRange: ">=1.0.0 <2.0.0",
						},
					],
				}
			: module,
	);
	assert.throws(
		() => buildDependencyGraph(broken),
		(error: unknown) =>
			typeof error === "object" &&
			error !== null &&
			Reflect.get(error, "code") === "DEPENDENCY_CYCLE",
	);
});
