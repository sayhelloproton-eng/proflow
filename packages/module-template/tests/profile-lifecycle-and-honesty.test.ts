import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
	type GeneratedBehaviorObservation,
	loadGeneratedBehaviorAdapter,
	materializeModule,
} from "../src/index.ts";

const execFileAsync = promisify(execFile);

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
	});
	const adapter = await loadGeneratedBehaviorAdapter(service.packageDirectory);

	const status = await adapter.status?.();
	assert.deepEqual(status?.result.data, { state: "STOPPED" });

	const verify = await adapter.verify?.();
	assert.equal(verify?.result.error?.code, "VERIFY_FAILED");
	assert.equal(verify?.result.checks?.[0]?.status, "FAIL");
});

test("gap-2 service profile generates and passes lifecycle tests", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-gap2-lifecycle-"));
	context.after(() => rm(root, { recursive: true, force: true }));

	const generated = await materializeModule({
		targetDirectory: root,
		moduleRef: "lifecycle-service",
		packageName: "@tomflow/proflow-lifecycle-service",
		kind: "service",
	});
	const testPath = join(generated.packageDirectory, "tests/lifecycle.test.ts");
	const content = await readFile(testPath, "utf8");
	for (const symbol of ["status", "start", "stop", "restart"]) {
		assert.match(content, new RegExp(`\\b${symbol}\\b`), symbol);
	}
	await execFileAsync(process.execPath, ["--test", "tests/lifecycle.test.ts"], {
		cwd: generated.packageDirectory,
	});
});

test("gap-3 browser-extension status reports honest UNKNOWN / ACTION_REQUIRED", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-gap3-browser-"));
	context.after(() => rm(root, { recursive: true, force: true }));

	const generated = await materializeModule({
		targetDirectory: root,
		moduleRef: "browser-honest",
		packageName: "@tomflow/proflow-browser-honest",
		kind: "browser-extension",
	});
	const adapter = await loadGeneratedBehaviorAdapter(
		generated.packageDirectory,
	);
	const status = await adapter.status?.();
	assert.equal(status?.result.ok, false);
	assert.equal(status?.result.status, "ACTION_REQUIRED");
	assert.equal(status?.externalAvailabilityClaim, "UNKNOWN");
	assert.equal(status?.externalAvailabilityEvidence, "none");
});
