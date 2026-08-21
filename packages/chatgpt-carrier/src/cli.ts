#!/usr/bin/env node
import { spawn } from "node:child_process";
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
		process.stdout.write(
			"\nChatGPT Carrier 配置\n\n  1. 浏览器将打开“我的 GPT”页面。\n  2. 创建或选择用于 ProFlow 的 Custom GPT（自定义 GPT）。\n  3. 保存后复制地址栏中的 GPT URL（链接）。\n\n",
		);
		openUrl("https://chatgpt.com/gpts/mine");
		return await prompt.question(
			"◆ 请粘贴 GPT URL：https://chatgpt.com/g/...\n> ",
		);
	} finally {
		prompt.close();
	}
}
function openUrl(url: string) {
	const command =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "cmd"
				: "xdg-open";
	const parameters =
		process.platform === "win32" ? ["/c", "start", "", url] : [url];
	const child = spawn(command, parameters, { detached: true, stdio: "ignore" });
	child.unref();
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
			? "\n✓ 已保存 Carrier（承载入口）\n✓ 验证通过，可继续运行 platform setup\n"
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
