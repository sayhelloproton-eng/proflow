import { resolve } from "node:path";

export function parseBrowserExtensionSetupArgs(
	args: readonly string[],
	cwd: string,
): { workspaceRoot: string } {
	if (args[0] !== "setup") throw new Error("SETUP_COMMAND_REQUIRED");
	let workspaceRoot = resolve(cwd);
	for (let index = 1; index < args.length; index += 1) {
		const value = args[index];
		if (value === "--workspace") {
			const workspace = args[index + 1];
			if (!workspace || workspace.startsWith("--")) {
				throw new Error("MISSING_WORKSPACE_VALUE");
			}
			workspaceRoot = resolve(workspace);
			index += 1;
			continue;
		}
		if (value?.startsWith("--")) {
			throw new Error(`UNSUPPORTED_SETUP_OPTION:${value}`);
		}
		throw new Error(`UNSUPPORTED_SETUP_STEP:${value}`);
	}
	return { workspaceRoot };
}
