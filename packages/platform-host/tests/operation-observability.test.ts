import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createHostOperationObserver,
	browserStructuredLogSchema,
} from "../src/operation-observability.ts";
test("Host common boundary preserves return/error despite sink failure and separates semantic outcome", async () => {
	const entries: Array<Record<string, unknown>> = [];
	const observer = createHostOperationObserver((entry) => {
		entries.push(entry);
		throw Error("SINK");
	});
	const result = { ok: false, error: { code: "OWNER_DENIED" } };
	assert.equal(
		await observer.run("task", "task.start", async () => result),
		result,
	);
	assert.equal(entries.at(-1)?.status, "FAILED");
	const error = Error("secret text");
	await assert.rejects(
		observer.run("execution", "submit", async () => {
			throw error;
		}),
		(e) => e === error,
	);
	assert.equal("sideEffectState" in (entries.at(-1) ?? {}), false);
	assert.doesNotMatch(JSON.stringify(entries), /secret text/);
	assert.notEqual(entries[0]?.operationRef, entries[1]?.operationRef);
});
test("ingestion rejects payload keys and scrubs URL credentials at sink", () => {
	const entry = {
		timestamp: new Date().toISOString(),
		level: "INFO",
		component: "test",
		conversationLocator: "https://user:pass@chatgpt.com/c/one?q=secret#secret",
		eventId: "evt:1",
		reason: "POLICY_DENIED",
		sideEffectState: "UNKNOWN",
		correlationKind: "IDENTITY_MATCH",
	};
	assert.equal(
		browserStructuredLogSchema.parse(entry).conversationLocator,
		"https://chatgpt.com/c/one",
	);
	assert.equal(
		browserStructuredLogSchema.safeParse({ ...entry, prompt: "secret" })
			.success,
		false,
	);
});

test("Host ACK follows append and duplicate replay is deduplicated after restart", async () => {
	const { mkdtemp, readFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { createOperationSink } = await import(
		"../src/operation-observability.ts"
	);
	const root = await mkdtemp(join(tmpdir(), "host-log-"));
	try {
		const entry = {
			eventId: "event:1",
			timestamp: new Date().toISOString(),
			component: "test",
		};
		const sink = createOperationSink(root);
		await sink.write("browser-extension", entry);
		await sink.write("browser-extension", entry);
		const restart = createOperationSink(root);
		await restart.write("browser-extension", entry);
		assert.equal(
			(
				await readFile(
					join(root, "logs/browser-extension/events.jsonl"),
					"utf8",
				)
			)
				.trim()
				.split("\n").length,
			1,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
