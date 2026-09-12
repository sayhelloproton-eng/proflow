import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { containsSubmittedFingerprint } from "../src/submitted-message.ts";

test("CP-EXE-BR-03 submitted-message reality ignores composer and assistant text", () => {
	const fingerprint = "wake:task-1:node-1:1:NODE_READY:none";
	assert.equal(
		containsSubmittedFingerprint(
			[
				{ authorRole: null, textContent: fingerprint },
				{ authorRole: "assistant", textContent: fingerprint },
			],
			fingerprint,
		),
		false,
	);
	assert.equal(
		containsSubmittedFingerprint(
			[{ authorRole: "user", textContent: `payload ${fingerprint}` }],
			fingerprint,
		),
		true,
	);
});

test("CP-EXE-BR-09 empty or absent fingerprint cannot prove delivery", () => {
	const messages = [{ authorRole: "user", textContent: "ordinary message" }];
	assert.equal(containsSubmittedFingerprint(messages, undefined), false);
	assert.equal(containsSubmittedFingerprint(messages, "wake:absent"), false);
});

test("CP-EXE-BR-03/09 content and background wire structural sent-message verification before SUBMIT returns", async () => {
	const [content, pageReality, command] = await Promise.all([
		readFile(new URL("../extension/content.ts", import.meta.url), "utf8"),
		readFile(
			new URL("../extension/runtime/page-reality-controller.ts", import.meta.url),
			"utf8",
		),
		readFile(
			new URL("../extension/runtime/browser-command-controller.ts", import.meta.url),
			"utf8",
		),
	]);
	assert.match(content, /data-message-author-role="user"/);
	assert.doesNotMatch(content, /document\.body\.innerText\.includes/);
	assert.match(pageReality, /const waitForSubmittedMessage = async/);
	assert.match(pageReality, /MESSAGE_SUBMIT_REALITY_UNCONFIRMED/);
	assert.match(
		command,
		/return options\.page\.waitForSubmittedMessage\(tabId, fingerprint\)/,
	);
});
