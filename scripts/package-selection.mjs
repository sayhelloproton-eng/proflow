import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const repositoryRoot = resolve(import.meta.dirname, "..");
export const packagesRoot = join(repositoryRoot, "packages");

export function listWorkspacePackages() {
	return readdirSync(packagesRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => {
			const directory = join(packagesRoot, entry.name);
			const packageJsonPath = join(directory, "package.json");
			if (!existsSync(packageJsonPath)) return null;
			const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
			return { dirName: entry.name, directory, manifest, name: manifest.name };
		})
		.filter(Boolean)
		.sort((left, right) => left.dirName.localeCompare(right.dirName));
}

export function resolveRequestedPackages(requested, usage) {
	if (requested.length === 0) {
		console.error(usage);
		process.exit(2);
	}
	const packages = listWorkspacePackages();
	const resolved = [];
	for (const request of requested) {
		const pkg = packages.find(
			(candidate) =>
				candidate.dirName === request || candidate.name === request,
		);
		if (!pkg) {
			console.error(`Unknown package: ${request}`);
			process.exit(2);
		}
		if (!resolved.some((candidate) => candidate.directory === pkg.directory))
			resolved.push(pkg);
	}
	return resolved;
}
