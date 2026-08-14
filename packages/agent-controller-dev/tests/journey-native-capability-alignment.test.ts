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

test("CP-AGT-DEV-07 J1 bind is IDLE and formal Node work starts only after NODE_READY wake", () => {
	assert.match(metadata.proflowAgent.instructions, /WORKER_BIND.*(?:只绑定|不推进|不工作)/);
	assert.match(metadata.proflowAgent.instructions, /NODE_READY.*(?:开始|正式)/);
	assert.ok(operationIds.includes("startNode"));
});

test("CP-AGT-DEV-08 one Worker Turn uses 0..N routine Actions and has no Browser per-action scheduler protocol", () => {
	for (const operation of ops) assert.equal(operation["x-openai-isConsequential"], false);
	assert.doesNotMatch(JSON.stringify(openapi), /continueWorker|actionFinished|browserContinue|wakeAfterAction/i);
});

test("CP-AGT-DEV-09 File Bridge + Code Interpreter produce candidate artifacts while Execution proves real apply/test effects", () => {
	const profile = metadata.proflowAgent.carrierProfiles["custom-gpt"];
	assert.equal(profile.capabilities.codeInterpreter, true);
	assert.equal(profile.requirements.fileBridge, "required");
	assert.ok(operationIds.includes("executeCapability"));
	assert.ok(operationIds.includes("getExecution"));
	assert.match(metadata.proflowAgent.instructions, /sandbox artifact.*不等于真实 repo apply/);
});

test("CP-AGT-DEV-10 reopen and async result resume reuse the Task-bound Worker/Conversation instead of creating another Worker", () => {
	assert.match(metadata.proflowAgent.instructions, /REOPEN.*原 Task-bound worker/);
	assert.ok(operationIds.includes("getExecution"));
	assert.doesNotMatch(JSON.stringify(openapi), /worker\.create|createConversation|newWorker|duplicateWorker/i);
});

test("CP-AGT-DEV-11 public research uses native Web Search while local/private/credentialed engineering requests remain Execution-owned", () => {
	const profile = metadata.proflowAgent.carrierProfiles["custom-gpt"];
	assert.equal(profile.capabilities.webSearch, true);
	assert.ok(operationIds.includes("executeCapability"));
	assert.match(metadata.proflowAgent.instructions, /Web Search|公开互联网|public research/i);
	assert.match(metadata.proflowAgent.instructions, /local|private|credential|本地|私有|凭据/i);
});
