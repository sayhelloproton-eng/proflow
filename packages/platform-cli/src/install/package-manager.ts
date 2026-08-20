import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

import { PlatformError } from "../errors.ts";
import { atomicWrite } from "../paths.ts";

const execFileAsync = promisify(execFile);

export type SupportedWorkspacePackageManager = "npm" | "yarn" | "pnpm";
export type PackageManagerSelectionSource =
	| "declared"
	| "lockfile"
	| "bootstrap-default";

export interface WorkspacePackageManagerSelection {
	name: SupportedWorkspacePackageManager;
	source: PackageManagerSelectionSource;
	declared?: string;
}

export interface PackageCommandRunner {
	run(command: string, args: readonly string[], cwd: string): Promise<string>;
}

export function systemPackageCommandRunner(): PackageCommandRunner {
	return {
		async run(command, args, cwd) {
			const result = await execFileAsync(command, [...args], {
				cwd,
				encoding: "utf8",
				maxBuffer: 4 * 1024 * 1024,
			});
			return result.stdout;
		},
	};
}

export async function readWorkspacePackageManagerSelection(
	workspaceRoot: string,
): Promise<WorkspacePackageManagerSelection> {
	const declared = await readDeclaredPackageManager(workspaceRoot);
	const lockManagers = await detectLockfileManagers(workspaceRoot);

	if (declared !== undefined) {
		const name = packageManagerName(declared);
		if (name === undefined) {
			throw new PlatformError(
				"PACKAGE_MANAGER_UNSUPPORTED",
				`unsupported packageManager declaration: ${declared}; expected npm, yarn, or pnpm`,
			);
		}
		const conflicts = [...lockManagers].filter((manager) => manager !== name);
		if (conflicts.length > 0) {
			throw new PlatformError(
				"PACKAGE_MANAGER_CONFLICT",
				`packageManager declares ${declared}, but conflicting lockfiles indicate ${conflicts.join(", ")}`,
			);
		}
		return { name, source: "declared", declared };
	}

	if (lockManagers.size > 1) {
		throw new PlatformError(
			"PACKAGE_MANAGER_CONFLICT",
			`multiple package-manager lockfiles are present: ${[...lockManagers].sort().join(", ")}`,
		);
	}
	const [fromLockfile] = lockManagers;
	if (fromLockfile !== undefined) {
		return { name: fromLockfile, source: "lockfile" };
	}
	return { name: "npm", source: "bootstrap-default" };
}

export function findExecutable(command: string): boolean {
	const path = process.env.PATH ?? "";
	const suffixes = process.platform === "win32" ? [".cmd", ".exe", ""] : [""];
	for (const directory of path.split(delimiter).filter(Boolean)) {
		for (const suffix of suffixes) {
			try {
				accessSync(join(directory, `${command}${suffix}`), constants.X_OK);
				return true;
			} catch {
				// keep scanning PATH
			}
		}
	}
	return false;
}

async function readDeclaredPackageManager(
	workspaceRoot: string,
): Promise<string | undefined> {
	try {
		const raw = await readFile(join(workspaceRoot, "package.json"), "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) {
			throw new PlatformError(
				"PACKAGE_MANAGER_CONFLICT",
				"workspace package.json root must be an object",
			);
		}
		return typeof parsed.packageManager === "string"
			? parsed.packageManager
			: undefined;
	} catch (error) {
		if (isMissingFile(error)) return undefined;
		if (error instanceof PlatformError) throw error;
		throw new PlatformError(
			"PACKAGE_MANAGER_CONFLICT",
			`cannot inspect workspace package.json: ${errorMessage(error)}`,
		);
	}
}

async function detectLockfileManagers(
	workspaceRoot: string,
): Promise<Set<SupportedWorkspacePackageManager>> {
	const managers = new Set<SupportedWorkspacePackageManager>();
	if (
		(await pathExists(join(workspaceRoot, "package-lock.json"))) ||
		(await pathExists(join(workspaceRoot, "npm-shrinkwrap.json")))
	) {
		managers.add("npm");
	}
	if (await pathExists(join(workspaceRoot, "yarn.lock"))) managers.add("yarn");
	if (await pathExists(join(workspaceRoot, "pnpm-lock.yaml")))
		managers.add("pnpm");
	return managers;
}

function packageManagerName(
	declared: string,
): SupportedWorkspacePackageManager | undefined {
	const separator = declared.lastIndexOf("@");
	const name = separator > 0 ? declared.slice(0, separator) : declared;
	return name === "npm" || name === "yarn" || name === "pnpm"
		? name
		: undefined;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
	return isRecord(error) && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export interface WorkspacePackageTarget {
	packageName: string;
	version: string;
}

export interface WorkspacePackageMutationResult {
	packageManager: SupportedWorkspacePackageManager;
	packages: string[];
}

export async function syncWorkspacePackages(options: {
	workspaceRoot: string;
	packages: readonly WorkspacePackageTarget[];
	runner?: PackageCommandRunner;
	executableAvailable?: (command: string) => boolean;
}): Promise<WorkspacePackageMutationResult> {
	if (options.packages.length === 0) {
		return { packageManager: "npm", packages: [] };
	}
	await ensureWorkspaceManifest(options.workspaceRoot);
	const runner = options.runner ?? systemPackageCommandRunner();
	const manager = await requireWorkspacePackageManager(
		options.workspaceRoot,
		options.executableAvailable ?? findExecutable,
	);
	const targets = [...options.packages].sort((a, b) =>
		a.packageName.localeCompare(b.packageName),
	);
	const specs = targets.map((item) => `${item.packageName}@${item.version}`);
	await writeManagedPackageSet(options.workspaceRoot, targets);
	const args = await packageManagerInstallArgs(
		runner,
		manager,
		options.workspaceRoot,
	);
	try {
		await runner.run(manager.name, args, options.workspaceRoot);
	} catch (error) {
		throw new PlatformError(
			"COMMAND_FAILED",
			`${manager.name} install failed: ${packageMutationError(error)}`,
		);
	}
	return { packageManager: manager.name, packages: specs };
}

async function writeManagedPackageSet(
	workspaceRoot: string,
	targets: readonly WorkspacePackageTarget[],
): Promise<void> {
	const path = join(workspaceRoot, "package.json");
	const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
	if (!isRecord(parsed)) {
		throw new PlatformError(
			"INVALID_REQUEST",
			"workspace package.json root must be an object",
		);
	}
	const dependencies = isRecord(parsed.dependencies)
		? { ...parsed.dependencies }
		: {};
	const devDependencies = isRecord(parsed.devDependencies)
		? { ...parsed.devDependencies }
		: {};
	for (const record of [dependencies, devDependencies]) {
		for (const name of Object.keys(record)) {
			if (name.startsWith("@tomflow/proflow-")) delete record[name];
		}
	}
	for (const target of targets)
		dependencies[target.packageName] = target.version;
	const next: Record<string, unknown> = { ...parsed, dependencies };
	if ("devDependencies" in parsed || Object.keys(devDependencies).length > 0) {
		next.devDependencies = devDependencies;
	}
	await atomicWrite(path, `${JSON.stringify(next, null, 2)}\n`);
}

async function packageManagerInstallArgs(
	runner: PackageCommandRunner,
	manager: WorkspacePackageManagerSelection,
	workspaceRoot: string,
): Promise<string[]> {
	if (manager.name === "pnpm") return ["install", "--ignore-scripts"];
	if (manager.name === "npm") return ["install", "--ignore-scripts"];
	const major = await batchYarnMajorVersion(runner, manager, workspaceRoot);
	return major <= 1
		? ["install", "--ignore-scripts"]
		: ["install", "--mode=skip-build"];
}

export async function removeWorkspacePackages(options: {
	workspaceRoot: string;
	packageNames: readonly string[];
	runner?: PackageCommandRunner;
	executableAvailable?: (command: string) => boolean;
}): Promise<WorkspacePackageMutationResult> {
	const packageNames = [...new Set(options.packageNames)].sort();
	if (packageNames.length === 0) {
		return { packageManager: "npm", packages: [] };
	}
	const runner = options.runner ?? systemPackageCommandRunner();
	const manager = await requireWorkspacePackageManager(
		options.workspaceRoot,
		options.executableAvailable ?? findExecutable,
	);
	const args = await batchPackageManagerArgs(
		runner,
		manager,
		options.workspaceRoot,
		"remove",
		packageNames,
	);
	try {
		await runner.run(manager.name, args, options.workspaceRoot);
	} catch (error) {
		throw new PlatformError(
			"UNINSTALL_FAILED",
			`${manager.name} remove failed: ${packageMutationError(error)}`,
		);
	}
	return { packageManager: manager.name, packages: packageNames };
}

export async function observeWorkspaceInstalledVersion(
	workspaceRoot: string,
	packageName: string,
): Promise<string | undefined> {
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
			!isRecord(parsed) ||
			parsed.name !== packageName ||
			typeof parsed.version !== "string"
		) {
			return undefined;
		}
		return parsed.version;
	} catch {
		return undefined;
	}
}

async function ensureWorkspaceManifest(workspaceRoot: string): Promise<void> {
	const path = join(workspaceRoot, "package.json");
	try {
		const raw = await readFile(path, "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed))
			throw new Error("package.json root must be an object");
		return;
	} catch (error) {
		if (!isMissingFile(error)) {
			throw new PlatformError(
				"INVALID_REQUEST",
				`workspace package.json is invalid: ${errorMessage(error)}`,
			);
		}
	}
	await atomicWrite(path, `${JSON.stringify({ private: true }, null, 2)}\n`);
}

async function requireWorkspacePackageManager(
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

async function batchPackageManagerArgs(
	runner: PackageCommandRunner,
	manager: WorkspacePackageManagerSelection,
	workspaceRoot: string,
	operation: "sync" | "remove",
	packages: readonly string[],
): Promise<string[]> {
	if (manager.name === "pnpm") {
		return operation === "remove"
			? ["--config.ignore-scripts=true", "remove", ...packages]
			: ["add", "--save-exact", "--ignore-scripts", ...packages];
	}
	if (manager.name === "npm") {
		return operation === "remove"
			? ["uninstall", "--ignore-scripts", ...packages]
			: ["install", "--save-exact", "--ignore-scripts", ...packages];
	}
	const major = await batchYarnMajorVersion(runner, manager, workspaceRoot);
	if (major <= 1) {
		return operation === "remove"
			? ["remove", "--ignore-scripts", ...packages]
			: ["add", "--exact", "--ignore-scripts", ...packages];
	}
	return operation === "remove"
		? ["remove", "--mode=skip-build", ...packages]
		: ["add", "--exact", "--mode=skip-build", ...packages];
}

async function batchYarnMajorVersion(
	runner: PackageCommandRunner,
	manager: WorkspacePackageManagerSelection,
	workspaceRoot: string,
): Promise<number> {
	const declared = manager.declared;
	const separator = declared?.lastIndexOf("@") ?? -1;
	const declaredVersion =
		declared !== undefined && separator > 0
			? declared.slice(separator + 1)
			: undefined;
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

function packageMutationError(error: unknown): string {
	if (
		isRecord(error) &&
		typeof error.stderr === "string" &&
		error.stderr.trim() !== ""
	) {
		return error.stderr.trim();
	}
	return errorMessage(error);
}
