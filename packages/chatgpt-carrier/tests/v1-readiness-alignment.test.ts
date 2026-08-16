import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { createBehaviorAdapter } from "../deployment/adapter.ts";
import { descriptor } from "../deployment/descriptor.ts";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

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

test("EXT-CHATGPT-01 v1 carrier readiness is capability/behavior based, never exact-model pinned", () => {
	assert.match(readme, /behavior\/capability based/i);
	assert.match(readme, /Exact ChatGPT model id is advisory only/i);
	const serialized = JSON.stringify(descriptor);
	assert.doesNotMatch(serialized, /modelId|exactModel|pinnedModel/i);
});

test("EXT-CHATGPT-02 Knowledge specialization is deferred and is not a v1 readiness prerequisite", () => {
	assert.match(readme, /future Knowledge specialization/i);
	const checks = descriptor.verification.checks.map((check) => check.id);
	assert.equal(
		checks.some((id) => /knowledge/i.test(id)),
		false,
	);
});

test("EXT-CHATGPT-03 real Action auth/OpenAPI/File Bridge/native capabilities are independently verifiable", async () => {
	const ids = new Set(descriptor.verification.checks.map((check) => check.id));
	for (const id of [
		"carrier-actions-schema",
		"carrier-openapi",
		"carrier-auth",
		"carrier-file-bridge",
		"carrier-code-interpreter",
		"carrier-web-search",
	])
		assert.equal(ids.has(id), true, id);

	const adapter = createBehaviorAdapter({
		observeVerification: async () => verified(),
	});
	assert.equal((await adapter.verify()).result.status, "SUCCEEDED");
});

test("EXT-CHATGPT-04 stable Conversation c-id is not claimed from GPT Actions or persisted by Deployment adapter", () => {
	assert.match(readme, /c-id is not supplied by Actions/i);
	assert.match(readme, /observed later by the Chrome\/Browser Carrier/i);
	assert.doesNotMatch(
		JSON.stringify(descriptor),
		/workerRef|conversationLocator|tabId|frameId/,
	);
});

test("EXT-CHATGPT-05 unmet Web-only setup remains ACTION_REQUIRED and never becomes fake READY", async () => {
	const adapter = createBehaviorAdapter({
		observeVerification: async () => ({
			...verified(),
			actionAuthValid: "UNVERIFIED" as const,
		}),
	});
	const verify = await adapter.verify();
	assert.equal(verify.result.status, "ACTION_REQUIRED");
	assert.notEqual(verify.readinessClaim, "READY");
});
