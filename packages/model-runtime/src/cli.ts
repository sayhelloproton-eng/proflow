#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { behaviorAdapter } from "../deployment/adapter.ts";
import {
	createModelRuntimeProcess,
	loadModelRuntimeProcessConfig,
} from "./process.ts";

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
			"用法：proflow-model-runtime setup [--fast-model <id> --reason-model <id>]\n      proflow-model-runtime verify\n      proflow-model-runtime start /absolute/config.json\n",
		);
		process.exit(0);
	}
	if (command === "setup") {
		let fastModel = option("--fast-model"),
			reasonModel = option("--reason-model");
		if ((!fastModel || !reasonModel) && !process.stdin.isTTY)
			throw new Error("非交互环境必须提供 --fast-model 和 --reason-model");
		if (!fastModel || !reasonModel) {
			const prompt = createInterface({
				input: process.stdin,
				output: process.stdout,
			});
			try {
				process.stdout.write(
					"\n模型角色配置\n\n  FAST（快速模型）处理低延迟任务。\n  REASON（推理模型）处理复杂分析任务。\n  输入 Provider（模型服务商）实际提供的模型 ID。\n\n",
				);
				fastModel ||= await prompt.question("◆ FAST 模型 ID\n> ");
				reasonModel ||= await prompt.question("◆ REASON 模型 ID\n> ");
			} finally {
				prompt.close();
			}
		}
		const result = await behaviorAdapter.setup({
			workspaceRoot: option("--workspace") ?? process.cwd(),
			input: { fastModel, reasonModel },
		});
		process.stdout.write(
			result.result.status === "SUCCEEDED"
				? "\n✓ 两个模型角色已保存\n✓ Provider 探测与角色验证通过\n"
				: "\n✕ 模型角色尚未就绪\n  请先运行 proflow-model-provider-api setup\n",
		);
		if (result.result.status === "FAILED") process.exitCode = 1;
		return;
	}
	if (command === "verify") {
		const result = await behaviorAdapter.status({
			workspaceRoot: option("--workspace") ?? process.cwd(),
		});
		process.stdout.write(
			result.result.data.setupStatus === "READY"
				? "验证通过。\n"
				: "验证未通过：配置尚未就绪。\n",
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

if (import.meta.main) {
	await main();
}
