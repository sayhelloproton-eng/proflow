import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function sources(): Promise<string> {
	const urls = [
		"../src/ready/ready.ts",
		"../src/verification/verify.ts",
		"../src/manifest/manifest.ts",
		"../src/planner/plan.ts",
	];
	return (
		await Promise.all(
			urls.map((url) => readFile(new URL(url, import.meta.url), "utf8")),
		)
	).join("\n");
}

test("CP-DPL-CLI-05 Carrier/Role readiness is current owner verification, not exact model pin or System Assessment", async () => {
	const text = await sources();
	assert.match(text, /verification/i);
	assert.match(text, /resourceIdentity|resourceVersion/);
	assert.doesNotMatch(text, /SystemAssessment|assessmentRef/);
	assert.doesNotMatch(text, /modelRef\s*===|exactModel|pinnedModel/i);
});

test("CP-DPL-CLI-03 Web-only unmet prerequisites remain ACTION_REQUIRED(_WEB) and resume re-observes reality", async () => {
	const text = await sources();
	assert.match(text, /ACTION_REQUIRED/);
	assert.match(text, /current|discover|verify|reality/i);
	assert.doesNotMatch(text, /ACTION_REQUIRED[^\n]{0,100}(?:SUCCEEDED|READY)/i);
});

test("CP-DPL-CLI-22 platform CLI never invents Task worker/conversation/browser identity", async () => {
	const text = await sources();
	for (const forbidden of [
		"workerRef",
		"conversationLocator",
		"tabId",
		"frameId",
	])
		assert.equal(
			text.includes(forbidden),
			false,
			`${forbidden} must not be deployment truth`,
		);
});
