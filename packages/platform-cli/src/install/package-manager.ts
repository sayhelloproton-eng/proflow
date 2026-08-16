import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SupportedWorkspacePackageManager = "npm" | "pnpm";

export interface WorkspacePackageManagerSelection {
	name: SupportedWorkspacePackageManager;
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
): Promise<WorkspacePackageManagerSelection | undefined> {
	let declared: string | undefined;
	try {
		const raw = await readFile(join(workspaceRoot, "package.json"), "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (isRecord(parsed) && typeof parsed.packageManager === "string") {
			declared = parsed.packageManager;
		}
	} catch {
		// A Fresh Workspace without package.json uses npm for bootstrap. Invalid
		// package.json is rejected earlier by installer preflight.
	}
	if (declared === undefined) return { name: "npm" };
	const separator = declared.lastIndexOf("@");
	const name = separator > 0 ? declared.slice(0, separator) : declared;
	if (name !== "npm" && name !== "pnpm") return undefined;
	return { name, declared };
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
