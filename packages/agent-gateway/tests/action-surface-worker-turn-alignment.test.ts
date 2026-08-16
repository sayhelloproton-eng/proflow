import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function gatewaySource(): Promise<string> {
	return readFile(new URL("../src/index.ts", import.meta.url), "utf8");
}

async function productOpenApi(): Promise<string> {
	return readFile(
		new URL("../../agent-product/custom-gpt.openapi.yaml", import.meta.url),
		"utf8",
	);
}

function operationIds(document: string): string[] {
	return [...document.matchAll(/^\s*operationId:\s*([A-Za-z0-9_-]+)\s*$/gm)]
		.map((match) => match[1] ?? "")
		.filter(Boolean)
		.sort();
}

test("CP-AGT-GW-10 Product GPT-facing Action surface excludes New Task dynamic-discovery operations", async () => {
	const ids = operationIds(await productOpenApi());
	assert.deepEqual(ids, [
		"askPeer",
		"getTask",
		"getTaskDocument",
		"putTaskDocument",
		"replyPeer",
	]);
	for (const forbidden of [
		"createTask",
		"listRegisteredRoles",
		"getRegisteredRole",
	])
		assert.equal(ids.includes(forbidden), false);
});

test("CP-AGT-GW-11 Gateway remains stateless across 0..N Actions in one Worker Turn", async () => {
	const text = await gatewaySource();
	assert.deepEqual(
		(text.match(/CREATE TABLE|DatabaseSync|sqlite/gi) ?? []).length,
		0,
		"Gateway must not gain a durable Turn/business store",
	);
	assert.doesNotMatch(
		text,
		/WorkerTurn(?:Store|Repository|Scheduler)|continueWorker|browserContinue/i,
	);
	assert.doesNotMatch(text, /auto.*wake|wake.*after.*action/i);
});

test("CP-AGT-GW-12 nonconsequential Action metadata never grants Execution approval", async () => {
	const document = await productOpenApi();
	const ids = operationIds(document);
	assert.ok(ids.length > 0);
	const consequentialFlags = [
		...document.matchAll(/^\s*x-openai-isConsequential:\s*(true|false)\s*$/gm),
	].map((match) => match[1]);
	assert.equal(consequentialFlags.length, ids.length);
	assert.ok(consequentialFlags.every((flag) => flag === "false"));
	const text = await gatewaySource();
	assert.doesNotMatch(
		text,
		/isConsequential[^\n]{0,120}(?:approval|authorize|ALLOW)/i,
	);
	assert.doesNotMatch(
		text,
		/Always Allow[^\n]{0,120}(?:approval|authorize|ALLOW)/i,
	);
});

test("CP-AGT-GW-13 File Bridge is transport over Execution-owned Artifact truth", async () => {
	const text = await gatewaySource();
	assert.match(text, /fileMaterializationInputs/);
	assert.match(text, /artifactRef/);
	assert.match(text, /relay/i);
	assert.doesNotMatch(text, /CREATE TABLE|DatabaseSync|sqlite/i);
	assert.doesNotMatch(text, /class\s+(?:File|Artifact)(?:Store|Repository)/);
	assert.doesNotMatch(text, /writeFile\([^\n]+artifact/i);
});
