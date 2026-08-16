import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { createBehaviorAdapter } from "../deployment/adapter.ts";
import { descriptor } from "../deployment/descriptor.ts";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

test("EXT-CHROME-01 chrome-runtime owns only the external browser prerequisite, not Task/Worker identity", () => {
	assert.match(readme, /external browser prerequisite/i);
	assert.match(readme, /not a Task\/Worker identity owner/i);
	assert.doesNotMatch(
		JSON.stringify(descriptor),
		/workerRef|conversationLocator|taskId|nodeId/,
	);
});

test("EXT-CHROME-02 tab/window identity is transient and frame registry is not a v1 readiness contract", () => {
	assert.match(readme, /tab\/window ids remain transient/i);
	assert.match(readme, /No frame registry/i);
	assert.doesNotMatch(
		JSON.stringify(descriptor),
		/frameRegistry|frameRole|persistentTab/,
	);
});

test("EXT-CHROME-03 runtime availability alone cannot prove MV3 extension load/authorization", async () => {
	const adapter = createBehaviorAdapter({
		probe: async () => ({
			available: true,
			resourceVersion: "Chrome 150.0.0.0",
			extensionLoaded: false,
		}),
	});
	assert.equal((await adapter.status()).result.status, "SUCCEEDED");
	assert.equal((await adapter.verify()).result.status, "ACTION_REQUIRED");
});

test("EXT-CHROME-04 external Chrome runtime has no synthetic process lifecycle", () => {
	for (const primitive of ["start", "stop", "restart"]) {
		assert.equal(
			descriptor.lifecycle.supported.includes(primitive as never),
			false,
		);
	}
});
