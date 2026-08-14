import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
	proflowAgent: {
		instructions: string;
		carrierProfiles: { "custom-gpt": { capabilities: Record<string, boolean>; requirements: Record<string, unknown> } };
	};
};
const openapi = parse(await readFile(new URL("../actions/custom-gpt.openapi.yaml", import.meta.url), "utf8")) as {
	paths: Record<string, Record<string, { operationId: string; "x-openai-isConsequential": boolean }>>;
};
const ops = Object.values(openapi.paths).flatMap((path) => Object.values(path));
const operationIds = ops.map((item) => item.operationId);

test("CP-AGT-TEST-07 J1 Test/Ops is bind-only/IDLE and starts the formal Node only after NODE_READY wake", () => {
	assert.match(metadata.proflowAgent.instructions, /WORKER_BIND.*(?:不工作|只绑定|不推进)/);
	assert.ok(operationIds.includes("startNode"));
	assert.doesNotMatch(JSON.stringify(openapi), /worker\.create|createConversation/);
});

test("CP-AGT-TEST-08 one Worker Turn permits 0..N routine Actions without Browser per-action scheduling", () => {
	for (const operation of ops) assert.equal(operation["x-openai-isConsequential"], false);
	assert.doesNotMatch(JSON.stringify(openapi), /continueWorker|actionFinished|browserContinue|wakeAfterAction/i);
});

test("CP-AGT-TEST-09 File Bridge/Code Interpreter may analyze artifacts but PASS/FAIL/Evidence remain Owner facts", () => {
	const profile = metadata.proflowAgent.carrierProfiles["custom-gpt"];
	assert.equal(profile.capabilities.codeInterpreter, true);
	assert.equal(profile.requirements.fileBridge, "required");
	assert.ok(operationIds.includes("putTaskDocument"));
	assert.ok(operationIds.includes("getExecution"));
	assert.match(metadata.proflowAgent.instructions, /test PASS 不等于 Task complete/);
	assert.match(metadata.proflowAgent.instructions, /TaskDocument\/Evidence/);
});

test("CP-AGT-TEST-10 fail→reopen keeps the same Worker/Conversation and runNo advances through Task ownership", () => {
	assert.match(metadata.proflowAgent.instructions, /REOPEN.*复用原 worker/);
	assert.doesNotMatch(JSON.stringify(openapi), /worker\.create|createConversation|replaceWorker/);
	assert.ok(operationIds.includes("failNode"));
	assert.equal(operationIds.includes("reopenNode"), false);
});
