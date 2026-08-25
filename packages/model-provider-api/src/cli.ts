#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
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

async function credentialFromFile(path: string): Promise<string> {
	const absolute = resolve(path);
	const info = await stat(absolute);
	if (process.platform !== "win32" && (info.mode & 0o077) !== 0)
		throw new TypeError("模型服务凭据文件必须仅允许文件所有者读取");
	const credential = (await readFile(absolute, "utf8")).trim();
	if (!credential) throw new TypeError("模型服务凭据文件为空");
	return credential;
}

async function hiddenCredential(): Promise<string> {
	if (!process.stdin.isTTY || !process.stdin.setRawMode)
		throw new TypeError(
			"认证存在时，非交互环境必须提供 --provider-credential-file",
		);
	process.stdout.write("◆ 模型服务访问凭据（输入不可见）\n> ");
	return new Promise<string>((resolveCredential, reject) => {
		let value = "";
		const restore = () => {
			process.stdin.removeListener("data", onData);
			process.stdin.setRawMode(false);
			process.stdin.pause();
			process.stdout.write("\n");
		};
		const onData = (chunk: Buffer) => {
			for (const character of chunk.toString("utf8")) {
				if (character === "\u0003") {
					restore();
					reject(new Error("用户取消凭据输入"));
					return;
				}
				if (character === "\r" || character === "\n") {
					restore();
					if (!value) reject(new TypeError("模型服务凭据不能为空"));
					else resolveCredential(value);
					return;
				}
				if (character === "\u007f") value = value.slice(0, -1);
				else if (character >= " ") value += character;
			}
		};
		process.stdin.setRawMode(true);
		process.stdin.resume();
		process.stdin.on("data", onData);
	});
}

async function promptEndpoint(): Promise<string> {
	if (!process.stdin.isTTY)
		throw new TypeError(
			"非交互环境必须提供 --provider-base-url <url>，该 URL 由部署层解析后传入模型 Provider",
		);
	const prompt = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		return (
			await prompt.question("◆ OpenAI-compatible 模型服务 URL\n> ")
		).trim();
	} finally {
		prompt.close();
	}
}

const args = process.argv.slice(2);
const command = args[0] ?? "setup";
const workspaceRoot = option(args, "--workspace") ?? process.cwd();
if (args.includes("--json")) throw new Error("不支持的选项 --json");

if (command === "setup") {
	let providerBaseUrl = option(args, "--provider-base-url");
	let result = await behaviorAdapter.setup({
		workspaceRoot,
		...(providerBaseUrl ? { input: { providerBaseUrl } } : {}),
	});
	if (
		result.result.status === "ACTION_REQUIRED" &&
		result.result.actionRequired?.action === "provide-provider-endpoint"
	) {
		providerBaseUrl = await promptEndpoint();
		result = await behaviorAdapter.setup({
			workspaceRoot,
			input: { providerBaseUrl },
		});
	}
	if (
		result.result.status === "ACTION_REQUIRED" &&
		result.result.actionRequired?.action === "provide-provider-credential"
	) {
		const file = option(args, "--provider-credential-file");
		const providerCredential = file
			? await credentialFromFile(file)
			: await hiddenCredential();
		result = await behaviorAdapter.setup({
			workspaceRoot,
			input: {
				...(providerBaseUrl ? { providerBaseUrl } : {}),
				providerCredential,
			},
		});
	}
	if (result.result.status === "SUCCEEDED") {
		process.stdout.write(
			"\n✓ OpenAI-compatible 模型服务验证通过\n模型服务：READY\n",
		);
	} else {
		const detail =
			"actionRequired" in result.result
				? result.result.actionRequired.description
				: "error" in result.result
					? result.result.error.message
					: "模型服务尚未就绪";
		process.stdout.write(`\n模型服务尚未就绪。\n\n${detail}\n`);
		if (result.result.status === "FAILED") process.exitCode = 1;
	}
} else if (command === "verify") {
	const result = await behaviorAdapter.status({ workspaceRoot });
	if (result.result.data.setupStatus === "READY")
		process.stdout.write("模型服务：READY\n");
	else {
		process.stdout.write(
			`模型服务：${result.result.data.setupStatus}\n${result.result.data.issues?.[0]?.message ?? "模型服务尚未就绪"}\n`,
		);
		process.exitCode = 1;
	}
} else {
	process.stdout.write(
		"用法：proflow-model-provider-api setup [--provider-base-url <url>] [--provider-credential-file <path>]\n      proflow-model-provider-api verify\n",
	);
}
