#!/usr/bin/env node
import {
	createAgentGatewayProcess,
	loadAgentGatewayProcessConfig,
} from "./process.ts";

async function main(): Promise<void> {
	const [command, configPath] = process.argv.slice(2);
	if (command === "--help" || command === "-h") {
		process.stdout.write(
			"Usage: proflow-agent-gateway start /absolute/config.json\\n",
		);
		process.exit(0);
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
	process.stdout.write(
		`${JSON.stringify({ status: "RUNNING", ...address })}\n`,
	);
	let stopping = false;
	const stop = () => {
		if (stopping) return;
		stopping = true;
		void processService.stop().finally(() => process.exit(0));
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
	await new Promise(() => {});
}

if (import.meta.main) {
	await main();
}
