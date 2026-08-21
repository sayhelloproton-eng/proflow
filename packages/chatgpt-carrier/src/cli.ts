#!/usr/bin/env node
import { createInterface } from "node:readline/promises";

import { behaviorAdapter } from "../deployment/adapter.ts";

function option(args: readonly string[], name: string) {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}
async function carrierUrl(args: readonly string[]): Promise<string> {
	const supplied = option(args, "--carrier-url");
	if (supplied) return supplied;
	if (!process.stdin.isTTY) throw new Error("非交互环境必须提供 --carrier-url");
	const prompt = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		return await prompt.question(
			"Custom GPT URL（https://chatgpt.com/g/...）：",
		);
	} finally {
		prompt.close();
	}
}
const args = process.argv.slice(2);
const command = args[0] ?? "setup";
const workspaceRoot = option(args, "--workspace") ?? process.cwd();
if (args.includes("--json")) throw new Error("不支持的选项 --json");
if (command === "setup") {
	const result = await behaviorAdapter.setup({
		workspaceRoot,
		input: { carrierUrl: await carrierUrl(args) },
	});
	process.stdout.write(
		result.result.status === "SUCCEEDED"
			? "Carrier 配置已保存。\n"
			: `Carrier 尚未就绪：${result.result.actionRequired.description}\n`,
	);
} else if (command === "verify") {
	const result = await behaviorAdapter.status({ workspaceRoot });
	process.stdout.write(
		result.result.data.setupStatus === "READY"
			? "验证通过。\n"
			: "验证未通过：配置尚未就绪。\n",
	);
	if (result.result.data.setupStatus !== "READY") process.exitCode = 1;
} else
	process.stdout.write(
		"用法：proflow-chatgpt-carrier setup [--carrier-url <url>] [--workspace <path>]\n       proflow-chatgpt-carrier verify [--workspace <path>]\n",
	);
