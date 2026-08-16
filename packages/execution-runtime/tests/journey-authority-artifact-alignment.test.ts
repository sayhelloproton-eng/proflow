import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function runtimeSource(): Promise<string> {
	return readFile(new URL("../src/index.ts", import.meta.url), "utf8");
}

async function contractSource(): Promise<string> {
	return readFile(
		new URL("../../execution-contracts/src/index.ts", import.meta.url),
		"utf8",
	);
}

test("CP-EXE-RT-22 Browser/local effects converge to one durable Execution truth", async () => {
	const text = await runtimeSource();
	assert.match(text, /CREATE TABLE IF NOT EXISTS executions/);
	assert.match(text, /execution_artifacts/);
	assert.doesNotMatch(
		text,
		/CREATE TABLE IF NOT EXISTS (?:browser_effects|observer_effects|carrier_effects)/,
	);
	assert.doesNotMatch(text, /class\s+(?:TaskObserver|SystemObserver).*Store/);
});

test("CP-EXE-RT-09 File Bridge locator materialization produces Artifact truth before reuse", async () => {
	const runtime = await runtimeSource();
	const contracts = await contractSource();
	assert.match(contracts, /ArtifactRef/);
	assert.match(contracts, /artifactRefs/);
	assert.match(runtime, /artifactRefs/);
	assert.match(runtime, /materializ/i);
	assert.match(runtime, /mime|hash|bytes|size/i);
	assert.doesNotMatch(
		runtime,
		/locator.*(?:SUCCEEDED|business mutation).*true/i,
	);
});

test("CP-EXE-RT-10 Context Pack/Patch remain Artifact subtypes and patch apply is a separate effect", async () => {
	const text = await runtimeSource();
	assert.match(text, /context[-_ ]?pack/i);
	assert.match(text, /patch[-_ ]?proposal/i);
	assert.doesNotMatch(
		text,
		/CREATE TABLE IF NOT EXISTS (?:context_packs|patches)/i,
	);
	assert.doesNotMatch(text, /class\s+(?:ContextPack|Patch)(?:Store|Service)/);
	assert.match(text, /approval|policy/i);
	assert.match(text, /evidence/i);
});

test("CP-EXE-RT-11 model/observer judgment cannot bypass hard Execution authority", async () => {
	const text = await runtimeSource();
	const hardPolicyIndex = text.indexOf("policy.decide");
	const modelIndex = text.indexOf("model.decide");
	assert.ok(hardPolicyIndex >= 0, "Execution policy must remain explicit");
	assert.ok(
		modelIndex >= 0,
		"Model decision must remain an optional subordinate step",
	);
	assert.ok(
		hardPolicyIndex < modelIndex,
		"hard policy must run before model inference",
	);
	assert.match(text, /approval/i);
	assert.doesNotMatch(text, /confidence\s*[>=]+.*(?:ALLOW|SUCCEEDED)/i);
	assert.doesNotMatch(
		text,
		/(?:TaskDiagnostic|SystemAssessment).*executeCapability/i,
	);
});
