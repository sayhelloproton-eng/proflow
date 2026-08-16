#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
	createAgentGatewayProcess,
	loadAgentGatewayProcessConfig,
} from "./process.ts";

function installSelf(): never {
	const executable = process.platform === "win32" ? "npx.cmd" : "npx";
	const result = spawnSync(
		executable,
		["--yes", "@tomflow/proflow-platform-cli", "install", "@tomflow/proflow-agent-gateway"],
		{ cwd: process.cwd(), env: process.env, stdio: "inherit" },
	);
	if (result.error) throw result.error;
	process.exit(result.status ?? 1);
}

const [command, configPath] = process.argv.slice(2);
if (command === "install") {
	if (configPath) throw new Error("Usage: proflow-agent-gateway install");
	installSelf();
}
if (command !== "start" || !configPath)
	throw new Error("Usage: proflow-agent-gateway start /absolute/config.json");
const config = await loadAgentGatewayProcessConfig(configPath);
if (!config.downstreamCredentialFile)
	throw new Error(
		"agent-gateway requires downstreamCredentialFile for authenticated platform-host transport",
	);
const processService = await createAgentGatewayProcess({
	config,
	log: (entry) => process.stderr.write(`${JSON.stringify(entry)}\n`),
});
const address = await processService.start();
process.stdout.write(`${JSON.stringify({ status: "RUNNING", ...address })}\n`);
let stopping = false;
const stop = () => {
	if (stopping) return;
	stopping = true;
	void processService.stop().finally(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await new Promise(() => {});
