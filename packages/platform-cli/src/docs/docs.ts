import { readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import type { ModuleDescriptor } from "@tomflow/proflow-module-contract";
import { PlatformError } from "../errors.ts";
import type { ModuleSource } from "../modules.ts";

interface PackageManifest {
	name?: unknown;
}
export type ModuleDocumentId = keyof ModuleDescriptor["documentation"];
export interface ModuleDocumentContent {
	moduleRef: string;
	packageName: string;
	documentId: ModuleDocumentId;
	path: string;
	content: string;
}
async function packageRootFor(
	workspaceRoot: string,
	source: ModuleSource,
): Promise<string> {
	if (source.type === "workspace") {
		if (source.path === undefined)
			throw new PlatformError(
				"DESCRIPTOR_INVALID",
				`workspace source missing path for ${source.packageName}`,
			);
		return realpath(source.path);
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
			if (manifest.name === source.packageName) return realpath(current);
		} catch {}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	throw new PlatformError(
		"DESCRIPTOR_INVALID",
		`package root not found for ${source.packageName}`,
	);
}
export async function readModuleDocument(input: {
	workspaceRoot: string;
	source: ModuleSource;
	descriptor: ModuleDescriptor;
	documentId: ModuleDocumentId;
}): Promise<ModuleDocumentContent> {
	const path = input.descriptor.documentation[input.documentId];
	const packageRoot = await packageRootFor(input.workspaceRoot, input.source);
	const root = resolve(packageRoot);
	const target = resolve(root, path);
	if (target === root || !target.startsWith(`${root}${sep}`))
		throw new PlatformError(
			"DESCRIPTOR_INVALID",
			`documentation path escapes package root for ${input.descriptor.moduleRef}`,
		);
	try {
		const info = await stat(target);
		if (!info.isFile()) throw new Error("not a file");
		return {
			moduleRef: input.descriptor.moduleRef,
			packageName: input.descriptor.packageName,
			documentId: input.documentId,
			path,
			content: await readFile(target, "utf8"),
		};
	} catch (error) {
		throw new PlatformError(
			"DESCRIPTOR_INVALID",
			`cannot read document ${input.documentId} for ${input.descriptor.moduleRef}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
