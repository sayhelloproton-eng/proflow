import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";

import {
	parseModuleDescriptor,
	proflowPackageMetadataSchema,
	type ModuleDescriptor,
	type ModuleInstallClass,
} from "@tomflow/proflow-module-contract";

import { PlatformError } from "../errors.ts";
import { versionSatisfies } from "../modules.ts";

const execFileAsync = promisify(execFile);

export const PRO_FLOW_SCOPE = "@tomflow";
export const PRO_FLOW_PACKAGE_PREFIX = "@tomflow/proflow-";

export interface NpmCommandResult {
	stdout: string;
	stderr: string;
}

export interface NpmCommandRunner {
	run(args: readonly string[], cwd: string): Promise<NpmCommandResult>;
}

export interface RegistryModuleCandidate {
	packageName: string;
	moduleVersion: string;
	description?: string;
	installClass: ModuleInstallClass;
	descriptor: string;
	manifest: "./proflow.module.json";
	installRequires: string[];
	nodeVersionRange?: string;
	registry: string;
}

export interface RegistryRejectedPackage {
	packageName: string;
	moduleVersion?: string;
	reason:
		| "NOT_PROFLOW_MODULE"
		| "DEPRECATED"
		| "NODE_INCOMPATIBLE"
		| "METADATA_INVALID";
	message: string;
}

export interface RegistryDiscoveryResult {
	registry: string;
	candidates: RegistryModuleCandidate[];
	rejected: RegistryRejectedPackage[];
}

interface NpmSearchItem {
	name?: unknown;
	version?: unknown;
}

interface NpmViewManifest {
	name?: unknown;
	version?: unknown;
	description?: unknown;
	deprecated?: unknown;
	engines?: unknown;
	proflow?: unknown;
}

export function systemNpmRunner(): NpmCommandRunner {
	return {
		async run(args, cwd) {
			try {
				const result = await execFileAsync("npm", [...args], {
					cwd,
					encoding: "utf8",
					maxBuffer: 4 * 1024 * 1024,
				});
				return { stdout: result.stdout, stderr: result.stderr };
			} catch (error) {
				throw npmFailure(error);
			}
		},
	};
}

export async function resolveScopeRegistry(
	workspaceRoot: string,
	runner: NpmCommandRunner = systemNpmRunner(),
): Promise<string> {
	const scoped = await runner.run(
		["config", "get", `${PRO_FLOW_SCOPE}:registry`],
		workspaceRoot,
	);
	const scopedValue = normalizeConfigValue(scoped.stdout);
	if (scopedValue !== undefined) return scopedValue;
	const fallback = await runner.run(["config", "get", "registry"], workspaceRoot);
	const registry = normalizeConfigValue(fallback.stdout);
	if (registry === undefined) {
		throw new PlatformError(
			"REGISTRY_UNAVAILABLE",
			"npm registry is not configured",
		);
	}
	return registry;
}

export async function discoverRegistryModules(options: {
	workspaceRoot: string;
	packageName?: string;
	runner?: NpmCommandRunner;
	nodeVersion?: string;
}): Promise<RegistryDiscoveryResult> {
	const runner = options.runner ?? systemNpmRunner();
	const registry = await resolveScopeRegistry(options.workspaceRoot, runner);
	const names =
		options.packageName === undefined
			? await searchPackageNames(options.workspaceRoot, registry, runner)
			: [validateRequestedPackageName(options.packageName)];
	const candidates: RegistryModuleCandidate[] = [];
	const rejected: RegistryRejectedPackage[] = [];
	for (const packageName of names) {
		const manifest = await viewManifest(
			options.workspaceRoot,
			registry,
			packageName,
			runner,
		);
		const assessed = assessManifest(
			manifest,
			registry,
			options.nodeVersion ?? process.versions.node,
		);
		if ("candidate" in assessed) candidates.push(assessed.candidate);
		else rejected.push(assessed.rejected);
	}
	candidates.sort((left, right) =>
		left.packageName.localeCompare(right.packageName),
	);
	rejected.sort((left, right) => left.packageName.localeCompare(right.packageName));
	return { registry, candidates, rejected };
}

export async function loadRegistryModuleDescriptor(options: {
	workspaceRoot: string;
	candidate: RegistryModuleCandidate;
	runner?: NpmCommandRunner;
}): Promise<ModuleDescriptor> {
	const runner = options.runner ?? systemNpmRunner();
	const tempRoot = await mkdtemp(join(tmpdir(), "proflow-registry-manifest-"));
	try {
		const packed = await runner.run(
			[
				"pack",
				`${options.candidate.packageName}@${options.candidate.moduleVersion}`,
				"--json",
				"--ignore-scripts",
				`--pack-destination=${tempRoot}`,
				`--registry=${options.candidate.registry}`,
			],
			options.workspaceRoot,
		);
		const filename = packFilename(packed.stdout, options.candidate.packageName);
		const archive = await readFile(join(tempRoot, filename));
		const manifestPath = `package/${options.candidate.manifest.replace(/^\.\//, "")}`;
		const rawManifest = readTarEntry(archive, manifestPath);
		const descriptor = parseModuleDescriptor(
			parseJson(rawManifest.toString("utf8"), `${options.candidate.packageName} module manifest`),
		);
		if (
			descriptor.packageName !== options.candidate.packageName ||
			descriptor.moduleVersion !== options.candidate.moduleVersion
		) {
			throw new PlatformError(
				"REGISTRY_RESPONSE_INVALID",
				`Registry manifest identity/version mismatch for ${options.candidate.packageName}@${options.candidate.moduleVersion}`,
			);
		}
		return descriptor;
	} finally {
		await rm(tempRoot, { recursive: true, force: true });
	}
}

function packFilename(stdout: string, packageName: string): string {
	const parsed = parseJson(stdout, `npm pack ${packageName}`);
	if (!Array.isArray(parsed) || parsed.length !== 1 || !isRecord(parsed[0])) {
		throw new PlatformError(
			"REGISTRY_RESPONSE_INVALID",
			`npm pack response is invalid for ${packageName}`,
		);
	}
	const filename = parsed[0].filename;
	if (
		typeof filename !== "string" ||
		filename === "" ||
		filename.includes("/") ||
		filename.includes("\\")
	) {
		throw new PlatformError(
			"REGISTRY_RESPONSE_INVALID",
			`npm pack filename is invalid for ${packageName}`,
		);
	}
	return filename;
}

function readTarEntry(tgz: Buffer, targetName: string): Buffer {
	let tar: Buffer;
	try {
		tar = gunzipSync(tgz);
	} catch {
		throw new PlatformError("REGISTRY_RESPONSE_INVALID", "npm package tarball is not valid gzip");
	}
	for (let offset = 0; offset + 512 <= tar.length; ) {
		const header = tar.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const name = tarString(header, 0, 100);
		const prefix = tarString(header, 345, 155);
		const entryName = prefix === "" ? name : `${prefix}/${name}`;
		const sizeRaw = tarString(header, 124, 12).trim();
		const size = sizeRaw === "" ? 0 : Number.parseInt(sizeRaw, 8);
		if (!Number.isSafeInteger(size) || size < 0) {
			throw new PlatformError("REGISTRY_RESPONSE_INVALID", "npm package tarball has an invalid entry size");
		}
		const dataStart = offset + 512;
		const dataEnd = dataStart + size;
		if (dataEnd > tar.length) {
			throw new PlatformError("REGISTRY_RESPONSE_INVALID", "npm package tarball is truncated");
		}
		if (entryName === targetName) {
			if (size > 1024 * 1024) {
				throw new PlatformError("REGISTRY_RESPONSE_INVALID", "ProFlow module manifest exceeds 1 MiB");
			}
			return tar.subarray(dataStart, dataEnd);
		}
		offset = dataStart + Math.ceil(size / 512) * 512;
	}
	throw new PlatformError(
		"REGISTRY_RESPONSE_INVALID",
		`npm package tarball does not contain ${targetName}`,
	);
}

function tarString(header: Buffer, start: number, length: number): string {
	const field = header.subarray(start, start + length);
	const end = field.indexOf(0);
	return field.subarray(0, end < 0 ? field.length : end).toString("utf8");
}

export async function discoverRegistryInstallClosure(options: {
	workspaceRoot: string;
	packageName: string;
	runner?: NpmCommandRunner;
	nodeVersion?: string;
}): Promise<RegistryDiscoveryResult> {
	const runner = options.runner ?? systemNpmRunner();
	const queue = [validateRequestedPackageName(options.packageName)];
	const seen = new Set<string>();
	const candidates = new Map<string, RegistryModuleCandidate>();
	const rejected = new Map<string, RegistryRejectedPackage>();
	let registry: string | undefined;

	while (queue.length > 0) {
		const packageName = queue.shift()!;
		if (seen.has(packageName)) continue;
		seen.add(packageName);
		const discovered = await discoverRegistryModules({
			workspaceRoot: options.workspaceRoot,
			packageName,
			runner,
			...(options.nodeVersion === undefined ? {} : { nodeVersion: options.nodeVersion }),
		});
		registry ??= discovered.registry;
		for (const item of discovered.rejected) rejected.set(item.packageName, item);
		const candidate = discovered.candidates[0];
		if (candidate === undefined) {
			throw new PlatformError(
				"PACKAGE_NOT_PROFLOW",
				`package ${packageName} is not an installable ProFlow module`,
			);
		}
		candidates.set(candidate.packageName, candidate);
		for (const dependency of candidate.installRequires) {
			if (!seen.has(dependency)) queue.push(dependency);
		}
	}

	if (registry === undefined) {
		registry = await resolveScopeRegistry(options.workspaceRoot, runner);
	}
	return {
		registry,
		candidates: [...candidates.values()].sort((a, b) => a.packageName.localeCompare(b.packageName)),
		rejected: [...rejected.values()].sort((a, b) => a.packageName.localeCompare(b.packageName)),
	};
}

async function searchPackageNames(
	workspaceRoot: string,
	registry: string,
	runner: NpmCommandRunner,
): Promise<string[]> {
	const result = await runner.run(
		[
			"search",
			PRO_FLOW_PACKAGE_PREFIX,
			"--json",
			"--searchlimit=250",
			"--prefer-online",
			`--registry=${registry}`,
		],
		workspaceRoot,
	);
	const parsed = parseJson(result.stdout, "npm search response");
	if (!Array.isArray(parsed)) {
		throw new PlatformError(
			"REGISTRY_RESPONSE_INVALID",
			"npm search response is not an array",
		);
	}
	const names = new Set<string>();
	for (const raw of parsed as NpmSearchItem[]) {
		if (typeof raw?.name !== "string") continue;
		if (!raw.name.startsWith(PRO_FLOW_PACKAGE_PREFIX)) continue;
		names.add(raw.name);
	}
	return [...names].sort();
}

async function viewManifest(
	workspaceRoot: string,
	registry: string,
	packageName: string,
	runner: NpmCommandRunner,
): Promise<NpmViewManifest> {
	const result = await runner.run(
		["view", packageName, "--json", "--prefer-online", `--registry=${registry}`],
		workspaceRoot,
	);
	const parsed = parseJson(result.stdout, `npm view ${packageName}`);
	if (!isRecord(parsed)) {
		throw new PlatformError(
			"REGISTRY_RESPONSE_INVALID",
			`npm view response is not an object for ${packageName}`,
		);
	}
	return parsed as NpmViewManifest;
}

function assessManifest(
	manifest: NpmViewManifest,
	registry: string,
	nodeVersion: string,
): { candidate: RegistryModuleCandidate } | { rejected: RegistryRejectedPackage } {
	if (typeof manifest.name !== "string" || !manifest.name.startsWith(PRO_FLOW_PACKAGE_PREFIX)) {
		return rejectedManifest(manifest, "NOT_PROFLOW_MODULE", "package name is outside the ProFlow scope prefix");
	}
	const packageName = manifest.name;
	const moduleVersion = typeof manifest.version === "string" ? manifest.version : undefined;
	if (moduleVersion === undefined) {
		return rejectedManifest(manifest, "METADATA_INVALID", "package version is missing");
	}
	if (typeof manifest.deprecated === "string" && manifest.deprecated.trim() !== "") {
		return {
			rejected: {
				packageName,
				moduleVersion,
				reason: "DEPRECATED",
				message: manifest.deprecated,
			},
		};
	}
	const metadata = proflowPackageMetadataSchema.safeParse(manifest.proflow);
	if (!metadata.success) {
		return {
			rejected: {
				packageName,
				moduleVersion,
				reason: "METADATA_INVALID",
				message: "package.json.proflow does not satisfy the ProFlow Module Contract",
			},
		};
	}
	const nodeVersionRange = nodeRangeOf(manifest.engines);
	if (
		nodeVersionRange !== undefined &&
		!versionSatisfies(nodeVersion, nodeVersionRange)
	) {
		return {
			rejected: {
				packageName,
				moduleVersion,
				reason: "NODE_INCOMPATIBLE",
				message: `node ${nodeVersion} does not satisfy ${nodeVersionRange}`,
			},
		};
	}
	return {
		candidate: {
			packageName,
			moduleVersion,
			...(typeof manifest.description === "string"
				? { description: manifest.description }
				: {}),
			installClass: metadata.data.installClass,
			descriptor: metadata.data.descriptor,
			manifest: metadata.data.manifest,
			installRequires: [...metadata.data.installRequires],
			...(nodeVersionRange === undefined ? {} : { nodeVersionRange }),
			registry,
		},
	};
}

function validateRequestedPackageName(packageName: string): string {
	if (!packageName.startsWith(PRO_FLOW_PACKAGE_PREFIX)) {
		throw new PlatformError(
			"PACKAGE_NOT_PROFLOW",
			`package ${packageName} is outside ${PRO_FLOW_PACKAGE_PREFIX}*`,
		);
	}
	return packageName;
}

function nodeRangeOf(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	return typeof value.node === "string" ? value.node : undefined;
}

function rejectedManifest(
	manifest: NpmViewManifest,
	reason: RegistryRejectedPackage["reason"],
	message: string,
): { rejected: RegistryRejectedPackage } {
	return {
		rejected: {
			packageName:
				typeof manifest.name === "string" ? manifest.name : "<unknown>",
			...(typeof manifest.version === "string"
				? { moduleVersion: manifest.version }
				: {}),
			reason,
			message,
		},
	};
}

function normalizeConfigValue(value: string): string | undefined {
	const trimmed = value.trim();
	if (trimmed === "" || trimmed === "undefined" || trimmed === "null") {
		return undefined;
	}
	return trimmed;
}

function parseJson(value: string, label: string): unknown {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		throw new PlatformError(
			"REGISTRY_RESPONSE_INVALID",
			`${label} is not valid JSON`,
		);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function npmFailure(error: unknown): PlatformError {
	const detail = npmErrorText(error);
	if (/E401|E403|ENEEDAUTH|authentication|authorized/i.test(detail)) {
		return new PlatformError(
			"REGISTRY_AUTH_REQUIRED",
			`npm registry authentication is required: ${detail}`,
		);
	}
	if (/E404|not found/i.test(detail)) {
		return new PlatformError("PACKAGE_NOT_FOUND", detail);
	}
	return new PlatformError("REGISTRY_UNAVAILABLE", detail);
}

function npmErrorText(error: unknown): string {
	if (!isRecord(error)) return String(error);
	const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
	const message = typeof error.message === "string" ? error.message : String(error);
	return stderr === "" ? message : stderr;
}
