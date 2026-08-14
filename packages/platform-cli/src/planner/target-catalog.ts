import {
	type ModuleDescriptor,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";

import { AutoModuleCatalog } from "../discovery/discover.ts";
import { readPackageJson } from "../discovery/workspace.ts";
import { PlatformError } from "../errors.ts";
import type { ModuleCatalog, ModuleSource } from "../modules.ts";

/**
 * A local target catalog resolved from a real target workspace on disk. Every
 * descriptor is loaded from that workspace's actual `deployment/descriptor`
 * artifacts (workspace packages win over declared installed dependencies). It
 * never performs registry/npm "world" discovery and never fabricates a
 * descriptor from a bare targetVersion string.
 */
export interface TargetCatalog {
	root: string;
	descriptors: ModuleDescriptor[];
}

export async function resolveTargetCatalog(
	targetWorkspace: string,
): Promise<TargetCatalog> {
	const catalog = new AutoModuleCatalog(targetWorkspace);
	const sources = await catalog.sources();
	const descriptors: ModuleDescriptor[] = [];
	const seen = new Set<string>();
	for (const source of sources) {
		const descriptor = await loadTargetDescriptor(catalog, source);
		if (seen.has(descriptor.moduleRef)) {
			throw new PlatformError(
				"DUPLICATE_IDENTITY",
				`duplicate moduleRef "${descriptor.moduleRef}" in target workspace ${targetWorkspace}`,
			);
		}
		seen.add(descriptor.moduleRef);
		descriptors.push(descriptor);
	}
	return { root: targetWorkspace, descriptors };
}

async function loadTargetDescriptor(
	catalog: Pick<ModuleCatalog, "loadDescriptor">,
	source: ModuleSource,
): Promise<ModuleDescriptor> {
	let raw: unknown;
	try {
		raw = await catalog.loadDescriptor(source);
	} catch (error) {
		if (error instanceof PlatformError) throw error;
		throw new PlatformError(
			"DESCRIPTOR_INVALID",
			`failed to load target descriptor for ${source.packageName}: ${errorMessage(error)}`,
		);
	}

	let descriptor: ModuleDescriptor;
	try {
		descriptor = parseModuleDescriptor(raw);
	} catch (error) {
		throw new PlatformError(
			"DESCRIPTOR_INVALID",
			`invalid target descriptor for ${source.packageName}: ${errorMessage(error)}`,
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

	return descriptor;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
