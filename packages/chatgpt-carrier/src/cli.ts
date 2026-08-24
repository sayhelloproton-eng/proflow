#!/usr/bin/env node
import { behaviorAdapter } from "../deployment/adapter.ts";

function reportFatal(error: unknown) {
	process.stderr.write(
		`✕ 配置失败\n  ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
}
process.on("uncaughtException", reportFatal);
process.on("unhandledRejection", reportFatal);

function parseWorkspace(args: readonly string[]): string {
	let workspaceRoot = process.cwd();
	for (let index = 1; index < args.length; index += 1) {
		const value = args[index];
		if (value !== "--workspace") throw new Error(`不支持的选项 ${value}`);
		const supplied = args[index + 1];
		if (!supplied || supplied.startsWith("--"))
			throw new Error("--workspace 必须提供路径");
		workspaceRoot = supplied;
		index += 1;
	}
	return workspaceRoot;
}

const args = process.argv.slice(2);
if (args.includes("--json")) throw new Error("不支持的选项 --json");
const command = args[0] ?? "setup";
const workspaceRoot = parseWorkspace(args);
if (command === "setup") {
	const result = await behaviorAdapter.setup({ workspaceRoot });
	if (result.result.status === "SUCCEEDED")
		process.stdout.write("✓ ChatGPT Web 可访问，chatgpt-carrier setup READY\n");
	else {
		const detail =
			"actionRequired" in result.result
				? result.result.actionRequired.description
				: "ChatGPT Web 当前不可用";
		process.stdout.write(`◆ ChatGPT Web 尚未就绪\n  ${detail}\n`);
	}
} else if (command === "verify") {
	const result = await behaviorAdapter.status({ workspaceRoot });
	const ready = result.result.data.setupStatus === "READY";
	process.stdout.write(
		ready
			? "验证通过：ChatGPT Web 当前可访问。\n"
			: "验证未通过：ChatGPT Web 当前不可访问。\n",
	);
	if (!ready) process.exitCode = 1;
} else {
	throw new Error(
		"用法：proflow-chatgpt-carrier setup [--workspace <path>] | verify [--workspace <path>]",
	);
}
