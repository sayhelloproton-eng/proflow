#!/usr/bin/env node
import { createPlatformHost, loadPlatformHostConfig } from "./index.ts";

async function main(): Promise<void> {
	const [command, configPath] = process.argv.slice(2);
	if (command === "--help" || command === "-h") {
		process.stdout.write(
			"Usage: proflow-platform-host start /absolute/config.json\\n",
		);
		process.exit(0);
	}
	if (command !== "start" || !configPath)
		throw new Error("Usage: proflow-platform-host start /absolute/config.json");
	const config = await loadPlatformHostConfig(configPath);
	if (!config.gatewayTransportCredentialFile)
		throw new Error(
			"platform-host requires gatewayTransportCredentialFile for authenticated Gateway transport",
		);
	if (!config.modelTransportCredentialFile)
		throw new Error(
			"platform-host requires modelTransportCredentialFile for authenticated Model Runtime transport",
		);
	if (!config.executionTransportCredentialFile)
		throw new Error(
			"platform-host requires executionTransportCredentialFile for authenticated Execution Runtime transport",
		);
	const host = createPlatformHost({
		config,
		log: (entry) => process.stderr.write(`${JSON.stringify(entry)}\n`),
	});
	const address = await host.start();
	process.stdout.write(
		`${JSON.stringify({ status: "RUNNING", ...address })}\n`,
	);
	let stopping = false;
	const stop = () => {
		if (stopping) return;
		stopping = true;
		void host.stop().finally(() => process.exit(0));
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
	await new Promise(() => {});
}

if (import.meta.main) {
	await main();
}
