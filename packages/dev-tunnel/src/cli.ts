#!/usr/bin/env node
import { createInterface } from "node:readline/promises";

import { behaviorAdapter } from "../deployment/adapter.ts";

function option(args: readonly string[], name: string) {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}
async function inputs(args: readonly string[]) {
	let tunnelId = option(args, "--tunnel-id"),
		publicBaseUrl = option(args, "--public-base-url");
	if ((!tunnelId || !publicBaseUrl) && !process.stdin.isTTY)
		throw new Error("非交互环境必须提供 --tunnel-id 和 --public-base-url");
	if (!tunnelId || !publicBaseUrl) {
		const prompt = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		try {
			tunnelId ||= await prompt.question("Tunnel ID：");
			publicBaseUrl ||= await prompt.question("公开 HTTPS URL：");
		} finally {
			prompt.close();
		}
	}
	return { tunnelId, publicBaseUrl };
}
const args = process.argv.slice(2),
	command = args[0] ?? "setup",
	workspaceRoot = option(args, "--workspace") ?? process.cwd();
if (args.includes("--json")) throw new Error("不支持的选项 --json");
if (command === "setup") {
	const result = await behaviorAdapter.setup({
		workspaceRoot,
		input: await inputs(args),
	});
	process.stdout.write(
		result.result.status === "SUCCEEDED"
			? "Tunnel 配置已保存。\n"
			: `Tunnel 尚未就绪：${result.result.actionRequired.description}\n`,
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
		"用法：proflow-dev-tunnel setup [--tunnel-id <id> --public-base-url <url>]\n",
	);
