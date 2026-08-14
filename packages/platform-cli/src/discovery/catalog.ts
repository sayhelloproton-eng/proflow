import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { PlatformError } from "../errors.ts";
import type { ModuleCatalog, ModuleSource } from "../modules.ts";
import {
	expandPackageDirs,
	findWorkspaceRoot,
	hasDeploymentArtifacts,
	readPackageJson,
	readWorkspaceGlobs,
} from "./workspace.ts";

export class WorkspaceModuleCatalog implements ModuleCatalog {
	readonly root: string;

	constructor(root?: string) {
		this.root = root ?? findWorkspaceRoot();
	}

	async sources(): Promise<ModuleSource[]> {
		const globs = await readWorkspaceGlobs(this.root);
		const directories = await expandPackageDirs(this.root, globs);
		const sources: ModuleSource[] = [];
		for (const directory of directories) {
			if (!hasDeploymentArtifacts(directory)) continue;
			const packageJson = await readPackageJson(directory);
			if (packageJson.name === undefined) continue;
			sources.push({
				type: "workspace",
				packageName: packageJson.name,
				path: directory,
			});
		}
		return sources;
	}

	async loadDescriptor(source: ModuleSource): Promise<unknown> {
		const namespace = await this.loadModule(source, "descriptor");
		const descriptor = (namespace as { descriptor?: unknown }).descriptor;
		if (descriptor === undefined) {
			throw new PlatformError(
				"DESCRIPTOR_INVALID",
				`deployment descriptor export missing for ${source.packageName}`,
			);
		}
		return descriptor;
	}

	async loadAdapter(source: ModuleSource): Promise<unknown> {
		return this.loadModule(source, "adapter");
	}

	private async loadModule(
		source: ModuleSource,
		artifact: "descriptor" | "adapter",
	): Promise<unknown> {
		let url: string;
		try {
			url = this.resolveUrl(source, artifact);
			const namespace: unknown = await import(url);
			return namespace;
		} catch (error) {
			throw new PlatformError(
				"DESCRIPTOR_INVALID",
				`failed to load ${artifact} for ${source.packageName}: ${errorMessage(error)}`,
			);
		}
	}

	private resolveUrl(
		source: ModuleSource,
		artifact: "descriptor" | "adapter",
	): string {
		if (source.type === "workspace") {
			if (source.path === undefined) {
				throw new PlatformError(
					"DESCRIPTOR_INVALID",
					`workspace source missing path for ${source.packageName}`,
				);
			}
			return pathToFileURL(join(source.path, "deployment", `${artifact}.ts`))
				.href;
		}
		return import.meta.resolve(`${source.packageName}/deployment/${artifact}`);
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
