#!/usr/bin/env node
import { createInterface } from "node:readline/promises";

import { behaviorAdapter } from "../deployment/adapter.ts";
import {
	createModelRuntimeProcess,
	loadModelRuntimeProcessConfig,
} from "./process.ts";

function reportFatal(error: unknown) {
	process.stderr.write(
		`✕ 配置失败\n  ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
}
process.on("uncaughtException", reportFatal);
process.on("unhandledRejection", reportFatal);

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const [command, configPath] = args;
	const option = (name: string) => {
		const index = args.indexOf(name);
		return index >= 0 ? args[index + 1] : undefined;
	};
	if (args.includes("--json")) throw new Error("不支持的选项 --json");
	if (command === "--help" || command === "-h") {
		process.stdout.write(
			"用法：proflow-model-runtime setup\n      proflow-model-runtime verify\n      proflow-model-runtime start /absolute/config.json\n\n仅当能力证据无法消除等价候选时，setup 才接受 --fast-model 或 --reason-model。\n",
		);
		return;
	}
	if (command === "setup") {
		const workspaceRoot = option("--workspace") ?? process.cwd();
		const supplied = {
			...(option("--fast-model") ? { fastModel: option("--fast-model") } : {}),
			...(option("--reason-model")
				? { reasonModel: option("--reason-model") }
				: {}),
		};
		process.stdout.write(
			"\n模型能力\n\n正在读取 Provider model inventory……\n正在验证 FAST / REASON 能力……\n",
		);
		let result = await behaviorAdapter.setup({
			workspaceRoot,
			...(Object.keys(supplied).length > 0 ? { input: supplied } : {}),
		});
		if (
			result.result.status === "ACTION_REQUIRED" &&
			result.result.actionRequired?.action.startsWith("select-") &&
			process.stdin.isTTY
		) {
			const role = result.result.actionRequired.action.includes("fast")
				? "fast"
				: "reason";
			const prompt = createInterface({
				input: process.stdin,
				output: process.stdout,
			});
			try {
				process.stdout.write(`\n${result.result.actionRequired.description}\n`);
				const selected = await prompt.question(
					`◆ 请选择 ${role.toUpperCase()} 候选\n> `,
				);
				result = await behaviorAdapter.setup({
					workspaceRoot,
					input:
						role === "fast"
							? { fastModel: selected }
							: { reasonModel: selected },
				});
			} finally {
				prompt.close();
			}
		}
		if (result.result.status === "SUCCEEDED")
			process.stdout.write(
				"\n✓ FAST 已自动配置\n✓ REASON 已自动配置\n\n模型能力：READY\n",
			);
		else {
			const detail =
				"actionRequired" in result.result
					? result.result.actionRequired.description
					: "error" in result.result
						? result.result.error.message
						: "模型能力尚未就绪";
			process.stdout.write(`\n模型能力尚未就绪。\n${detail}\n`);
			if (result.result.status === "FAILED") process.exitCode = 1;
		}
		return;
	}
	if (command === "verify") {
		const result = await behaviorAdapter.status({
			workspaceRoot: option("--workspace") ?? process.cwd(),
		});
		process.stdout.write(
			result.result.data.setupStatus === "READY"
				? `模型能力：READY\n本地 Runtime：${result.result.data.runtimeStatus}\n`
				: `模型能力：${result.result.data.setupStatus}\n${result.result.data.issues?.[0]?.message ?? "模型能力尚未就绪"}\n`,
		);
		if (result.result.data.setupStatus !== "READY") process.exitCode = 1;
		return;
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

if (import.meta.main) await main();
