import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { behaviorAdapter } from "../deployment/adapter.ts";
import { descriptor } from "../deployment/descriptor.ts";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

test("EXT-MODEL-PROVIDER-01 provider adapter owns reachability/auth, not FAST/REASON capability judgment", () => {
	assert.match(readme, /Does NOT own/i);
	assert.match(readme, /FAST \/ REASON logical roles/i);
	assert.match(readme, /Model capability judgment/i);
	assert.doesNotMatch(
		JSON.stringify(descriptor),
		/fastModel|reasonModel|systemAssessment|taskDiagnostic/,
	);
});

test("EXT-MODEL-PROVIDER-02 provider-owned setup stops at reachability/auth and leaves capability truth to Model Domain", async (context) => {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-provider-boundary-"),
	);
	context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
	const originalFetch = globalThis.fetch;
	try {
		globalThis.fetch = async () => new Response("{}", { status: 200 });
		assert.equal(
			(
				await behaviorAdapter.setup({
					workspaceRoot,
					input: { providerBaseUrl: "http://127.0.0.1:4400/v1/" },
				})
			).result.status,
			"SUCCEEDED",
		);
		const status = await behaviorAdapter.status({ workspaceRoot });
		assert.equal(status.result.data.setupStatus, "READY");
		assert.doesNotMatch(
			JSON.stringify(status.result.data),
			/fast|reason|capability/i,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("EXT-MODEL-PROVIDER-03 external provider has no descriptor lifecycle/system-assessment truth", () => {
	assert.equal("lifecycle" in descriptor, false);
	assert.equal("verification" in descriptor, false);
	assert.doesNotMatch(
		JSON.stringify(descriptor),
		/assessmentRef|findingRef|taskId|workerRef/,
	);
});
