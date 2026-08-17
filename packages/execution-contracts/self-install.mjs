#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const [command, ...rest] = process.argv.slice(2);
const usage = "Usage: npx @tomflow/proflow-execution-contracts install\n";
if (command === "--help" || command === "-h") {
	process.stdout.write(usage);
	process.exit(0);
}
if (command !== "install" || rest.length > 0) {
	process.stderr.write(usage);
	process.exit(2);
}
const executable = process.platform === "win32" ? "platform.cmd" : "platform";
const result = spawnSync(
	executable,
	[
		"install",
		"@tomflow/proflow-execution-contracts",
		"--workspace",
		process.cwd(),
	],
	{ cwd: process.cwd(), env: process.env, stdio: "inherit" },
);
if (result.error) {
	if (result.error.code === "ENOENT") {
		process.stderr.write(
			"GLOBAL_PLATFORM_CLI_REQUIRED: install @tomflow/proflow-platform-cli globally before package-owned install\n",
		);
		process.exit(127);
	}
	throw result.error;
}
process.exit(result.status ?? 1);
