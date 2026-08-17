#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
	createModelRuntimeProcess,
	loadModelRuntimeProcessConfig,
} from "./process.ts";

function installSelf(): never {
	const executable = process.platform === "win32" ? "platform.cmd" : "platform";
	const result = spawnSync(
		executable,
		["install", "@tomflow/proflow-model-runtime", "--workspace", process.cwd()],
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
			"Usage: proflow-model-runtime install | start /absolute/config.json\\n",
		);
		process.exit(0);
	}
	if (command === "install") {
		if (configPath) throw new Error("Usage: proflow-model-runtime install");
		installSelf();
	}
	if (command !== "start" || !configPath)
		throw new Error("Usage: proflow-model-runtime start /absolute/config.json");
	const config = await loadModelRuntimeProcessConfig(configPath);
	if (!config.transportCredentialFile)
		throw new Error(
			"formal model-runtime requires transportCredentialFile for authenticated local callers",
		);
	const service = await createModelRuntimeProcess({
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
