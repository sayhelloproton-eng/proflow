import {
	type ModuleDescriptor,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";

import type { ResolvedModule } from "../contracts.ts";
import { PlatformError } from "../errors.ts";
import type { ModuleCatalog, ModuleSource } from "../modules.ts";
import { WorkspaceModuleCatalog } from "./catalog.ts";
import { readPackageJson } from "./workspace.ts";

export interface DiscoverOptions {
	workspaceRoot?: string;
	catalog?: ModuleCatalog;
	sources?: ModuleSource[];
}

export async function discoverModules(
	options: DiscoverOptions = {},
): Promise<ResolvedModule[]> {
	const catalog =
		options.catalog ?? new WorkspaceModuleCatalog(options.workspaceRoot);
	const sources = options.sources ?? (await catalog.sources());
	return resolveModules(catalog, sources);
}

export async function resolveModules(
	catalog: Pick<ModuleCatalog, "loadDescriptor">,
	sources: readonly ModuleSource[],
): Promise<ResolvedModule[]> {
	const modules: ResolvedModule[] = [];
	for (const source of sources) {
		modules.push(await resolveModule(catalog, source));
	}
	enforceIdentityInvariants(modules);
	return modules;
}

async function resolveModule(
	catalog: Pick<ModuleCatalog, "loadDescriptor">,
	source: ModuleSource,
): Promise<ResolvedModule> {
	let raw: unknown;
	try {
		raw = await catalog.loadDescriptor(source);
	} catch (error) {
		if (error instanceof PlatformError) throw error;
		throw new PlatformError(
			"DESCRIPTOR_INVALID",
			`failed to load descriptor for ${source.packageName}: ${errorMessage(error)}`,
		);
	}

	let descriptor: ModuleDescriptor;
	try {
		descriptor = parseModuleDescriptor(raw);
	} catch (error) {
		throw new PlatformError(
			"DESCRIPTOR_INVALID",
			`invalid descriptor for ${source.packageName}: ${errorMessage(error)}`,
		);
	}

	if (source.type === "workspace" && source.path !== undefined) {
		const packageJson = await readPackageJson(source.path);
		if (
			packageJson.version !== undefined &&
			packageJson.version !== descriptor.moduleVersion
		) {
			throw new PlatformError(
				"DESCRIPTOR_INVALID",
				`moduleVersion ${descriptor.moduleVersion} does not match package.json version ${packageJson.version} for ${descriptor.moduleRef}`,
			);
		}
	}

	return toResolvedModule(descriptor, source);
}

function toResolvedModule(
	descriptor: ModuleDescriptor,
	source: ModuleSource,
): ResolvedModule {
	const resolvedSource: ResolvedModule["source"] =
		source.path === undefined
			? { type: source.type }
			: { type: source.type, path: source.path };
	return {
		moduleRef: descriptor.moduleRef,
		packageName: descriptor.packageName,
		moduleVersion: descriptor.moduleVersion,
		kind: descriptor.kind,
		provides: descriptor.provides,
		requires: descriptor.requires,
		requirements: descriptor.requirements,
		configSlots: descriptor.configSlots,
		lifecycle: descriptor.lifecycle.supported,
		verification: descriptor.verification,
		effects: descriptor.effects,
		source: resolvedSource,
	};
}

function enforceIdentityInvariants(modules: readonly ResolvedModule[]): void {
	const byRef = new Map<string, string>();
	const byPackage = new Map<string, string>();
	for (const module of modules) {
		const existingRef = byRef.get(module.moduleRef);
		if (existingRef !== undefined) {
			throw new PlatformError(
				"DUPLICATE_IDENTITY",
				`duplicate moduleRef "${module.moduleRef}" (${existingRef} and ${module.packageName})`,
			);
		}
		const existingPackage = byPackage.get(module.packageName);
		if (existingPackage !== undefined) {
			throw new PlatformError(
				"DUPLICATE_IDENTITY",
				`duplicate packageName "${module.packageName}" (${existingPackage} and ${module.moduleRef})`,
			);
		}
		byRef.set(module.moduleRef, module.packageName);
		byPackage.set(module.packageName, module.moduleRef);
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
