#!/usr/bin/env node
import {
	createExecutionRuntimeProcess,
	loadExecutionRuntimeProcessConfig,
} from "./service.ts";

const [command, configPath] = process.argv.slice(2);
if (command !== "start" || !configPath)
	throw new Error(
		"Usage: proflow-execution-runtime start /absolute/config.json",
	);
const service = await createExecutionRuntimeProcess({
	config: await loadExecutionRuntimeProcessConfig(configPath),
	log: (entry) => process.stderr.write(`${JSON.stringify(entry)}\n`),
});
const address = await service.start();
process.stdout.write(`${JSON.stringify({ status: "RUNNING", ...address })}\n`);
let stopping = false;
const stop = () => {
	if (stopping) return;
	stopping = true;
	void service.stop().finally(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await new Promise(() => {});
