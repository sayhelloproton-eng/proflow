#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";

import { behaviorAdapter } from "../deployment/adapter.ts";

function reportFatal(error: unknown) {
	process.stderr.write(
		`✕ 配置失败\n  ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
}
process.on("uncaughtException", reportFatal);
process.on("unhandledRejection", reportFatal);

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
	const step = args[1]?.startsWith("--") ? undefined : args[1];
	if (step === "02") {
		if (!process.stdin.isTTY && !args.includes("--confirm-capabilities"))
			throw new Error("非交互环境必须提供 --confirm-capabilities");
		let confirmed = args.includes("--confirm-capabilities");
		if (!confirmed) {
			const prompt = createInterface({
				input: process.stdin,
				output: process.stdout,
			});
			try {
				process.stdout.write(
					"\nCarrier 能力检查 · Step 02/03\n\n  请在 Custom GPT 编辑页确认：\n  • Actions 已启用并保存 OpenAPI\n  • Bearer 认证已配置\n  • File Bridge / Code Interpreter / Web Search 符合角色要求\n  • 使用 Actions 时 Apps 已关闭\n\n",
				);
				confirmed = /^y(es)?$/i.test(
					(await prompt.question("◆ 已逐项确认？[y/N] ")).trim(),
				);
			} finally {
				prompt.close();
			}
		}
		if (!confirmed) throw new Error("CARRIER_CAPABILITIES_NOT_CONFIRMED");
		const result = await behaviorAdapter.setup({
			workspaceRoot,
			input: {
				verification: {
					reachable: "VERIFIED",
					actionsEnabled: "VERIFIED",
					openApiInstalled: "VERIFIED",
					actionAuthValid: "VERIFIED",
					fileBridge: "VERIFIED",
					codeInterpreter: "VERIFIED",
					webSearch: "VERIFIED",
					appsDisabledWhenRequired: "VERIFIED",
				},
			},
		});
		process.stdout.write(
			result.result.status === "SUCCEEDED"
				? "\n✓ Carrier 能力已记录并验证\n→ 下一步：setup 03\n"
				: "\n◆ 能力已记录；Carrier URL 仍需修复或验证。\n",
		);
		process.exit(0);
	}
	if (step === "03") {
		const result = await behaviorAdapter.status({ workspaceRoot });
		process.stdout.write(
			result.result.data.setupStatus === "READY"
				? "\n✓ Carrier URL 与能力验证通过\n"
				: "\n✕ Carrier 尚未就绪，请从未完成步骤继续。\n",
		);
		if (result.result.data.setupStatus !== "READY") process.exitCode = 1;
		process.exit();
	}
	if (step !== undefined && step !== "01")
		throw new Error(`UNSUPPORTED_SETUP_STEP:${step}`);
	const result = await behaviorAdapter.setup({
		workspaceRoot,
		input: { carrierUrl: await carrierUrl(args) },
	});
	process.stdout.write(
		result.result.status === "SUCCEEDED"
			? "\n✓ 已保存并验证 Carrier\n"
			: "\n✓ Carrier URL 已保存\n→ 下一步：setup 02（检查 Carrier 能力）\n",
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
