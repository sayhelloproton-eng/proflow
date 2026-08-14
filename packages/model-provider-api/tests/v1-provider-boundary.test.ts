import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { createBehaviorAdapter } from "../deployment/adapter.ts";
import { descriptor } from "../deployment/descriptor.ts";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

test("EXT-MODEL-PROVIDER-01 provider adapter owns reachability/auth, not FAST/REASON capability judgment", () => {
	assert.match(readme, /Does NOT own/i);
	assert.match(readme, /FAST \/ REASON logical roles/i);
	assert.match(readme, /Model capability judgment/i);
	assert.doesNotMatch(JSON.stringify(descriptor), /fastModel|reasonModel|systemAssessment|taskDiagnostic/);
});

test("EXT-MODEL-PROVIDER-02 capability verification is delegated to Model Domain before verification can succeed", async () => {
	const reachableOnly = createBehaviorAdapter({
		probeProvider: async () => ({
			reachable: true,
			authenticated: true,
			message: "reachable",
		}),
	});
	const result = await reachableOnly.verify();
	assert.equal(result.result.status, "ACTION_REQUIRED");
	assert.equal(result.result.actionRequired?.action, "verify-model-domain-capabilities");
});

test("EXT-MODEL-PROVIDER-03 external provider adapter has no process lifecycle or system-assessment truth", () => {
	for (const primitive of ["start", "stop", "restart"])
		assert.equal(descriptor.lifecycle.supported.includes(primitive as never), false);
	assert.doesNotMatch(JSON.stringify(descriptor), /assessmentRef|findingRef|taskId|workerRef/);
});
