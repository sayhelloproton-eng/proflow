import { join } from "node:path";
import { readJson, type WorkspacePaths } from "../paths.ts";
import { writeJsonAtomic } from "./atomic.ts";
import { assertSafeFileName } from "./guards.ts";

export interface MaterializedConfig {
	publicValues: Record<string, string>;
	secretValues: Record<string, string>;
}

export interface ModuleConfig {
	moduleRef: string;
	values: Record<string, string>;
	secretRefs: readonly string[];
}

function configFilePath(paths: WorkspacePaths, moduleRef: string): string {
	assertSafeFileName(moduleRef, "moduleRef");
	return join(paths.config, `${moduleRef}.json`);
}

function secretsFilePath(paths: WorkspacePaths, moduleRef: string): string {
	assertSafeFileName(moduleRef, "moduleRef");
	return join(paths.config, `${moduleRef}.secrets.json`);
}

function isStringMap(value: unknown): value is Record<string, string> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	return Object.values(value).every((item) => typeof item === "string");
}

// Secret values are materialized to a separate 0o600 file; non-secret values go
// to the public config file so raw secrets never appear in readable artifacts.
export async function materializeConfig(
	paths: WorkspacePaths,
	config: ModuleConfig,
): Promise<void> {
	const publicValues: Record<string, string> = {};
	const secretValues: Record<string, string> = {};
	for (const [key, value] of Object.entries(config.values)) {
		if (config.secretRefs.includes(key)) {
			secretValues[key] = value;
		} else {
			publicValues[key] = value;
		}
	}
	await writeJsonAtomic(
		configFilePath(paths, config.moduleRef),
		publicValues,
		0o644,
	);
	await writeJsonAtomic(
		secretsFilePath(paths, config.moduleRef),
		secretValues,
		0o600,
	);
}

export async function loadConfig(
	paths: WorkspacePaths,
	moduleRef: string,
): Promise<MaterializedConfig | undefined> {
	const publicRaw = await readJson<unknown>(configFilePath(paths, moduleRef));
	const secretRaw = await readJson<unknown>(secretsFilePath(paths, moduleRef));
	const publicValues = isStringMap(publicRaw) ? publicRaw : undefined;
	const secretValues = isStringMap(secretRaw) ? secretRaw : undefined;
	if (publicValues === undefined && secretValues === undefined)
		return undefined;
	return {
		publicValues: publicValues ?? {},
		secretValues: secretValues ?? {},
	};
}
