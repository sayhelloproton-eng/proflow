#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import {
	behaviorAdapter,
	materializeProductionConfig,
} from "../deployment/adapter.ts";

function workspaceFromArgs(args: string[]): string {
	if (args[0] !== "materialize-config") {
		throw new Error(
			"Usage: proflow-execution-browser-extension materialize-config [--workspace /absolute/path]",
		);
	}
	const workspaceIndex = args.indexOf("--workspace");
	if (workspaceIndex < 0) return process.cwd();
	const value = args[workspaceIndex + 1];
	if (!value || args.length !== 3) {
		throw new Error(
			"Usage: proflow-execution-browser-extension materialize-config [--workspace /absolute/path]",
		);
	}
	return resolve(value);
}

export async function materializeBrowserExtensionConfig(
	workspaceRoot: string,
): Promise<{ loadDir: string }> {
	const configPath = resolve(
		workspaceRoot,
		".proflow",
		"config",
		"execution-browser-extension.json",
	);
	const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"));
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("execution-browser-extension config must be a JSON object");
	}
	const config = Object.fromEntries(
		Object.entries(parsed).map(([key, value]) => {
			if (typeof value !== "string") {
				throw new Error(`browser extension config ${key} must be a string`);
			}
			return [key, value];
		}),
	);
	return materializeProductionConfig({
		moduleRef: "execution-browser-extension",
		config,
		workspaceRoot,
	});
}

function openChromeExtensions() {
	const url = "chrome://extensions";
	const command =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "cmd"
				: "xdg-open";
	const parameters =
		process.platform === "darwin"
			? ["-a", "Google Chrome", url]
			: process.platform === "win32"
				? ["/c", "start", "", url]
				: [url];
	const child = spawn(command, parameters, { detached: true, stdio: "ignore" });
	child.unref();
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.includes("--json")) throw new Error("不支持的选项 --json");
	const option = (name: string) => {
		const index = args.indexOf(name);
		return index >= 0 ? args[index + 1] : undefined;
	};
	const workspaceRoot = option("--workspace")
		? resolve(option("--workspace") as string)
		: process.cwd();
	if (args[0] === "setup") {
		let extensionId = option("--extension-id");
		if (!extensionId && !process.stdin.isTTY)
			throw new Error("非交互环境必须提供 --extension-id");
		if (!extensionId) {
			const prepared = await behaviorAdapter.install({ workspaceRoot });
			const loadDir = String(prepared.result.data.loadDir);
			const prompt = createInterface({
				input: process.stdin,
				output: process.stdout,
			});
			try {
				process.stdout.write(
					`\nChrome 扩展配置\n\n  1. 已准备扩展目录：${loadDir}\n  2. 在 Chrome 打开“扩展程序”，启用“开发者模式”。\n  3. 点击“加载已解压的扩展程序”，选择上面的目录。\n  4. 确认 Service Worker（后台服务）显示正常，再复制扩展 ID。\n\n`,
				);
				openChromeExtensions();
				extensionId = await prompt.question(
					"◆ Chrome Extension ID（32 位小写字母）\n> ",
				);
			} finally {
				prompt.close();
			}
		}
		const result = await behaviorAdapter.setup({
			workspaceRoot,
			input: { extensionId, serviceWorker: "RUNNING" },
		});
		process.stdout.write(
			result.result.status === "SUCCEEDED"
				? "\n✓ Extension ID 已保存\n✓ Service Worker 运行证据已记录\n"
				: "\n✕ 浏览器扩展尚未就绪，请检查扩展错误后重试。\n",
		);
		if (result.result.status === "FAILED") process.exitCode = 1;
		return;
	}
	if (args[0] === "verify") {
		const result = await behaviorAdapter.status({ workspaceRoot });
		process.stdout.write(
			result.result.data.setupStatus === "READY"
				? "验证通过。\n"
				: "验证未通过：扩展尚未就绪。\n",
		);
		if (result.result.data.setupStatus !== "READY") process.exitCode = 1;
		return;
	}
	const legacyWorkspaceRoot = workspaceFromArgs(args);
	const result = await materializeBrowserExtensionConfig(legacyWorkspaceRoot);
	process.stdout.write(`浏览器扩展配置已生成：${result.loadDir}\n`);
}

if (import.meta.main) await main();
