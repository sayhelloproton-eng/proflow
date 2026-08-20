import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { behaviorAdapter } from "../deployment/adapter.ts";
import { descriptor } from "../deployment/descriptor.ts";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const setupDoc = await readFile(
	new URL("../SETUP.md", import.meta.url),
	"utf8",
);
const verified = () => ({
	reachable: "VERIFIED" as const,
	actionsEnabled: "VERIFIED" as const,
	openApiInstalled: "VERIFIED" as const,
	actionAuthValid: "VERIFIED" as const,
	fileBridge: "VERIFIED" as const,
	codeInterpreter: "VERIFIED" as const,
	webSearch: "VERIFIED" as const,
	appsDisabledWhenRequired: "VERIFIED" as const,
});
async function workspace(
	context: { after(fn: () => unknown): void },
	prefix: string,
) {
	const root = await mkdtemp(join(tmpdir(), prefix));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

test("EXT-CHATGPT-01 v1 carrier readiness is capability/behavior based, never exact-model pinned", () => {
	assert.match(readme, /behavior\/capability based/i);
	assert.match(readme, /Exact ChatGPT model id is advisory only/i);
	assert.doesNotMatch(
		JSON.stringify(descriptor),
		/modelId|exactModel|pinnedModel/i,
	);
});

test("EXT-CHATGPT-02 Knowledge specialization is deferred and is not a setup prerequisite", () => {
	assert.doesNotMatch(setupDoc, /knowledge specialization.*required/i);
	assert.equal("verification" in descriptor, false);
});

test("EXT-CHATGPT-03 real Action auth/OpenAPI/File Bridge/native capabilities are independently accepted only as real setup evidence", async (context) => {
	const workspaceRoot = await workspace(context, "proflow-chatgpt-v1-ready-");
	const originalFetch = globalThis.fetch;
	try {
		globalThis.fetch = async () => new Response(null, { status: 403 });
		const setup = await behaviorAdapter.setup({
			workspaceRoot,
			input: {
				carrierUrl: "https://chatgpt.com/g/g-v1-ready",
				verification: verified(),
			},
		});
		assert.equal(setup.result.status, "SUCCEEDED");
		assert.equal(
			(await behaviorAdapter.status({ workspaceRoot })).result.data.setupStatus,
			"READY",
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("EXT-CHATGPT-04 stable Conversation c-id is not claimed from GPT Actions or persisted by Deployment adapter", () => {
	assert.match(readme, /c-id is not supplied by Actions/i);
	assert.match(readme, /observed later by the Chrome\/Browser Carrier/i);
	assert.doesNotMatch(
		JSON.stringify(descriptor),
		/workerRef|conversationLocator|tabId|frameId/,
	);
});

test("EXT-CHATGPT-05 unmet Web-only setup remains ACTION_REQUIRED and never becomes fake READY", async (context) => {
	const workspaceRoot = await workspace(
		context,
		"proflow-chatgpt-v1-incomplete-",
	);
	const originalFetch = globalThis.fetch;
	try {
		globalThis.fetch = async () => new Response(null, { status: 403 });
		const setup = await behaviorAdapter.setup({
			workspaceRoot,
			input: {
				carrierUrl: "https://chatgpt.com/g/g-v1-incomplete",
				verification: { ...verified(), actionAuthValid: "UNVERIFIED" },
			},
		});
		assert.equal(setup.result.status, "ACTION_REQUIRED");
		assert.equal(
			(await behaviorAdapter.status({ workspaceRoot })).result.data.setupStatus,
			"ACTION_REQUIRED",
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
