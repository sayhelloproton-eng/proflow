import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import type { ResolvedModule } from "../contracts.ts";
import { PlatformError } from "../errors.ts";
import {
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

export function createWorkspacePackageManagerDriver(options: {
	workspaceRoot: string;
	runner?: PackageCommandRunner;
}): PackageManagerDriver {
	const runner = options.runner ?? systemPackageCommandRunner();
	return {
		observeInstalledVersion: (module) =>
			observeInstalledVersion(options.workspaceRoot, module.packageName),
		install: async (module) => {
			await ensureWorkspacePackageJson(options.workspaceRoot);
			const manager = await requirePackageManager(options.workspaceRoot);
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
			const manager = await requirePackageManager(options.workspaceRoot);
			await mutatePackage(
				runner,
				manager,
				options.workspaceRoot,
				"upgrade",
				`${module.packageName}@${module.moduleVersion}`,
			);
		},
		remove: async (module) => {
			const manager = await requirePackageManager(options.workspaceRoot);
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
	const args = packageManagerArgs(manager.name, operation, packageSpec);
	try {
		await runner.run(manager.name, args, workspaceRoot);
	} catch (error) {
		throw new PlatformError(
			operation === "upgrade" ? "UPGRADE_FAILED" : "APPLY_FAILED",
			`${manager.name} ${operation} failed for ${packageSpec}: ${errorMessage(error)}`,
		);
	}
}

function packageManagerArgs(
	manager: WorkspacePackageManagerSelection["name"],
	operation: "install" | "upgrade" | "remove",
	packageSpec: string,
): string[] {
	if (manager === "pnpm") {
		return operation === "remove"
			? ["remove", "--ignore-scripts", packageSpec]
			: ["add", "--save-exact", "--ignore-scripts", packageSpec];
	}
	return operation === "remove"
		? ["uninstall", "--ignore-scripts", packageSpec]
		: ["install", "--save-exact", "--ignore-scripts", packageSpec];
}

async function requirePackageManager(
	workspaceRoot: string,
): Promise<WorkspacePackageManagerSelection> {
	const manager = await readWorkspacePackageManagerSelection(workspaceRoot);
	if (manager === undefined) {
		throw new PlatformError(
			"APPLY_FAILED",
			"workspace packageManager is not supported; expected npm or pnpm",
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
	const require = createRequire(
		pathToFileURL(join(workspaceRoot, "package.json")),
	);
	let entry: string;
	try {
		entry = require.resolve(packageName);
	} catch {
		return undefined;
	}
	let current = dirname(entry);
	for (;;) {
		try {
			const raw = await readFile(join(current, "package.json"), "utf8");
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
		} catch {
			// keep walking to the package root
		}
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
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
