import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	type GeneratedBehaviorObservation,
	loadGeneratedBehaviorAdapter,
	materializeModule,
} from "../src/index.ts";

// Compile-time regression guard: the public observation type must be the
// canonical ModuleOperationResult (data / error / resourceVersion and the full
// PASS|FAIL|WARN|SKIP check status enum), not the former hand-rolled narrower
// subset that dropped these fields.
const canonicalObservation = {
	result: {
		contract: "deployment.result.v1",
		ok: false,
		status: "FAILED",
		moduleRef: "example",
		moduleVersion: "1.0.0",
		data: { state: "RUNNING" },
		error: { code: "VERIFY_FAILED", message: "failed", retryable: false },
		resourceVersion: "v1",
		checks: [{ id: "example-check", status: "WARN", message: "warned" }],
	},
	observedEffects: [],
} satisfies GeneratedBehaviorObservation;
void canonicalObservation;

test("gap-1 generated observation matches canonical ModuleOperationResult at runtime", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-gap1-shape-"));
	context.after(() => rm(root, { recursive: true, force: true }));

	const service = await materializeModule({
		targetDirectory: root,
		moduleRef: "shape-service",
		packageName: "@tomflow/proflow-shape-service",
		kind: "service",
		domain: "deployment-governance",
		summary: "Generated test fixture",
	});
	const adapter = await loadGeneratedBehaviorAdapter(service.packageDirectory);

	const status = await adapter.status?.();
	assert.equal(status?.result.status, "SUCCEEDED");
	assert.deepEqual(status?.result.data, {
		configStatus: "READY",
		runtimeStatus: "UNKNOWN",
	});
	assert.equal(adapter.verify, undefined);
});

test("gap-2 service profile generates and passes lifecycle tests", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-gap2-lifecycle-"));
	context.after(() => rm(root, { recursive: true, force: true }));

	const generated = await materializeModule({
		targetDirectory: root,
		moduleRef: "lifecycle-service",
		packageName: "@tomflow/proflow-lifecycle-service",
		kind: "service",
		domain: "deployment-governance",
		summary: "Generated test fixture",
	});
	const adapter = await loadGeneratedBehaviorAdapter(
		generated.packageDirectory,
	);
	const status = await adapter.status?.();
	assert.equal(status?.result.status, "SUCCEEDED");
	assert.deepEqual(status?.result.data, {
		configStatus: "READY",
		runtimeStatus: "UNKNOWN",
	});
	for (const primitive of ["start", "stop"] as const) {
		const observation = await adapter[primitive]?.();
		assert.equal(observation?.result.status, "ACTION_REQUIRED", primitive);
		assert.equal(
			observation?.result.actionRequired?.action,
			"implement-service-lifecycle",
			primitive,
		);
	}
	assert.equal(adapter.restart, undefined);
	assert.equal(adapter.uninstall, undefined);
	const source = await readFile(
		join(generated.packageDirectory, "deployment/adapter.ts"),
		"utf8",
	);
	assert.match(source, /createProductionBinding/);
	assert.doesNotMatch(source, /createServiceProcessBinding/);
});

test("gap-3 browser-extension status reports honest READY config and UNKNOWN runtime", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-gap3-browser-"));
	context.after(() => rm(root, { recursive: true, force: true }));

	const generated = await materializeModule({
		targetDirectory: root,
		moduleRef: "browser-honest",
		packageName: "@tomflow/proflow-browser-honest",
		kind: "browser-extension",
		domain: "deployment-governance",
		summary: "Generated test fixture",
	});
	const adapter = await loadGeneratedBehaviorAdapter(
		generated.packageDirectory,
	);
	const status = await adapter.status?.();
	assert.equal(status?.result.ok, true);
	assert.equal(status?.result.status, "SUCCEEDED");
	assert.deepEqual(status?.result.data, {
		configStatus: "READY",
		runtimeStatus: "UNKNOWN",
	});
	assert.equal(status?.externalAvailabilityClaim, undefined);
	assert.equal(status?.externalAvailabilityEvidence, undefined);
});
