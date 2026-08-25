import { spawn, spawnSync } from "node:child_process";

import { pairBrowserExtensionSetup } from "../deployment/adapter.ts";

export type BrowserExtensionDesktop = {
	copyText(value: string): void | Promise<void>;
	openExtensionsPage(): void | Promise<void>;
	showInstruction(message: string): void | Promise<void>;
};

export type BrowserExtensionPair = (
	context: { workspaceRoot: string },
	options: {
		timeoutMs?: number;
		onWaiting?: (input: {
			loadDir: string;
			endpoint: string;
		}) => void | Promise<void>;
	},
) => Promise<{ extensionId: string; extensionInstanceId: string }>;

export function browserExtensionInstallInstruction(loadDir: string): string {
	return `\nChrome 浏览器扩展\n\nProFlow 已准备好扩展文件，并已复制安装目录：\n${loadDir}\n\n请在已经打开的 Chrome 扩展管理页完成以下安装操作：\n1. 如果“开发者模式”尚未开启，请开启\n2. 点击“加载未打包的扩展程序”\n3. 在目录选择窗口中粘贴并确认刚刚复制的目录\n\n完成后无需返回输入任何内容。ProFlow 会自动检测扩展并继续。\n`;
}

export function browserExtensionSetupSuccessMessage(): string {
	return "\n✓ Chrome 浏览器扩展已连接\n✓ 配置与真实 heartbeat 验证通过\n\n浏览器扩展：READY\n";
}

export function browserExtensionSetupFailureMessage(error: unknown): string {
	const detail = error instanceof Error ? error.message : String(error);
	if (detail === "PAIRING_TIMEOUT") {
		return "✕ 暂未检测到浏览器扩展连接\n\n请确认扩展已经在 Chrome 中完成加载。已准备好的扩展文件和机器配置不会丢失。\n下一步：重新执行 platform setup\n错误代码：PAIRING_TIMEOUT\n";
	}
	const code = /^[A-Z][A-Z0-9_:-]*$/.test(detail)
		? detail
		: "BROWSER_EXTENSION_SETUP_FAILED";
	return `✕ 浏览器扩展配置失败\n\n详情：${detail}\n错误代码：${code}\n`;
}

function systemDesktop(): BrowserExtensionDesktop {
	return {
		copyText(value) {
			const command =
				process.platform === "darwin"
					? "pbcopy"
					: process.platform === "win32"
						? "clip"
						: "xclip";
			const parameters =
				process.platform === "linux" ? ["-selection", "clipboard"] : [];
			spawnSync(command, parameters, { input: value, encoding: "utf8" });
		},
		openExtensionsPage() {
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
			const child = spawn(command, parameters, {
				detached: true,
				stdio: "ignore",
			});
			child.unref();
		},
		showInstruction(message) {
			process.stdout.write(message);
		},
	};
}

export async function runInteractiveBrowserExtensionSetup(input: {
	workspaceRoot: string;
	timeoutMs?: number;
	desktop?: BrowserExtensionDesktop;
	pair?: BrowserExtensionPair;
}) {
	const desktop = input.desktop ?? systemDesktop();
	const pair = input.pair ?? pairBrowserExtensionSetup;
	return pair(
		{ workspaceRoot: input.workspaceRoot },
		{
			timeoutMs: input.timeoutMs ?? 120_000,
			async onWaiting({ loadDir }) {
				await desktop.copyText(loadDir);
				await desktop.openExtensionsPage();
				await desktop.showInstruction(
					browserExtensionInstallInstruction(loadDir),
				);
			},
		},
	);
}
