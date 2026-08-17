import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { buildDependencyGraph } from "../packages/platform-cli/src/graph/graph.ts";

const repositoryRoot = process.cwd();
const packagesRoot = join(repositoryRoot, "packages");
const entries = await readdir(packagesRoot, { withFileTypes: true });
const descriptors = [];
const packages = new Map();

for (const entry of entries) {
	if (!entry.isDirectory()) continue;
	const packageDirectory = join(packagesRoot, entry.name);
	const packageJson = JSON.parse(
		await readFile(join(packageDirectory, "package.json"), "utf8"),
	);
	if (
		typeof packageJson.name !== "string" ||
		!packageJson.name.startsWith("@tomflow/proflow-")
	) {
		continue;
	}
	const descriptorUrl = pathToFileURL(
		join(packageDirectory, "deployment/descriptor.ts"),
	);
	descriptorUrl.searchParams.set("graphCheck", `${Date.now()}-${entry.name}`);
	const loaded = await import(descriptorUrl.href);
	if (typeof loaded.descriptor !== "object" || loaded.descriptor === null) {
		throw new TypeError(`${packageJson.name} exposes no descriptor object`);
	}
	descriptors.push(loaded.descriptor);
	packages.set(loaded.descriptor.moduleRef, packageJson);
}

try {
	const graph = buildDependencyGraph(descriptors);
	const byPackageName = new Map(
		[...packages.entries()].map(([moduleRef, metadata]) => [
			metadata.name,
			moduleRef,
		]),
	);
	const edgesByConsumer = new Map();
	for (const edge of graph.edges) {
		const list = edgesByConsumer.get(edge.from) ?? [];
		list.push(edge.to);
		edgesByConsumer.set(edge.from, list);
	}
	const closureErrors = [];
	for (const [moduleRef, metadata] of packages) {
		const installRequires = metadata.proflow?.installRequires;
		if (!Array.isArray(installRequires)) continue;
		const closure = new Set();
		const queue = [...installRequires];
		while (queue.length > 0) {
			const packageName = queue.shift();
			if (typeof packageName !== "string" || closure.has(packageName)) continue;
			closure.add(packageName);
			const dependencyRef = byPackageName.get(packageName);
			if (dependencyRef === undefined) continue;
			const dependencyMetadata = packages.get(dependencyRef);
			const nested = dependencyMetadata?.proflow?.installRequires;
			if (Array.isArray(nested)) queue.push(...nested);
		}
		for (const providerRef of edgesByConsumer.get(moduleRef) ?? []) {
			const providerPackage = packages.get(providerRef)?.name;
			if (
				typeof providerPackage === "string" &&
				!closure.has(providerPackage)
			) {
				closureErrors.push(
					`${moduleRef} requires provider ${providerRef} (${providerPackage}) outside installRequires closure`,
				);
			}
		}
	}
	if (closureErrors.length > 0) {
		throw new Error(closureErrors.join("; "));
	}
	process.stdout.write(
		`${JSON.stringify({
			status: "PASS",
			moduleCount: descriptors.length,
			edgeCount: graph.edges.length,
			order: graph.order,
		})}\n`,
	);
} catch (error) {
	const code =
		typeof error === "object" && error !== null && "code" in error
			? Reflect.get(error, "code")
			: "GRAPH_INVALID";
	const message = error instanceof Error ? error.message : String(error);
	process.stdout.write(
		`${JSON.stringify({ status: "FAIL", code, message })}\n`,
	);
	process.exitCode = 1;
}
