import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const sourceUrl = new URL("../src/index.ts", import.meta.url);

async function source(): Promise<string> {
	return readFile(sourceUrl, "utf8");
}

test("CP-EXE-CONTRACTS-08 ArtifactRef and EvidenceRef remain distinct opaque contract types and result arrays", async () => {
	const text = await source();
	assert.match(text, /export type ArtifactRef\s*=\s*Brand<string,\s*"ArtifactRef">/);
	assert.match(text, /export type EvidenceRef\s*=\s*Brand<string,\s*"EvidenceRef">/);
	assert.match(text, /artifactRefs/);
	assert.match(text, /evidenceRefs/);
	assert.doesNotMatch(text, /type ArtifactRef\s*=\s*EvidenceRef|type EvidenceRef\s*=\s*ArtifactRef/);
});

test("CP-EXE-CONTRACTS-09 stable Execution identity uses Task/Node/run/role/worker/correlation refs and excludes frame or persistent-tab identity", async () => {
	const text = await source();
	for (const required of ["taskId", "nodeId", "runNo", "roleRef", "workerRef", "correlationId"]) {
		assert.match(text, new RegExp(`\\b${required}\\b`));
	}
	assert.doesNotMatch(text, /frameId|frameRef|persistentTabId|persistentTabRef|windowIdentity/);
});

test("CP-EXE-CONTRACTS-10 Carrier capabilities stay typed Execution requests and no Observer business-mutation contract is added", async () => {
	const text = await source();
	for (const capability of [
		"worker.create",
		"worker.restore",
		"worker.wake",
		"collaboration.deliver",
	]) {
		assert.match(text, new RegExp(capability.replace(".", "\\.")));
	}
	assert.doesNotMatch(text, /taskObserver\.(?:complete|reopen|wait|start)|systemObserver\.(?:approve|complete|reopen|execute)/i);
});
