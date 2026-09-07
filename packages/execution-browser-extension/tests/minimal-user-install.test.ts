import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";

import {
	type BrowserExtensionDesktop,
	type BrowserExtensionPair,
	browserExtensionSetupFailureMessage,
	browserExtensionSetupSuccessMessage,
	runInteractiveBrowserExtensionSetup,
} from "../src/install-workflow.ts";

const loadDir = "/tmp/proflow/browser-extension";
const extensionId = "e".repeat(32);
const extensionInstanceId = "extension:minimal-user-install";

test("browser deployment exposes no separate package management CLI", async () => {
	const metadata = JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), "utf8"),
	) as Record<string, unknown>;
	const exports = metadata.exports as Record<string, unknown>;
	const setupGuide = await readFile(
		new URL("../SETUP.md", import.meta.url),
		"utf8",
	);
	const adapter = await readFile(
		new URL("../deployment/adapter.ts", import.meta.url),
		"utf8",
	);
	assert.equal("bin" in metadata, false);
	assert.equal("./configure" in exports, false);
	assert.doesNotMatch(
		`${setupGuide}\n${adapter}`,
		/proflow-execution-browser-extension\s+(?:setup|verify)/,
	);
	assert.match(setupGuide, /platform setup/);
	assert.doesNotMatch(setupGuide, /--module/);
	assert.match(setupGuide, /Verify: `platform status`/);
	for (const source of ["../src/configure.ts", "../src/configure-args.ts"])
		await assert.rejects(
			() => access(new URL(source, import.meta.url)),
			(error: unknown) =>
				typeof error === "object" &&
				error !== null &&
				Reflect.get(error, "code") === "ENOENT",
		);
});

test("browser install workflow exposes one human installation confirmation", async () => {
	const events: string[] = [];
	let instruction = "";
	const desktop: BrowserExtensionDesktop = {
		copyText(value) {
			events.push(`copy:${value}`);
		},
		openExtensionsPage() {
			events.push("open:chrome://extensions");
		},
		showInstruction(message) {
			events.push("instruction");
			instruction = message;
		},
	};

	const pair: BrowserExtensionPair = async (_context, options) => {
		await options.onWaiting?.({
			loadDir,
			endpoint: "http://127.0.0.1:43100",
		});
		return {
			extensionId,
			extensionInstanceId,
			moduleVersion: "test-browser-module-version",
		};
	};

	const result = await runInteractiveBrowserExtensionSetup({
		workspaceRoot: "/tmp/workspace",
		desktop,
		pair,
		timeoutMs: 2_000,
	});

	assert.deepEqual(events, [`copy:${loadDir}`, "instruction"]);
	assert.deepEqual(result, {
		extensionId,
		extensionInstanceId,
		moduleVersion: "test-browser-module-version",
	});
	assert.match(instruction, /加载未打包的扩展程序/);
	assert.match(instruction, /扩展目录已复制到剪贴板/);
	assert.match(instruction, /Cmd\+Shift\+G/);
	assert.match(instruction, /Cmd\+V/);
	assert.match(instruction, /步骤 2\/2/);
	assert.doesNotMatch(instruction, /开发者模式/);
	assert.match(instruction, /完成后无需返回终端输入内容/);
	assert.match(instruction, new RegExp(loadDir.replaceAll("/", "\\/")));
	assert.doesNotMatch(
		instruction,
		/Extension ID|extensionId|Service Worker|token|endpoint|verify/,
	);
});

test("setup output is human-readable and keeps stable AI recovery semantics", () => {
	const success = browserExtensionSetupSuccessMessage();
	assert.match(success, /浏览器扩展：READY/);
	assert.match(success, /真实 heartbeat 验证通过/);
	assert.doesNotMatch(success, /extensionId|token|endpoint/);

	const timeout = browserExtensionSetupFailureMessage(
		new Error("PAIRING_TIMEOUT"),
	);
	assert.match(timeout, /暂未检测到浏览器扩展连接/);
	assert.match(timeout, /重新执行 platform setup/);
	assert.match(timeout, /再次复制路径|重新打开 Chrome|显示完整路径/);
	assert.match(timeout, /错误代码：PAIRING_TIMEOUT/);
	assert.doesNotMatch(timeout, /Extension ID|token|endpoint/);
});
