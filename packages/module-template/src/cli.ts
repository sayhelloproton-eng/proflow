#!/usr/bin/env node

import { materializeModule } from "./index.ts";

interface ParsedCreateArgs {
	targetDirectory: string;
	moduleRef: string;
	packageName: string;
	kind:
		| "library"
		| "service"
		| "cli"
		| "browser-extension"
		| "agent-package"
		| "external-resource";
	domain: string;
	summary: string;
	moduleVersion?: string;
	platformCompatibility?: string;
}

function required(values: Map<string, string>, key: string): string {
	const value = values.get(key);
	if (value === undefined || value.trim() === "") {
		throw new TypeError(`missing required option ${key}`);
	}
	return value;
}

function parseCreateArgs(argv: readonly string[]): ParsedCreateArgs {
	if (argv[0] !== "create") {
		throw new TypeError('expected command "create"');
	}
	const values = new Map<string, string>();
	for (let index = 1; index < argv.length; index += 2) {
		const key = argv[index];
		const value = argv[index + 1];
		if (key === undefined || !key.startsWith("--") || value === undefined) {
			throw new TypeError(`invalid option near ${key ?? "<end>"}`);
		}
		values.set(key, value);
	}

	const kind = required(values, "--kind");
	const allowedKinds = new Set([
		"library",
		"service",
		"cli",
		"browser-extension",
		"agent-package",
		"external-resource",
	]);
	if (!allowedKinds.has(kind)) throw new TypeError(`unsupported kind ${kind}`);

	return {
		targetDirectory: required(values, "--target"),
		moduleRef: required(values, "--module-ref"),
		packageName: required(values, "--package"),
		kind: kind as ParsedCreateArgs["kind"],
		domain: required(values, "--domain"),
		summary: required(values, "--summary"),
		...(values.has("--module-version")
			? { moduleVersion: required(values, "--module-version") }
			: {}),
		...(values.has("--platform-compatibility")
			? {
					platformCompatibility: required(values, "--platform-compatibility"),
				}
			: {}),
	};
}

async function main(): Promise<void> {
	try {
		const argv = process.argv.slice(2);
		if (argv[0] === "--help" || argv[0] === "-h") {
			process.stdout.write(
				"Usage: proflow-module-template create --target <directory> --module-ref <ref> --package <@tomflow/proflow-name> --kind <profile> --domain <domain> --summary <text> [--module-version <semver>] [--platform-compatibility <range>]\n",
			);
			return;
		}
		const input = parseCreateArgs(argv);
		const created = await materializeModule(input);
		process.stdout.write(
			`模块创建成功：${created.descriptor.moduleRef}\n目录：${created.packageDirectory}\n文件：${created.files.length} 个\n`,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stdout.write(`模块创建失败：${message}\n`);
		process.exitCode = 1;
	}
}

if (import.meta.main) {
	await main();
}
