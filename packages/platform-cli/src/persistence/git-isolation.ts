import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { PlatformError } from "../errors.ts";

const execute = promisify(execFile);

async function git(root: string, args: string[]): Promise<string | undefined> {
	try {
		const result = await execute("git", ["-C", root, ...args], {
			encoding: "utf8",
		});
		return result.stdout.trim();
	} catch {
		return undefined;
	}
}

export async function ensureWorkspaceStateIsGitIgnored(
	workspaceRoot: string,
): Promise<{ gitRepository: boolean; changed: boolean }> {
	const topLevel = await git(workspaceRoot, ["rev-parse", "--show-toplevel"]);
	const gitDirectoryValue = await git(workspaceRoot, ["rev-parse", "--git-dir"]);
	if (!topLevel || !gitDirectoryValue)
		return { gitRepository: false, changed: false };
	if (await git(workspaceRoot, ["check-ignore", ".proflow/workspace.json"]))
		return { gitRepository: true, changed: false };

	const gitDirectory = resolve(workspaceRoot, gitDirectoryValue);
	const excludePath = resolve(gitDirectory, "info", "exclude");
	const workspaceRelative = relative(topLevel, workspaceRoot).replaceAll("\\", "/");
	const pattern = `/${workspaceRelative ? `${workspaceRelative}/` : ""}.proflow/`;
	let existing = "";
	try {
		existing = await readFile(excludePath, "utf8");
	} catch {
		// A new repository may not have an info/exclude file yet.
	}
	if (!existing.split(/\r?\n/).includes(pattern)) {
		await mkdir(dirname(excludePath), { recursive: true });
		const prefix = existing.length === 0 || existing.endsWith("\n") ? existing : `${existing}\n`;
		await writeFile(
			excludePath,
			`${prefix}# ProFlow managed workspace state\n${pattern}\n`,
			"utf8",
		);
	}
	if (!(await git(workspaceRoot, ["check-ignore", ".proflow/workspace.json"])))
		throw new PlatformError(
			"WORKSPACE_STATE_NOT_ISOLATED",
			"无法确保 .proflow 工作区状态被 Git 忽略；安装已安全停止。",
		);
	return { gitRepository: true, changed: true };
}
