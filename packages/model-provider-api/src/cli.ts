#!/usr/bin/env node
import { createInterface } from "node:readline/promises";

import { behaviorAdapter } from "../deployment/adapter.ts";

function option(args: readonly string[], name: string) {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}
async function providerBaseUrl(args: readonly string[]): Promise<string> {
	const supplied = option(args, "--provider-base-url");
	if (supplied) return supplied;
	if (!process.stdin.isTTY)
		throw new Error("非交互环境必须提供 --provider-base-url");
	const prompt = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		return await prompt.question("模型服务 Base URL：");
	} finally {
		prompt.close();
	}
}
const args = process.argv.slice(2),
	command = args[0] ?? "setup",
	workspaceRoot = option(args, "--workspace") ?? process.cwd();
if (args.includes("--json")) throw new Error("不支持的选项 --json");
if (command === "setup") {
	const result = await behaviorAdapter.setup({
		workspaceRoot,
		input: { providerBaseUrl: await providerBaseUrl(args) },
	});
	const detail =
		"actionRequired" in result.result
			? result.result.actionRequired.description
			: "error" in result.result
				? result.result.error.message
				: "连接失败";
	process.stdout.write(
		result.result.status === "SUCCEEDED"
			? "模型服务配置已保存并验证。\n"
			: `模型服务尚未就绪：${detail}\n`,
	);
	if (result.result.status === "FAILED") process.exitCode = 1;
} else if (command === "verify") {
	const result = await behaviorAdapter.status({ workspaceRoot });
	process.stdout.write(
		result.result.data.setupStatus === "READY"
			? "验证通过。\n"
			: "验证未通过：模型服务不可用。\n",
	);
	if (result.result.data.setupStatus !== "READY") process.exitCode = 1;
} else
	process.stdout.write(
		"用法：proflow-model-provider-api setup [--provider-base-url <url>]\n",
	);
