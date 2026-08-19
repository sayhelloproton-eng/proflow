import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PlatformError } from "../errors.ts";
import type { WorkspacePaths } from "../paths.ts";
import { assertSafeFileName } from "./guards.ts";

export interface MaterializedConfig {
	publicValues: Record<string, string>;
	secretValues: Record<string, string>;
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

function isMissingFile(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT"
	);
}

async function readConfigValues(
	file: string,
	moduleRef: string,
	kind: "public" | "secret",
): Promise<Record<string, string> | undefined> {
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch (error) {
		if (isMissingFile(error)) return undefined;
		throw new PlatformError(
			"CONFIG_INVALID",
			`cannot read ${kind} config for ${moduleRef}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!isStringMap(parsed))
			throw new TypeError("expected a JSON object whose values are strings");
		return parsed;
	} catch (error) {
		throw new PlatformError(
			"CONFIG_INVALID",
			`${kind} config for ${moduleRef} is invalid JSON/config: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function loadConfig(
	paths: WorkspacePaths,
	moduleRef: string,
): Promise<MaterializedConfig | undefined> {
	const publicValues = await readConfigValues(
		configFilePath(paths, moduleRef),
		moduleRef,
		"public",
	);
	const secretValues = await readConfigValues(
		secretsFilePath(paths, moduleRef),
		moduleRef,
		"secret",
	);
	if (publicValues === undefined && secretValues === undefined)
		return undefined;
	return {
		publicValues: publicValues ?? {},
		secretValues: secretValues ?? {},
	};
}
