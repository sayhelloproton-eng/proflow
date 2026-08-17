import { readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import type { ModuleDescriptor } from "@tomflow/proflow-module-contract";

import { PlatformError } from "../errors.ts";
import type { ModuleSource } from "../modules.ts";

interface PackageManifest {
	name?: unknown;
	bin?: unknown;
	exports?: unknown;
}

export interface PublishedCommand {
	name: string;
	target: string;
}

export interface PublicApiEntry {
	subpath: string;
	target?: string;
}

export interface ModuleDocsView {
	moduleRef: string;
	packageName: string;
	moduleVersion: string;
	kind: ModuleDescriptor["kind"];
	installClass: ModuleDescriptor["installClass"];
	identity: ModuleDescriptor["identity"];
	commands: PublishedCommand[];
	publicApiEntries: PublicApiEntry[];
	provides: ModuleDescriptor["provides"];
	requires: ModuleDescriptor["requires"];
	requirements: ModuleDescriptor["requirements"];
	configSlots: ModuleDescriptor["configSlots"];
	lifecycle: ModuleDescriptor["lifecycle"]["supported"];
	verification: ModuleDescriptor["verification"];
	effects: ModuleDescriptor["effects"];
	documentation: ModuleDescriptor["documentation"];
}

export interface ModuleDocumentContent {
	moduleRef: string;
	packageName: string;
	documentId: string;
	path: string;
	description?: string;
	content: string;
}

function executableName(packageName: string): string {
	return packageName.split("/").pop() ?? packageName;
}

function commandsFrom(
	manifest: PackageManifest,
	packageName: string,
): PublishedCommand[] {
	if (typeof manifest.bin === "string") {
		return [{ name: executableName(packageName), target: manifest.bin }];
	}
	if (typeof manifest.bin !== "object" || manifest.bin === null) return [];
	return Object.entries(manifest.bin as Record<string, unknown>)
		.flatMap(([name, target]) =>
			typeof target === "string" ? [{ name, target }] : [],
		)
		.sort((left, right) => left.name.localeCompare(right.name));
}

function publicApiEntriesFrom(manifest: PackageManifest): PublicApiEntry[] {
	if (typeof manifest.exports === "string") {
		return [{ subpath: ".", target: manifest.exports }];
	}
	if (typeof manifest.exports !== "object" || manifest.exports === null)
		return [];
	return Object.entries(manifest.exports as Record<string, unknown>)
		.filter(([subpath]) => subpath.startsWith("."))
		.map(([subpath, target]) => ({
			subpath,
			...(typeof target === "string" ? { target } : {}),
		}))
		.sort((left, right) => left.subpath.localeCompare(right.subpath));
}

async function packageRootFor(
	workspaceRoot: string,
	source: ModuleSource,
): Promise<string> {
	if (source.type === "workspace") {
		if (source.path === undefined) {
			throw new PlatformError(
				"DESCRIPTOR_INVALID",
				`workspace source missing path for ${source.packageName}`,
			);
		}
		return await realpath(source.path);
	}

	const require = createRequire(
		pathToFileURL(join(workspaceRoot, "package.json")),
	);
	let current: string;
	try {
		current = dirname(
			require.resolve(`${source.packageName}/deployment/descriptor`),
		);
	} catch (error) {
		throw new PlatformError(
			"DESCRIPTOR_INVALID",
			`cannot resolve installed package ${source.packageName}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	for (;;) {
		try {
			const manifest = JSON.parse(
				await readFile(join(current, "package.json"), "utf8"),
			) as PackageManifest;
			if (manifest.name === source.packageName) return await realpath(current);
		} catch {
			// Export maps commonly hide package.json; keep walking from a resolved
			// package-owned descriptor until the package root is found.
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	throw new PlatformError(
		"DESCRIPTOR_INVALID",
		`package root not found for ${source.packageName}`,
	);
}

async function readManifest(
	packageRoot: string,
	packageName: string,
): Promise<PackageManifest> {
	try {
		const manifest = JSON.parse(
			await readFile(join(packageRoot, "package.json"), "utf8"),
		) as PackageManifest;
		if (manifest.name !== packageName) {
			throw new Error(`expected package ${packageName}`);
		}
		return manifest;
	} catch (error) {
		throw new PlatformError(
			"DESCRIPTOR_INVALID",
			`invalid package metadata for ${packageName}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function describeModule(input: {
	workspaceRoot: string;
	source: ModuleSource;
	descriptor: ModuleDescriptor;
}): Promise<ModuleDocsView> {
	const packageRoot = await packageRootFor(input.workspaceRoot, input.source);
	const manifest = await readManifest(
		packageRoot,
		input.descriptor.packageName,
	);
	return {
		moduleRef: input.descriptor.moduleRef,
		packageName: input.descriptor.packageName,
		moduleVersion: input.descriptor.moduleVersion,
		kind: input.descriptor.kind,
		installClass: input.descriptor.installClass,
		identity: input.descriptor.identity,
		commands: commandsFrom(manifest, input.descriptor.packageName),
		publicApiEntries: publicApiEntriesFrom(manifest),
		provides: input.descriptor.provides,
		requires: input.descriptor.requires,
		requirements: input.descriptor.requirements,
		configSlots: input.descriptor.configSlots,
		lifecycle: input.descriptor.lifecycle.supported,
		verification: input.descriptor.verification,
		effects: input.descriptor.effects,
		documentation: input.descriptor.documentation,
	};
}

export async function readModuleDocument(input: {
	workspaceRoot: string;
	source: ModuleSource;
	descriptor: ModuleDescriptor;
	documentId: string;
}): Promise<ModuleDocumentContent> {
	const entry = input.descriptor.documentation.find(
		(candidate) => candidate.id === input.documentId,
	);
	if (entry === undefined) {
		throw new PlatformError(
			"INVALID_REQUEST",
			`document "${input.documentId}" is not declared by ${input.descriptor.moduleRef}`,
		);
	}
	const packageRoot = await packageRootFor(input.workspaceRoot, input.source);
	const root = resolve(packageRoot);
	const target = resolve(root, entry.path);
	if (target === root || !target.startsWith(`${root}${sep}`)) {
		throw new PlatformError(
			"DESCRIPTOR_INVALID",
			`documentation path escapes package root for ${input.descriptor.moduleRef}`,
		);
	}
	try {
		const info = await stat(target);
		if (!info.isFile()) throw new Error("not a file");
		const content = await readFile(target, "utf8");
		return {
			moduleRef: input.descriptor.moduleRef,
			packageName: input.descriptor.packageName,
			documentId: entry.id,
			path: entry.path,
			...(entry.description === undefined
				? {}
				: { description: entry.description }),
			content,
		};
	} catch (error) {
		throw new PlatformError(
			"DESCRIPTOR_INVALID",
			`cannot read document ${entry.id} for ${input.descriptor.moduleRef}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
