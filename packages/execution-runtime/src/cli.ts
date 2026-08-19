#!/usr/bin/env node
import { createFormalExecutionRuntimeLifecycle } from "./formal-process.ts";
import { loadExecutionRuntimeProcessConfig } from "./service.ts";

async function main(): Promise<void> {
	const [command, configPath] = process.argv.slice(2);
	if (command === "--help" || command === "-h") {
		process.stdout.write(
			"Usage: proflow-execution-runtime start /absolute/config.json\\n",
		);
		process.exit(0);
	}
	if (command !== "start" || !configPath)
		throw new Error(
			"Usage: proflow-execution-runtime start /absolute/config.json",
		);
	const config = await loadExecutionRuntimeProcessConfig(configPath);
	const service = createFormalExecutionRuntimeLifecycle({
		config,
		log: (entry) => process.stderr.write(`${JSON.stringify(entry)}\n`),
	});
	const address = await service.start();
	process.stdout.write(
		`${JSON.stringify({ status: "RUNNING", ...address })}\n`,
	);
	let stopping = false;
	const stop = () => {
		if (stopping) return;
		stopping = true;
		void service.stop().finally(() => process.exit(0));
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
	await new Promise(() => {});
}

if (import.meta.main) {
	await main();
}
