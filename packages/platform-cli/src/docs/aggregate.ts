import {
	type ConfigSlot,
	type ModuleProvide,
	type ModuleRequire,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";
import type { ResolvedModule } from "../contracts.ts";
import type { ModuleCatalog, ModuleSource } from "../modules.ts";
import { type ModuleDocumentId, readModuleDocument } from "./docs.ts";

export interface AggregatedDocument {
	id: ModuleDocumentId;
	path: string;
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
		for (const id of ["docs", "setup"] as const) {
			const document = await readModuleDocument({
				workspaceRoot,
				source,
				descriptor,
				documentId: id,
			});
			documents.push({ id, path: document.path, content: document.content });
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
