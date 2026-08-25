#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
	behaviorAdapter,
	materializeProductionConfig,
} from "../deployment/adapter.ts";
import { parseBrowserExtensionSetupArgs } from "./configure-args.ts";
import { runInteractiveBrowserExtensionSetup } from "./install-workflow.ts";

function reportFatal(error: unknown) {
	process.stderr.write(
		`✕ 配置失败\n  ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
}
process.on("uncaughtException", reportFatal);
process.on("unhandledRejection", reportFatal);

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
		const setup = parseBrowserExtensionSetupArgs(args, process.cwd());
		await runInteractiveBrowserExtensionSetup({
			workspaceRoot: setup.workspaceRoot,
			timeoutMs: 120_000,
		});
		process.stdout.write(
			"\n✓ Chrome 浏览器扩展已连接并通过验证\n✓ execution-browser-extension setup READY\n",
		);
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
