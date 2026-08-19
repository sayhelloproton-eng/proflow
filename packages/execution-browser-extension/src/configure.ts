#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { materializeProductionConfig } from "../deployment/adapter.ts";

function workspaceFromArgs(args: string[]): string {
	if (args[0] !== "materialize-config") {
		throw new Error(
			"Usage: proflow-execution-browser-extension materialize-config [--workspace /absolute/path]",
		);
	}
	const workspaceIndex = args.indexOf("--workspace");
	if (workspaceIndex < 0) return process.cwd();
	const value = args[workspaceIndex + 1];
	if (!value || args.length !== 3) {
		throw new Error(
			"Usage: proflow-execution-browser-extension materialize-config [--workspace /absolute/path]",
		);
	}
	return resolve(value);
}

export async function materializeBrowserExtensionConfig(
	workspaceRoot: string,
): Promise<{ loadDir: string }> {
	const configPath = resolve(
		workspaceRoot,
		".proflow",
		"config",
		"execution-browser-extension.json",
	);
	const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"));
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("execution-browser-extension config must be a JSON object");
	}
	const config = Object.fromEntries(
		Object.entries(parsed).map(([key, value]) => {
			if (typeof value !== "string") {
				throw new Error(`browser extension config ${key} must be a string`);
			}
			return [key, value];
		}),
	);
	return materializeProductionConfig({
		moduleRef: "execution-browser-extension",
		config,
		workspaceRoot,
	});
}

async function main(): Promise<void> {
	const workspaceRoot = workspaceFromArgs(process.argv.slice(2));
	const result = await materializeBrowserExtensionConfig(workspaceRoot);
	process.stdout.write(
		`${JSON.stringify({ status: "MATERIALIZED", ...result })}\n`,
	);
}

if (import.meta.main) await main();
