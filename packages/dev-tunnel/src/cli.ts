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

function option(args: readonly string[], name: string) {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const command = args[0] ?? "setup";
const workspaceRoot = option(args, "--workspace") ?? process.cwd();

for (const forbidden of ["--tunnel-id", "--public-base-url", "--port"])
	if (args.includes(forbidden))
		throw new Error(`${forbidden} 已移除；Dev Tunnel setup 不接受用户配置`);

if (command === "setup") {
	const step = args[1]?.startsWith("--") ? undefined : args[1];
	if (step !== undefined)
		throw new Error("分步 setup 01..04 已移除；请直接运行 setup");
	process.stdout.write(
		"正在自动准备 Microsoft Dev Tunnel；若登录失效，浏览器将打开 GitHub 授权页。\n",
	);
	const setup = await behaviorAdapter.setup({ workspaceRoot });
	if (setup.result.status === "SUCCEEDED") {
		process.stdout.write("✓ Dev Tunnel 已自动配置并发布公开入口\n");
	} else {
		process.stderr.write(
			`✕ Dev Tunnel 自动配置失败\n  ${setup.result.error?.message ?? "unknown setup failure"}\n`,
		);
		process.exitCode = 1;
	}
} else if (command === "verify") {
	const status = await behaviorAdapter.status({ workspaceRoot });
	if (status.result.data.setupStatus === "READY") {
		process.stdout.write("验证通过。\n");
	} else {
		process.stderr.write("验证未通过：配置尚未就绪。\n");
		process.exitCode = 1;
	}
} else {
	process.stdout.write(
		"用法：proflow-dev-tunnel setup [--workspace <path>] | verify [--workspace <path>]\n",
	);
}
