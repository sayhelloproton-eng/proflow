#!/usr/bin/env node
import { spawnSync } from "node:child_process";
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
function ensureCliAndLogin() {
	const version = spawnSync("devtunnel", ["--version"], { stdio: "ignore" });
	if (version.error || version.status !== 0)
		throw new Error("未找到 devtunnel CLI，请先安装 Microsoft Dev Tunnels CLI");
	process.stdout.write("✓ 已找到 devtunnel CLI\n");
	let login = spawnSync("devtunnel", ["user", "show"], { stdio: "ignore" });
	if (login.status !== 0) {
		process.stdout.write("◆ 需要 Microsoft 登录，正在启动登录流程…\n");
		login = spawnSync("devtunnel", ["user", "login"], { stdio: "inherit" });
		if (login.status !== 0) throw new Error("Microsoft 登录未完成");
	}
	process.stdout.write("✓ Microsoft 登录已就绪\n");
}

async function selectTunnel(args: readonly string[]) {
	ensureCliAndLogin();
	let tunnelId = option(args, "--tunnel-id");
	if (!tunnelId && !process.stdin.isTTY)
		throw new Error("非交互环境必须提供 --tunnel-id");
	process.stdout.write("\n现有持久 Tunnel：\n");
	spawnSync("devtunnel", ["list"], { stdio: "inherit" });
	const prompt = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		tunnelId ||= await prompt.question("\n◆ 输入要使用的 Tunnel ID\n> ");
		const existing = spawnSync("devtunnel", ["show", tunnelId], {
			stdio: "ignore",
		});
		if (existing.status !== 0) {
			if (process.stdin.isTTY) {
				const answer = await prompt.question(
					`未找到 ${tunnelId}，现在创建？[Y/n] `,
				);
				if (answer.trim() && !/^y(es)?$/i.test(answer.trim()))
					throw new Error("尚未选择持久 Tunnel");
			}
			const created = spawnSync("devtunnel", ["create", tunnelId], {
				stdio: "inherit",
			});
			if (created.status !== 0) throw new Error("创建持久 Tunnel 失败");
		}
		process.stdout.write(`✓ 持久 Tunnel 已就绪：${tunnelId}\n`);
		return tunnelId;
	} finally {
		prompt.close();
	}
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
			ensureCliAndLogin();
			process.stdout.write("\n现有持久 Tunnel：\n");
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
	const step = args[1]?.startsWith("--") ? undefined : args[1];
	if (step === "01") {
		ensureCliAndLogin();
		process.stdout.write("→ 下一步：setup 02（选择或创建持久 Tunnel）\n");
		process.exit(0);
	}
	if (step === "02") {
		await selectTunnel(args);
		process.stdout.write("→ 下一步：setup 03（配置入口并保存公开 URL）\n");
		process.exit(0);
	}
	if (step === "04") {
		const result = await behaviorAdapter.status({ workspaceRoot });
		process.stdout.write(
			result.result.data.setupStatus === "READY"
				? "✓ Dev Tunnel 验证通过\n"
				: "✕ Dev Tunnel 尚未就绪\n",
		);
		if (result.result.data.setupStatus !== "READY") process.exitCode = 1;
		process.exit();
	}
	if (step !== undefined && step !== "03")
		throw new Error(`UNSUPPORTED_SETUP_STEP:${step}`);
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
