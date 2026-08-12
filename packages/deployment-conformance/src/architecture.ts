import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { moduleDescriptorSchema } from "@tomflow/proflow-module-contract";
import {
	type ConformanceIssue,
	runPackageConformance,
	runStaticConformance,
} from "./index.ts";

export interface RepositoryArchitectureResult {
	status: "PASS" | "FAIL";
	issues: ConformanceIssue[];
	checkedPackages: string[];
	futureDomainGates: string[];
}

interface PackageRecord {
	directory: string;
	name: string;
	metadata: Record<string, unknown>;
	dependencies: Set<string>;
	runtimeDependencies: Set<string>;
	exports: Set<string>;
}

async function exists(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

async function filesUnder(directory: string): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (["node_modules", ".git", "dist", "lib"].includes(entry.name)) continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await filesUnder(path)));
		else if (entry.isFile()) files.push(path);
	}
	return files;
}

function dependencyNames(
	metadata: Record<string, unknown>,
	fields: string[],
): Set<string> {
	const names = new Set<string>();
	for (const field of fields) {
		const value = metadata[field];
		if (typeof value !== "object" || value === null) continue;
		for (const name of Object.keys(value)) names.add(name);
	}
	return names;
}

function exportNames(metadata: Record<string, unknown>): Set<string> {
	const value = metadata.exports;
	if (typeof value !== "object" || value === null) return new Set();
	return new Set(Object.keys(value));
}

function packageSpecifier(
	specifier: string,
): { name: string; subpath: string } | undefined {
	const match = /^(@tomflow\/proflow-[a-z0-9-]+)(\/.*)?$/.exec(specifier);
	return match?.[1] === undefined
		? undefined
		: { name: match[1], subpath: match[2] ?? "" };
}

interface SourceToken {
	kind: "identifier" | "string" | "punctuation" | "template";
	value: string;
}

function sourceTokens(source: string): SourceToken[] {
	const tokens: SourceToken[] = [];
	let index = 0;
	while (index < source.length) {
		const character = source[index] ?? "";
		const next = source[index + 1] ?? "";
		if (/\s/.test(character)) {
			index += 1;
			continue;
		}
		if (character === "/" && next === "/") {
			index = source.indexOf("\n", index + 2);
			if (index < 0) break;
			continue;
		}
		if (character === "/" && next === "*") {
			const end = source.indexOf("*/", index + 2);
			index = end < 0 ? source.length : end + 2;
			continue;
		}
		if (character === '"' || character === "'") {
			const quote = character;
			let value = "";
			index += 1;
			while (index < source.length) {
				const item = source[index] ?? "";
				if (item === "\\") {
					value += source[index + 1] ?? "";
					index += 2;
				} else if (item === quote) {
					index += 1;
					break;
				} else {
					value += item;
					index += 1;
				}
			}
			tokens.push({ kind: "string", value });
			continue;
		}
		if (character === "`") {
			let value = "";
			let interpolated = false;
			index += 1;
			while (index < source.length) {
				const item = source[index] ?? "";
				if (item === "\\") {
					value += source[index + 1] ?? "";
					index += 2;
				} else if (item === "`") {
					index += 1;
					break;
				} else {
					if (item === "$" && source[index + 1] === "{") interpolated = true;
					value += item;
					index += 1;
				}
			}
			tokens.push({ kind: interpolated ? "template" : "string", value });
			continue;
		}
		if (/[A-Za-z_$]/.test(character)) {
			let value = character;
			index += 1;
			while (
				index < source.length &&
				/[A-Za-z0-9_$-]/.test(source[index] ?? "")
			) {
				value += source[index] ?? "";
				index += 1;
			}
			tokens.push({ kind: "identifier", value });
			continue;
		}
		tokens.push({ kind: "punctuation", value: character });
		index += 1;
	}
	return tokens;
}

function importSpecifiers(source: string): {
	specifiers: string[];
	unresolvedDynamicImport: boolean;
} {
	const controlledLocalFileImports = source.replace(
		/\/\* architecture-allow-local-file-url-import \*\/\s*import\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\.href\s*\)/g,
		(match, identifier: string) =>
			source.includes('from "node:url"') &&
			new RegExp(
				`(?:const|let)\\s+${identifier}\\s*=\\s*pathToFileURL\\s*\\(`,
			).test(source)
				? 'import("node:architecture-controlled-local-file")'
				: match,
	);
	const tokens = sourceTokens(controlledLocalFileImports);
	const specifiers: string[] = [];
	let unresolvedDynamicImport = false;
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token?.kind !== "identifier") continue;
		if (token.value === "require" || token.value === "import") {
			if (tokens[index + 1]?.value === "(") {
				const argument = tokens[index + 2];
				if (argument?.kind === "string") specifiers.push(argument.value);
				else unresolvedDynamicImport = true;
				continue;
			}
			if (token.value === "import" && tokens[index + 1]?.kind === "string") {
				specifiers.push(tokens[index + 1]?.value ?? "");
				continue;
			}
		}
		if (token.value === "import" || token.value === "export") {
			for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
				const candidate = tokens[cursor];
				if (candidate?.value === ";") break;
				if (
					candidate?.value === "from" &&
					tokens[cursor + 1]?.kind === "string"
				) {
					specifiers.push(tokens[cursor + 1]?.value ?? "");
					break;
				}
			}
		}
	}
	return { specifiers, unresolvedDynamicImport };
}

function belongsTo(path: string, packageDirectory: string): boolean {
	const rel = relative(packageDirectory, path);
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

function hasPlaintextSecret(source: string): boolean {
	return /\b(?:apiKey|apiToken|password|secret)\s*[:=]\s*["'][^"']+["']/.test(
		source,
	);
}

async function loadPackageRecords(
	repositoryRoot: string,
): Promise<PackageRecord[]> {
	const packagesRoot = join(repositoryRoot, "packages");
	const entries = await readdir(packagesRoot, { withFileTypes: true });
	const records: PackageRecord[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const directory = join(packagesRoot, entry.name);
		const metadata = JSON.parse(
			await readFile(join(directory, "package.json"), "utf8"),
		) as Record<string, unknown>;
		const name = typeof metadata.name === "string" ? metadata.name : "";
		records.push({
			directory,
			name,
			metadata,
			dependencies: dependencyNames(metadata, [
				"dependencies",
				"devDependencies",
				"peerDependencies",
				"optionalDependencies",
			]),
			runtimeDependencies: dependencyNames(metadata, [
				"dependencies",
				"peerDependencies",
				"optionalDependencies",
			]),
			exports: exportNames(metadata),
		});
	}
	return records;
}

function detectCycles(records: PackageRecord[]): string[][] {
	const byName = new Map(records.map((record) => [record.name, record]));
	const visiting: string[] = [];
	const complete = new Set<string>();
	const cycles: string[][] = [];
	function visit(name: string): void {
		if (complete.has(name)) return;
		const existing = visiting.indexOf(name);
		if (existing >= 0) {
			cycles.push([...visiting.slice(existing), name]);
			return;
		}
		visiting.push(name);
		for (const dependency of byName.get(name)?.runtimeDependencies ?? []) {
			if (byName.has(dependency)) visit(dependency);
		}
		visiting.pop();
		complete.add(name);
	}
	for (const record of records) visit(record.name);
	return cycles;
}

export async function runRepositoryArchitecture(
	repositoryRoot: string,
): Promise<RepositoryArchitectureResult> {
	const issues: ConformanceIssue[] = [];
	const rootMetadata = JSON.parse(
		await readFile(join(repositoryRoot, "package.json"), "utf8"),
	) as Record<string, unknown>;
	if (rootMetadata.private !== true) {
		issues.push({
			code: "ROOT_NOT_PRIVATE",
			message: "repository root package must remain private",
		});
	}
	const records = await loadPackageRecords(repositoryRoot);
	const byName = new Map(records.map((record) => [record.name, record]));
	for (const record of records) {
		const basename = record.directory.split(sep).at(-1) ?? "";
		if (["common", "shared", "utils", "core"].includes(basename)) {
			issues.push({
				code: "DUMPING_GROUND_PACKAGE",
				message: `${basename} is not an approved Shared Kernel`,
			});
		}
		if (!/^@tomflow\/proflow-[a-z][a-z0-9-]*$/.test(record.name)) {
			issues.push({
				code: "PACKAGE_NAME_INVALID",
				message: `${record.name || basename} violates formal package naming`,
			});
		}
		if (record.metadata.private === true) {
			issues.push({
				code: "FORMAL_MODULE_PRIVATE",
				message: `${record.name} must remain publishable`,
			});
		}
		if (
			typeof record.metadata.publishConfig !== "object" ||
			record.metadata.publishConfig === null ||
			Reflect.get(record.metadata.publishConfig, "access") !== "public"
		) {
			issues.push({
				code: "PUBLISH_ACCESS_INVALID",
				message: `${record.name} requires public scoped publish metadata`,
			});
		}
		if ([...record.exports].some((key) => key.includes("*"))) {
			issues.push({
				code: "WILDCARD_EXPORT",
				message: `${record.name} must expose explicit public exports`,
			});
		}

		const descriptorPath = join(record.directory, "deployment/descriptor.ts");
		if (!(await exists(descriptorPath))) {
			issues.push({
				code: "MODULE_DESCRIPTOR_MISSING",
				message: `${record.name} is not governed as a Module`,
			});
		} else {
			try {
				const descriptorUrl = pathToFileURL(descriptorPath);
				descriptorUrl.searchParams.set(
					"architecture",
					`${Date.now()}-${Math.random()}`,
				);
				const loaded: unknown =
					await /* architecture-allow-local-file-url-import */ import(
						descriptorUrl.href
					);
				const descriptorInput =
					typeof loaded === "object" && loaded !== null
						? Reflect.get(loaded, "descriptor")
						: undefined;
				const c1 = runStaticConformance(descriptorInput);
				issues.push(
					...c1.issues.map((issue) => ({
						...issue,
						message: `${record.name}: ${issue.message}`,
					})),
				);
				const descriptor = moduleDescriptorSchema.safeParse(descriptorInput);
				if (descriptor.success) {
					const c2 = await runPackageConformance(
						record.directory,
						descriptor.data,
					);
					issues.push(
						...c2.issues.map((issue) => ({
							...issue,
							message: `${record.name}: ${issue.message}`,
						})),
					);
				}
			} catch {
				issues.push({
					code: "MODULE_DESCRIPTOR_INVALID",
					message: `${record.name} descriptor cannot load`,
				});
			}
		}

		for (const file of await filesUnder(record.directory)) {
			if (!/\.(?:ts|js|mts|mjs)$/.test(file)) continue;
			const source = await readFile(file, "utf8");
			const publishable = !/[\\/](?:tests?|fixtures)[\\/]/.test(file);
			if (publishable && hasPlaintextSecret(source)) {
				issues.push({
					code: "PLAINTEXT_SECRET",
					message: `${record.name}: plaintext secret in ${relative(record.directory, file)}`,
				});
			}
			const imports = importSpecifiers(source);
			if (imports.unresolvedDynamicImport) {
				issues.push({
					code: "UNRESOLVED_DYNAMIC_IMPORT",
					message: `${record.name} contains a non-static dynamic import/require`,
				});
			}
			for (const specifier of imports.specifiers) {
				const parsed = packageSpecifier(specifier);
				if (parsed !== undefined) {
					if (
						!record.dependencies.has(parsed.name) &&
						parsed.name !== record.name
					) {
						issues.push({
							code: "UNDECLARED_DEPENDENCY",
							message: `${record.name} imports undeclared ${parsed.name}`,
						});
					}
					if (parsed.subpath !== "") {
						const provider = byName.get(parsed.name);
						const exportKey = `.${parsed.subpath}`;
						if (
							/\/(?:src|internal)\//.test(parsed.subpath) ||
							provider === undefined ||
							!provider.exports.has(exportKey)
						) {
							issues.push({
								code: "DEEP_IMPORT",
								message: `${record.name} imports non-public ${specifier}`,
							});
						}
					}
				} else if (specifier.startsWith(".")) {
					const resolved = resolve(dirname(file), specifier);
					const provider = records.find((candidate) =>
						belongsTo(resolved, candidate.directory),
					);
					if (provider !== undefined && provider.name !== record.name) {
						issues.push({
							code: "DEEP_IMPORT",
							message: `${record.name} crosses package boundary via ${specifier}`,
						});
					}
				}
			}
		}
	}
	for (const cycle of detectCycles(records)) {
		issues.push({ code: "DEPENDENCY_CYCLE", message: cycle.join(" -> ") });
	}
	return {
		status: issues.length === 0 ? "PASS" : "FAIL",
		issues,
		checkedPackages: records.map((record) => record.name).sort(),
		futureDomainGates: [
			"Owner and cross-domain state mutation must be proven when business Domain packages exist",
			"DB/Repository ownership requires real persistence implementations",
			"Cross-domain E2E remains a later implementation Wave",
		],
	};
}
