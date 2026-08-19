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
