#!/usr/bin/env node
import { spawnSync } from "node:child_process";
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
			process.stdout.write(
				"\nDev Tunnel 配置\n\n  脚本将检查 CLI、完成 Microsoft 登录，并协助选择或创建持久 Tunnel（隧道）。\n\n",
			);
			const version = spawnSync("devtunnel", ["--version"], {
				stdio: "ignore",
			});
			if (version.error || version.status !== 0)
				throw new Error(
					"未找到 devtunnel CLI。请先按 Microsoft Dev Tunnels 文档安装，然后重新运行本命令",
				);
			process.stdout.write("✓ 已找到 devtunnel CLI\n");
			let login = spawnSync("devtunnel", ["user", "show"], { stdio: "ignore" });
			if (login.status !== 0) {
				process.stdout.write("◆ 需要登录 Microsoft 账号，正在启动登录流程…\n");
				login = spawnSync("devtunnel", ["user", "login"], { stdio: "inherit" });
				if (login.status !== 0) throw new Error("Microsoft 登录未完成");
			}
			process.stdout.write("✓ Microsoft 登录已就绪\n\n现有持久 Tunnel：\n");
			spawnSync("devtunnel", ["list"], { stdio: "inherit" });
			tunnelId ||= await prompt.question(
				"\n◆ 输入要使用的 Tunnel ID（不存在时可创建）\n> ",
			);
			const existing = spawnSync("devtunnel", ["show", tunnelId], {
				stdio: "ignore",
			});
			if (existing.status !== 0) {
				const answer = await prompt.question(
					`未找到 ${tunnelId}，现在创建持久 Tunnel？[Y/n] `,
				);
				if (answer.trim() && !/^y(es)?$/i.test(answer.trim()))
					throw new Error("尚未选择可用的持久 Tunnel");
				const created = spawnSync("devtunnel", ["create", tunnelId], {
					stdio: "inherit",
				});
				if (created.status !== 0) throw new Error("创建持久 Tunnel 失败");
				process.stdout.write("✓ 持久 Tunnel 已创建\n");
			} else process.stdout.write("✓ 已选择现有持久 Tunnel\n");
			process.stdout.write(
				"\n请为 Platform Host 的本地端口建立映射并启动 Tunnel；devtunnel 会显示公开 HTTPS 地址。\n",
			);
			publicBaseUrl ||= await prompt.question("◆ 粘贴公开 HTTPS URL\n> ");
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
			? "\n✓ Tunnel 配置已保存\n✓ 登录与公开地址验证通过\n"
			: `\n✕ Tunnel 尚未就绪\n  ${result.result.actionRequired.description}\n`,
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
