import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createProviderBehaviorAdapter } from "../deployment/adapter.ts";
import { descriptor } from "../deployment/descriptor.ts";

test("EXT-MODEL-PROVIDER-01 provider owns URL reachability/auth/inventory, not FAST/REASON judgment", () => {
	assert.doesNotMatch(
		JSON.stringify(descriptor),
		/fastModel|reasonModel|systemAssessment|taskDiagnostic|providerIdentity|serviceType|hostname|providerInstance/i,
	);
});

test("EXT-MODEL-PROVIDER-02 generic endpoint setup stops at validated inventory", async (context) => {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-provider-boundary-"),
	);
	context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
	const adapter = createProviderBehaviorAdapter({
		probe: async ({ baseUrl }) => ({
			status: "READY",
			baseUrl: `${baseUrl.replace(/\/$/, "")}/v1`,
			models: [{ id: "model-a" }],
			reachable: true,
			authenticated: true,
			message: "provider OpenAI-compatible inventory verified",
		}),
	});
	assert.equal(
		(
			await adapter.setup({
				workspaceRoot,
				input: { providerBaseUrl: "https://provider.example" },
			})
		).result.status,
		"SUCCEEDED",
	);
	const status = await adapter.status({ workspaceRoot });
	assert.equal(status.result.data.setupStatus, "READY");
	assert.doesNotMatch(
		JSON.stringify(status.result.data),
		/fast|reason|capability|device|vendor|discovery/i,
	);
});

test("EXT-MODEL-PROVIDER-03 external provider has no lifecycle or implementation-specific identity truth", () => {
	assert.equal("lifecycle" in descriptor, false);
	assert.equal("verification" in descriptor, false);
	assert.doesNotMatch(
		JSON.stringify(descriptor),
		/assessmentRef|findingRef|taskId|workerRef|providerIdentity|serviceType|hostname|providerInstance/i,
	);
});
