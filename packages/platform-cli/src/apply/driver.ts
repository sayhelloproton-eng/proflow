import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ResolvedModule } from "../contracts.ts";
import { PlatformError } from "../errors.ts";
import {
	findExecutable,
	type PackageCommandRunner,
	readWorkspacePackageManagerSelection,
	systemPackageCommandRunner,
	type WorkspacePackageManagerSelection,
} from "../install/package-manager.ts";
import { atomicWrite } from "../paths.ts";

/**
 * Package-level installation seam. Apply never invokes an arbitrary shell: a
 * package step is satisfied or mutated only through this injected driver. The
 * production driver executes a fixed package-manager binary with argv arrays.
 */
export interface PackageManagerDriver {
	observeInstalledVersion(module: ResolvedModule): Promise<string | undefined>;
	install(module: ResolvedModule): Promise<void>;
	upgrade(module: ResolvedModule): Promise<void>;
	remove(module: ResolvedModule): Promise<void>;
}

/**
 * Monorepo/test seam retained for source-resident planning. Production CLI must
 * inject createWorkspacePackageManagerDriver(); it must never rely on this
 * no-op driver to claim a product Workspace package mutation succeeded.
 */
export function workspaceResidentDriver(): PackageManagerDriver {
	return {
		async observeInstalledVersion(module) {
			return module.moduleVersion;
		},
		async install() {},
		async upgrade() {},
		async remove() {},
	};
}

export async function cleanupWorkspacePackageManagerArtifacts(options: {
	workspaceRoot: string;
	removedModules: readonly ResolvedModule[];
}): Promise<void> {
	const manager = await readWorkspacePackageManagerSelection(
		options.workspaceRoot,
	);
	if (manager.name !== "pnpm") return;

	const removedPackageSpecs = new Set(
		options.removedModules.map(
			(module) => `${module.packageName}@${module.moduleVersion}`,
		),
	);
	await cleanupPnpmReleaseAgeExcludes(
		options.workspaceRoot,
		removedPackageSpecs,
	);
	await normalizeEmptyPnpmRootImporter(options.workspaceRoot);
}

export function createWorkspacePackageManagerDriver(options: {
	workspaceRoot: string;
	runner?: PackageCommandRunner;
	executableAvailable?: (command: string) => boolean;
}): PackageManagerDriver {
	const runner = options.runner ?? systemPackageCommandRunner();
	const executableAvailable = options.executableAvailable ?? findExecutable;
	return {
		observeInstalledVersion: (module) =>
			observeInstalledVersion(options.workspaceRoot, module.packageName),
		install: async (module) => {
			await ensureWorkspacePackageJson(options.workspaceRoot);
			const manager = await requirePackageManager(
				options.workspaceRoot,
				executableAvailable,
			);
			await mutatePackage(
				runner,
				manager,
				options.workspaceRoot,
				"install",
				`${module.packageName}@${module.moduleVersion}`,
			);
		},
		upgrade: async (module) => {
			await ensureWorkspacePackageJson(options.workspaceRoot);
			const manager = await requirePackageManager(
				options.workspaceRoot,
				executableAvailable,
			);
			await mutatePackage(
				runner,
				manager,
				options.workspaceRoot,
				"upgrade",
				`${module.packageName}@${module.moduleVersion}`,
			);
		},
		remove: async (module) => {
			const manager = await requirePackageManager(
				options.workspaceRoot,
				executableAvailable,
			);
			await mutatePackage(
				runner,
				manager,
				options.workspaceRoot,
				"remove",
				module.packageName,
			);
		},
	};
}

async function mutatePackage(
	runner: PackageCommandRunner,
	manager: WorkspacePackageManagerSelection,
	workspaceRoot: string,
	operation: "install" | "upgrade" | "remove",
	packageSpec: string,
): Promise<void> {
	const args = await packageManagerArgs(
		runner,
		manager,
		workspaceRoot,
		operation,
		packageSpec,
	);
	try {
		await runner.run(manager.name, args, workspaceRoot);
	} catch (error) {
		throw new PlatformError(
			operation === "upgrade" ? "UPGRADE_FAILED" : "APPLY_FAILED",
			`${manager.name} ${operation} failed for ${packageSpec}: ${errorMessage(error)}`,
		);
	}
}

async function packageManagerArgs(
	runner: PackageCommandRunner,
	manager: WorkspacePackageManagerSelection,
	workspaceRoot: string,
	operation: "install" | "upgrade" | "remove",
	packageSpec: string,
): Promise<string[]> {
	if (manager.name === "pnpm") {
		return operation === "remove"
			? ["--config.ignore-scripts=true", "remove", packageSpec]
			: ["add", "--save-exact", "--ignore-scripts", packageSpec];
	}
	if (manager.name === "npm") {
		return operation === "remove"
			? ["uninstall", "--ignore-scripts", packageSpec]
			: ["install", "--save-exact", "--ignore-scripts", packageSpec];
	}

	const major = await yarnMajorVersion(runner, manager, workspaceRoot);
	if (major <= 1) {
		return operation === "remove"
			? ["remove", "--ignore-scripts", packageSpec]
			: ["add", "--exact", "--ignore-scripts", packageSpec];
	}
	return operation === "remove"
		? ["remove", "--mode=skip-build", packageSpec]
		: ["add", "--exact", "--mode=skip-build", packageSpec];
}

async function yarnMajorVersion(
	runner: PackageCommandRunner,
	manager: WorkspacePackageManagerSelection,
	workspaceRoot: string,
): Promise<number> {
	const declaredVersion = declaredPackageManagerVersion(manager.declared);
	const value =
		declaredVersion ??
		(await runner.run("yarn", ["--version"], workspaceRoot)).trim();
	const major = Number.parseInt(value.split(".")[0] ?? "", 10);
	if (!Number.isInteger(major) || major < 1) {
		throw new PlatformError(
			"PACKAGE_MANAGER_UNAVAILABLE",
			`cannot determine a supported Yarn major version from ${value || "<empty>"}`,
		);
	}
	return major;
}

function declaredPackageManagerVersion(
	declared: string | undefined,
): string | undefined {
	if (declared === undefined) return undefined;
	const separator = declared.lastIndexOf("@");
	return separator > 0 ? declared.slice(separator + 1) : undefined;
}

async function requirePackageManager(
	workspaceRoot: string,
	executableAvailable: (command: string) => boolean,
): Promise<WorkspacePackageManagerSelection> {
	const manager = await readWorkspacePackageManagerSelection(workspaceRoot);
	if (!executableAvailable(manager.name)) {
		throw new PlatformError(
			"PACKAGE_MANAGER_UNAVAILABLE",
			`workspace package manager ${manager.name} is not available on PATH`,
		);
	}
	return manager;
}

async function ensureWorkspacePackageJson(
	workspaceRoot: string,
): Promise<void> {
	const path = join(workspaceRoot, "package.json");
	try {
		const raw = await readFile(path, "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			throw new Error("package.json root must be an object");
		}
		return;
	} catch (error) {
		if (!isMissingFile(error)) {
			throw new PlatformError(
				"APPLY_FAILED",
				`workspace package.json is invalid: ${errorMessage(error)}`,
			);
		}
	}
	await atomicWrite(path, `${JSON.stringify({ private: true }, null, 2)}\n`);
}

async function observeInstalledVersion(
	workspaceRoot: string,
	packageName: string,
): Promise<string | undefined> {
	const manifest = await readWorkspaceManifest(workspaceRoot);
	if (
		manifest === undefined ||
		(!hasOwn(manifest.dependencies, packageName) &&
			!hasOwn(manifest.devDependencies, packageName))
	) {
		return undefined;
	}
	try {
		const raw = await readFile(
			join(
				workspaceRoot,
				"node_modules",
				...packageName.split("/"),
				"package.json",
			),
			"utf8",
		);
		const parsed: unknown = JSON.parse(raw);
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			!Array.isArray(parsed) &&
			Reflect.get(parsed, "name") === packageName &&
			typeof Reflect.get(parsed, "version") === "string"
		) {
			return Reflect.get(parsed, "version") as string;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

interface WorkspaceManifest {
	dependencies?: Record<string, unknown>;
	devDependencies?: Record<string, unknown>;
}

async function readWorkspaceManifest(
	workspaceRoot: string,
): Promise<WorkspaceManifest | undefined> {
	try {
		const raw = await readFile(join(workspaceRoot, "package.json"), "utf8");
		const parsed: unknown = JSON.parse(raw);
		return typeof parsed === "object" &&
			parsed !== null &&
			!Array.isArray(parsed)
			? (parsed as WorkspaceManifest)
			: undefined;
	} catch {
		return undefined;
	}
}

async function cleanupPnpmReleaseAgeExcludes(
	workspaceRoot: string,
	removedPackageSpecs: ReadonlySet<string>,
): Promise<void> {
	const path = join(workspaceRoot, "pnpm-workspace.yaml");
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if (isMissingFile(error)) return;
		throw error;
	}

	const lines = raw.split("\n");
	const keyIndex = lines.indexOf("minimumReleaseAgeExclude:");
	if (keyIndex < 0) return;
	let endIndex = keyIndex + 1;
	while (
		endIndex < lines.length &&
		(lines[endIndex]?.trim() === "" || /^\s/.test(lines[endIndex] ?? ""))
	) {
		endIndex += 1;
	}

	const retained = lines.slice(keyIndex + 1, endIndex).filter((line) => {
		const match = /^\s*-\s+(.+?)\s*$/.exec(line);
		if (match === null) return true;
		const value = stripYamlQuotes(match[1] ?? "");
		return !removedPackageSpecs.has(value);
	});
	const hasListItem = retained.some((line) => /^\s*-\s+/.test(line));
	const replacement = hasListItem ? [lines[keyIndex] ?? "", ...retained] : [];
	let next = [
		...lines.slice(0, keyIndex),
		...replacement,
		...lines.slice(endIndex),
	].join("\n");
	if (raw.endsWith("\n") && !next.endsWith("\n")) next += "\n";
	if (next !== raw) await atomicWrite(path, next);
}

async function normalizeEmptyPnpmRootImporter(
	workspaceRoot: string,
): Promise<void> {
	const path = join(workspaceRoot, "pnpm-lock.yaml");
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if (isMissingFile(error)) return;
		throw error;
	}
	const next = raw.replace(
		"\nimporters:\n\n  .: {}\n",
		"\nimporters:\n  .: {}\n",
	);
	if (next !== raw) await atomicWrite(path, next);
}

function stripYamlQuotes(value: string): string {
	if (
		(value.startsWith("'") && value.endsWith("'")) ||
		(value.startsWith('"') && value.endsWith('"'))
	) {
		return value.slice(1, -1);
	}
	return value;
}

function hasOwn(
	record: Record<string, unknown> | undefined,
	key: string,
): boolean {
	return record !== undefined && Object.hasOwn(record, key);
}

function isMissingFile(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		Reflect.get(error, "code") === "ENOENT"
	);
}

function errorMessage(error: unknown): string {
	if (typeof error === "object" && error !== null) {
		const stderr = Reflect.get(error, "stderr");
		if (typeof stderr === "string" && stderr.trim() !== "")
			return stderr.trim();
	}
	return error instanceof Error ? error.message : String(error);
}
