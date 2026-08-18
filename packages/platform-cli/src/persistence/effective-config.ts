import type { ResolvedModule } from "../contracts.ts";
import type { WorkspacePaths } from "../paths.ts";
import { loadConfig } from "./config.ts";

export async function mergeEffectiveConfig(
	paths: WorkspacePaths,
	modules: readonly ResolvedModule[],
	provided: Record<string, Record<string, string>>,
): Promise<Record<string, Record<string, string>>> {
	const effective: Record<string, Record<string, string>> = {};
	for (const module of modules) {
		const stored = await loadConfig(paths, module.moduleRef);
		if (stored === undefined) continue;
		effective[module.moduleRef] = {
			...stored.publicValues,
			...stored.secretValues,
		};
	}
	for (const [moduleRef, values] of Object.entries(provided)) {
		effective[moduleRef] = {
			...(effective[moduleRef] ?? {}),
			...values,
		};
	}
	return effective;
}
