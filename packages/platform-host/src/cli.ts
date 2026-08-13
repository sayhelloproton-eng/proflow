#!/usr/bin/env node
import { createPlatformHost, loadPlatformHostConfig } from "./index.ts";

const [command, configPath] = process.argv.slice(2);
if (command !== "start" || !configPath)
	throw new Error("Usage: proflow-platform-host start /absolute/config.json");
const host = createPlatformHost({
	config: await loadPlatformHostConfig(configPath),
	log: (entry) => process.stderr.write(`${JSON.stringify(entry)}\n`),
});
const address = await host.start();
process.stdout.write(`${JSON.stringify({ status: "RUNNING", ...address })}\n`);
let stopping = false;
const stop = () => {
	if (stopping) return;
	stopping = true;
	void host.stop().finally(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await new Promise(() => {});
