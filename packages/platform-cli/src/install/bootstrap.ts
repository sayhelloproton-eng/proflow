import type { ResolvedModule } from "../contracts.ts";
import { PlatformError } from "../errors.ts";
import {
	PRO_FLOW_PACKAGE_PREFIX,
	type RegistryModuleCandidate,
} from "../registry/index.ts";

/**
 * Registry bootstrap targets intentionally carry only facts available before
 * installation. They are package-plan placeholders, never substitutes for the
 * package-owned Module Descriptor that is loaded after installation.
 */
export function registryCandidateToBootstrapModule(
	candidate: RegistryModuleCandidate,
): ResolvedModule {
	if (!candidate.packageName.startsWith(PRO_FLOW_PACKAGE_PREFIX)) {
		throw new PlatformError(
			"PACKAGE_NOT_PROFLOW",
			`package ${candidate.packageName} is outside ${PRO_FLOW_PACKAGE_PREFIX}*`,
		);
	}
	const moduleRef = candidate.packageName.slice(PRO_FLOW_PACKAGE_PREFIX.length);
	if (moduleRef === "") {
		throw new PlatformError(
			"REGISTRY_RESPONSE_INVALID",
			`cannot derive moduleRef from ${candidate.packageName}`,
		);
	}
	return {
		moduleRef,
		packageName: candidate.packageName,
		moduleVersion: candidate.moduleVersion,
		kind: "registry-package",
		installClass: candidate.installClass,
		provides: [],
		requires: [],
		requirements: [],
		configSlots: [],
		lifecycle: [],
		verification: { checks: [] },
		effects: [],
		documentation: [],
		source: { type: "registry" },
	};
}

export function selectBootstrapModules(
	candidates: readonly RegistryModuleCandidate[],
	explicitPackageName?: string,
): ResolvedModule[] {
	const byPackage = new Map(
		candidates.map((candidate) => [candidate.packageName, candidate]),
	);
	const roots =
		explicitPackageName === undefined
			? candidates.filter((candidate) => candidate.installClass === "core")
			: candidates.filter(
					(candidate) => candidate.packageName === explicitPackageName,
				);
	if (roots.length === 0) {
		throw new PlatformError(
			explicitPackageName === undefined
				? "REGISTRY_RESPONSE_INVALID"
				: "PACKAGE_NOT_FOUND",
			explicitPackageName === undefined
				? "Registry discovery returned no installable core ProFlow packages"
				: `no installable ProFlow package found for ${explicitPackageName}`,
		);
	}

	const selected = new Map<string, RegistryModuleCandidate>();
	const queue = [...roots];
	while (queue.length > 0) {
		const candidate = queue.shift();
		if (!candidate) continue;
		if (selected.has(candidate.packageName)) continue;
		selected.set(candidate.packageName, candidate);
		for (const dependencyName of candidate.installRequires) {
			const dependency = byPackage.get(dependencyName);
			if (dependency === undefined) {
				throw new PlatformError(
					"DEPENDENCY_UNRESOLVED",
					`Registry bootstrap dependency ${dependencyName} required by ${candidate.packageName} was not discovered`,
				);
			}
			queue.push(dependency);
		}
	}
	return [...selected.values()]
		.sort((a, b) => a.packageName.localeCompare(b.packageName))
		.map(registryCandidateToBootstrapModule);
}

export function selectUpgradeBootstrapModules(
	currentModules: readonly ResolvedModule[],
	candidates: readonly RegistryModuleCandidate[],
): ResolvedModule[] {
	const byPackage = new Map(
		candidates.map((candidate) => [candidate.packageName, candidate]),
	);
	const targets: ResolvedModule[] = [];
	for (const current of currentModules) {
		const candidate = byPackage.get(current.packageName);
		if (candidate === undefined) {
			throw new PlatformError(
				"PACKAGE_NOT_FOUND",
				`no installable Registry target found for managed package ${current.packageName}`,
			);
		}
		if (candidate.moduleVersion === current.moduleVersion) continue;
		targets.push(registryCandidateToBootstrapModule(candidate));
	}
	return targets;
}
