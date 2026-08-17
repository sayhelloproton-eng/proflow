#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createPlatformHost, loadPlatformHostConfig } from "./index.ts";

function installSelf(): never {
	const executable = process.platform === "win32" ? "platform.cmd" : "platform";
	const result = spawnSync(
		executable,
		["install", "@tomflow/proflow-platform-host", "--workspace", process.cwd()],
		{ cwd: process.cwd(), env: process.env, stdio: "inherit" },
	);
	if (result.error) {
		if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
			process.stderr.write(
				"GLOBAL_PLATFORM_CLI_REQUIRED: install @tomflow/proflow-platform-cli globally before package-owned install\n",
			);
			process.exit(127);
		}
		throw result.error;
	}
	process.exit(result.status ?? 1);
}

async function main(): Promise<void> {
	const [command, configPath] = process.argv.slice(2);
	if (command === "--help" || command === "-h") {
		process.stdout.write(
			"Usage: proflow-platform-host install | start /absolute/config.json\\n",
		);
		process.exit(0);
	}
	if (command === "install") {
		if (configPath) throw new Error("Usage: proflow-platform-host install");
		installSelf();
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
