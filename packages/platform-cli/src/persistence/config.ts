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

// secretRef config values are opaque reference identities (e.g.
// `secret://model-provider/default`), not raw secrets, so they materialize to
// the public config file verbatim. A raw secret would go to the separate 0o600
// secrets file — but v1 planning produces no raw secrets, so it stays empty and
// must never hold a secretRef reference.
export async function materializeConfig(
	paths: WorkspacePaths,
	config: ModuleConfig,
): Promise<void> {
	const publicValues: Record<string, string> = {};
	for (const [key, value] of Object.entries(config.values)) {
		publicValues[key] = value;
	}
	await writeJsonAtomic(
		configFilePath(paths, config.moduleRef),
		publicValues,
		0o644,
	);
	await writeJsonAtomic(secretsFilePath(paths, config.moduleRef), {}, 0o600);
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
