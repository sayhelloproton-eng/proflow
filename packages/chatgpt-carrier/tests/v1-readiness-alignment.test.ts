import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { behaviorAdapter } from "../deployment/adapter.ts";
import { descriptor } from "../deployment/descriptor.ts";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const setupDoc = await readFile(
	new URL("../SETUP.md", import.meta.url),
	"utf8",
);

async function withFetch(status: number, operation: () => Promise<void>) {
	const originalFetch = globalThis.fetch;
	try {
		globalThis.fetch = async () => new Response(null, { status });
		await operation();
	} finally {
		globalThis.fetch = originalFetch;
	}
}

test("EXT-CHATGPT-01 deployment carrier observer owns no exact-model or concrete Role truth", () => {
	assert.match(readme, /does not own or mirror/i);
	assert.doesNotMatch(
		JSON.stringify(descriptor),
		/modelId|exactModel|pinnedModel/i,
	);
	assert.doesNotMatch(
		JSON.stringify(descriptor),
		/carrierUrl|roleRef|workerRef/,
	);
});

test("EXT-CHATGPT-02 setup has no user-supplied GPT URL or capability confirmation", () => {
	assert.match(setupDoc, /Required inputs: none/);
	assert.doesNotMatch(setupDoc, /--carrier-url|--confirm-capabilities/);
	assert.doesNotMatch(
		JSON.stringify(descriptor.requirements),
		/"kind":"human"/,
	);
});
test("EXT-CHATGPT-03 reachable Web is machine-observed as READY", async () => {
	await withFetch(403, async () => {
		const result = await behaviorAdapter.setup({
			workspaceRoot: process.cwd(),
		});
		assert.equal(result.result.status, "SUCCEEDED");
		assert.equal(result.result.data?.setupStatus, "READY");
		assert.equal(result.externalAvailabilityClaim, "AVAILABLE");
	});
});

test("EXT-CHATGPT-04 stable Conversation c-id remains outside Deployment carrier observation", () => {
	assert.match(readme, /Conversation c-id is not supplied by Actions/i);
	assert.doesNotMatch(
		JSON.stringify(descriptor),
		/conversationLocator|tabId|frameId|workerRef/,
	);
});

test("EXT-CHATGPT-05 unavailable Web remains ACTION_REQUIRED and never fake READY", async () => {
	await withFetch(503, async () => {
		const result = await behaviorAdapter.setup({
			workspaceRoot: process.cwd(),
		});
		assert.equal(result.result.status, "ACTION_REQUIRED");
		assert.equal(result.result.data?.setupStatus, "ACTION_REQUIRED");
		assert.equal(result.externalAvailabilityClaim, "UNAVAILABLE");
	});
});
