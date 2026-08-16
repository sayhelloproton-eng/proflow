import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { proflowPackageMetadataSchema } from "@tomflow/proflow-module-contract";

import { PlatformError } from "../errors.ts";
import type { ModuleCatalog, ModuleSource } from "../modules.ts";
import { findWorkspaceRoot } from "./workspace.ts";

interface RootPackageJson {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
}

async function readRootPackageJson(root: string): Promise<RootPackageJson> {
	try {
		const raw = await readFile(join(root, "package.json"), "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return {};
		return parsed as RootPackageJson;
	} catch {
		return {};
	}
}

/**
 * Discovers governed modules installed as ordinary npm dependencies of a
 * product workspace. It never scans the global npm cache, queries a registry,
 * or walks `node_modules` — it only inspects the package names explicitly
 * declared in the root `package.json` `dependencies`/`devDependencies`, and
 * only treats a package as a governed Module when both its
 * `deployment/descriptor` and `deployment/adapter` subpath exports actually
 * resolve through Node package resolution.
 */
export class InstalledModuleCatalog implements ModuleCatalog {
	readonly root: string;
	private readonly require: NodeRequire;

	constructor(root?: string) {
		this.root = root ?? findWorkspaceRoot();
		this.require = createRequire(
			pathToFileURL(join(this.root, "package.json")),
		);
	}

	async sources(): Promise<ModuleSource[]> {
		const manifest = await readRootPackageJson(this.root);
		const names = new Set<string>();
		for (const name of Object.keys(manifest.dependencies ?? {})) {
			names.add(name);
		}
		for (const name of Object.keys(manifest.devDependencies ?? {})) {
			names.add(name);
		}
		const sources: ModuleSource[] = [];
		for (const name of [...names].sort()) {
			if (!(await this.isGovernedModule(name))) continue;
			sources.push({ type: "installed", packageName: name });
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

	private async isGovernedModule(packageName: string): Promise<boolean> {
		if (!packageName.startsWith("@tomflow/proflow-")) return false;
		if (
			!this.canResolve(`${packageName}/deployment/descriptor`) ||
			!this.canResolve(`${packageName}/deployment/adapter`)
		) {
			return false;
		}
		const descriptorPath = this.require.resolve(
			`${packageName}/deployment/descriptor`,
		);
		const packageJson = await readInstalledPackageJson(
			descriptorPath,
			packageName,
		);
		if (packageJson === undefined) return false;
		return proflowPackageMetadataSchema.safeParse(packageJson.proflow).success;
	}

	private canResolve(specifier: string): boolean {
		try {
			this.require.resolve(specifier);
			return true;
		} catch {
			return false;
		}
	}

	private async loadModule(
		source: ModuleSource,
		artifact: "descriptor" | "adapter",
	): Promise<unknown> {
		try {
			const resolved = this.require.resolve(
				`${source.packageName}/deployment/${artifact}`,
			);
			return await import(pathToFileURL(resolved).href);
		} catch (error) {
			throw new PlatformError(
				"DESCRIPTOR_INVALID",
				`failed to load ${artifact} for ${source.packageName}: ${errorMessage(error)}`,
			);
		}
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

interface InstalledPackageJson {
	name?: unknown;
	proflow?: unknown;
}

async function readInstalledPackageJson(
	resolvedArtifact: string,
	packageName: string,
): Promise<InstalledPackageJson | undefined> {
	let current = dirname(resolvedArtifact);
	for (;;) {
		try {
			const raw = await readFile(join(current, "package.json"), "utf8");
			const parsed: unknown = JSON.parse(raw);
			if (
				typeof parsed === "object" &&
				parsed !== null &&
				!Array.isArray(parsed) &&
				Reflect.get(parsed, "name") === packageName
			) {
				return parsed as InstalledPackageJson;
			}
		} catch {
			// Keep walking towards the package root. Export maps commonly hide
			// package.json, so resolving the descriptor and walking upward is the
			// stable local-install boundary.
		}
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}
