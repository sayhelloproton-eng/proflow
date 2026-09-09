import assert from "node:assert/strict";
import { test } from "node:test";
import { selectChatGptComposerElement } from "../src/chatgpt-runtime-adapter.ts";
import { submitControlledComposer } from "../src/composer-submit.ts";

test("CP-EXE-BR-22 prefers the canonical prompt editor over an earlier fallback textarea", () => {
	const prompt = { kind: "prompt" } as unknown as Element;
	const fallback = { kind: "textarea" } as unknown as Element;
	const calls: string[] = [];
	const document = {
		querySelector(selector: string) {
			calls.push(selector);
			if (selector === "#prompt-textarea") return prompt;
			if (selector === "textarea") return fallback;
			return null;
		},
	} as unknown as Document;

	assert.equal(selectChatGptComposerElement(document), prompt);
	assert.deepEqual(calls, ["#prompt-textarea"]);
});

class DelayedComposer {
	committed = "previous";
	pending = "";
	frames = 0;
	sent: string[] = [];

	write(value: string) {
		this.pending = value;
	}
	dispatchInput() {}
	readValue() {
		return this.committed;
	}
	submitReady() {
		return this.committed.length > 0;
	}
	async nextFrame() {
		this.frames += 1;
		if (this.frames >= 1) this.committed = this.pending;
	}
	clickSubmit() {
		this.sent.push(this.committed);
	}
}

test("CP-EXE-BR-21 waits for controlled composer commit before clicking send", async () => {
	const port = new DelayedComposer();
	await submitControlledComposer(port, "WORKER_BIND product");
	assert.deepEqual(port.sent, ["WORKER_BIND product"]);
	assert.ok(port.frames >= 2);
});

test("CP-EXE-BR-21 consecutive Product Dev Test submits never send the previous message", async () => {
	for (const role of ["product", "dev", "test"]) {
		const port = new DelayedComposer();
		const expected = `WORKER_BIND ${role}`;
		await submitControlledComposer(port, expected);
		assert.deepEqual(port.sent, [expected]);
	}
});

test("CP-EXE-BR-21 never clicks when readback or submit readiness is not stable", async () => {
	let clicks = 0;
	for (const port of [
		{
			write() {},
			dispatchInput() {},
			readValue: () => "previous",
			submitReady: () => true,
			async nextFrame() {},
			clickSubmit() {
				clicks += 1;
			},
		},
		{
			write() {},
			dispatchInput() {},
			readValue: () => "next",
			submitReady: () => false,
			async nextFrame() {},
			clickSubmit() {
				clicks += 1;
			},
		},
	])
		await assert.rejects(
			submitControlledComposer(port, "next", 2),
			/COMPOSER_SUBMIT_NOT_READY/,
		);
	assert.equal(clicks, 0);
});
