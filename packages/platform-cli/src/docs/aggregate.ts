import {
	type ConfigSlot,
	type ModuleProvide,
	type ModuleRequire,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";

import type { ResolvedModule } from "../contracts.ts";
import type { ModuleCatalog, ModuleSource } from "../modules.ts";
import { readModuleDocument } from "./docs.ts";

export interface AggregatedDocument {
	id: string;
	path: string;
	description?: string;
	content: string;
}

export interface AggregatedModuleDocs {
	moduleRef: string;
	version: string;
	provides: ModuleProvide[];
	requires: ModuleRequire[];
	configSlots: ConfigSlot[];
	documents: AggregatedDocument[];
}

function sourceOf(module: ResolvedModule): ModuleSource {
	return module.source.path === undefined
		? { type: module.source.type, packageName: module.packageName }
		: {
				type: module.source.type,
				packageName: module.packageName,
				path: module.source.path,
			};
}

export async function aggregateModuleDocs(
	workspaceRoot: string,
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
): Promise<AggregatedModuleDocs[]> {
	const output: AggregatedModuleDocs[] = [];
	for (const module of [...modules].sort((a, b) =>
		a.moduleRef.localeCompare(b.moduleRef),
	)) {
		const source = sourceOf(module);
		const descriptor = parseModuleDescriptor(
			await catalog.loadDescriptor(source),
		);
		const documents: AggregatedDocument[] = [];
		for (const entry of descriptor.documentation) {
			const document = await readModuleDocument({
				workspaceRoot,
				source,
				descriptor,
				documentId: entry.id,
			});
			documents.push({
				id: document.documentId,
				path: document.path,
				...(document.description === undefined
					? {}
					: { description: document.description }),
				content: document.content,
			});
		}
		output.push({
			moduleRef: module.moduleRef,
			version: module.moduleVersion,
			provides: [...descriptor.provides],
			requires: [...descriptor.requires],
			configSlots: [...descriptor.configSlots],
			documents,
		});
	}
	return output;
}
