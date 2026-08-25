import assert from "node:assert/strict";
import { test } from "node:test";

import { parseBrowserExtensionSetupArgs } from "../src/configure-args.ts";
import {
	type BrowserExtensionDesktop,
	type BrowserExtensionPair,
	runInteractiveBrowserExtensionSetup,
} from "../src/install-workflow.ts";

const loadDir = "/tmp/proflow/browser-extension";
const extensionId = "e".repeat(32);
const extensionInstanceId = "extension:minimal-user-install";

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
		return { extensionId, extensionInstanceId };
	};

	const result = await runInteractiveBrowserExtensionSetup({
		workspaceRoot: "/tmp/workspace",
		desktop,
		pair,
		timeoutMs: 2_000,
	});

	assert.deepEqual(events, [
		`copy:${loadDir}`,
		"open:chrome://extensions",
		"instruction",
	]);
	assert.deepEqual(result, { extensionId, extensionInstanceId });
	assert.match(instruction, /加载未打包的扩展程序/);
	assert.match(instruction, /完成后无需返回输入任何内容/);
	assert.match(instruction, new RegExp(loadDir.replaceAll("/", "\\/")));
	assert.doesNotMatch(
		instruction,
		/Extension ID|extensionId|Service Worker|token|endpoint|verify/,
	);
});

test("setup accepts an explicit workspace without treating it as a setup step", () => {
	const parsed = parseBrowserExtensionSetupArgs(
		["setup", "--workspace", "/tmp/proflow-workspace"],
		"/tmp/default-workspace",
	);
	assert.equal(parsed.workspaceRoot, "/tmp/proflow-workspace");
});

test("setup still rejects real unsupported positional steps", () => {
	assert.throws(
		() =>
			parseBrowserExtensionSetupArgs(
				["setup", "manual-step"],
				"/tmp/default-workspace",
			),
		/UNSUPPORTED_SETUP_STEP:manual-step/,
	);
});
