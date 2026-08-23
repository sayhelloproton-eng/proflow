import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";

import { descriptor } from "../deployment/descriptor.ts";

test("CP-EXE-BR-15 deployment provisioning uses an isolated GPT editor content script", async () => {
	const manifest = JSON.parse(
		await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
	) as {
		content_scripts: Array<{ matches: string[]; js: string[] }>;
	};
	const runtime = manifest.content_scripts.find((item) =>
		item.matches.includes("https://chatgpt.com/g/*"),
	);
	const provisioning = manifest.content_scripts.find((item) =>
		item.matches.includes("https://chatgpt.com/gpts/editor/*"),
	);
	assert.deepEqual(runtime?.js, ["dist/extension/content.js"]);
	assert.deepEqual(provisioning?.js, [
		"dist/extension/provisioning-content.js",
	]);
	await access(
		new URL("../extension/provisioning-content.ts", import.meta.url),
	);
});

test("CP-EXE-BR-15 provisioning surface has no Task/Worker runtime business vocabulary", async () => {
	const source = await readFile(
		new URL("../extension/provisioning-content.ts", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(
		source,
		/TaskObserver|SystemObserver|Collaboration|taskId|nodeId|workerRef|conversationLocator|executionRef|WAKE_WORKER|CREATE_CONVERSATION/,
	);
});

test("CP-EXE-BR-15 descriptor exposes deployment provisioning as a separate capability", () => {
	assert.deepEqual(descriptor.provides, [
		{ contractRef: "execution-browser-executor", version: "1.0.0" },
		{ contractRef: "custom-gpt-web-provisioning", version: "1.0.0" },
	]);
});
