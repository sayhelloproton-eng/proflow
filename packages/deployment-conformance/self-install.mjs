#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const [command, ...rest] = process.argv.slice(2);
const usage = "Usage: npx @tomflow/proflow-deployment-conformance install\n";
if (command === "--help" || command === "-h") {
  process.stdout.write(usage);
  process.exit(0);
}
if (command !== "install" || rest.length > 0) {
  process.stderr.write(usage);
  process.exit(2);
}
const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(executable, ["--yes", "@tomflow/proflow-platform-cli", "install", "@tomflow/proflow-deployment-conformance"], { cwd: process.cwd(), env: process.env, stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
