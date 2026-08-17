import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

import { PlatformError } from "../errors.ts";

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
