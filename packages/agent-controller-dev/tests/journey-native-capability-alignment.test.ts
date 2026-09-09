import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

const metadata = JSON.parse(
	await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as {
	proflowAgent: {
		instructions: string;
		carrierProfiles: {
			"custom-gpt": {
				capabilities: Record<string, boolean>;
				requirements: Record<string, unknown>;
			};
		};
	};
};
const openapi = parse(
	await readFile(
		new URL("../actions/custom-gpt.openapi.yaml", import.meta.url),
		"utf8",
	),
) as {
	paths: Record<
		string,
		Record<string, { operationId: string; "x-openai-isConsequential": boolean }>
	>;
};
const ops = Object.values(openapi.paths).flatMap((path) => Object.values(path));
const operationIds = ops.map((item) => item.operationId);

test("CP-AGT-DEV-07 J1 bind is IDLE and formal Node work starts only after NODE_READY wake", () => {
	assert.match(
		metadata.proflowAgent.instructions,
		/WORKER_BIND.*(?:只绑定|不推进|不工作)/,
	);
	assert.match(metadata.proflowAgent.instructions, /NODE_READY.*(?:开始|正式)/);
	assert.ok(operationIds.includes("startNode"));
});

test("CP-AGT-DEV-08 one Worker Turn uses 0..N routine Actions and has no Browser per-action scheduler protocol", () => {
	assert.equal(
		ops.find((item) => item.operationId === "localDev")?.[
			"x-openai-isConsequential"
		],
		true,
	);
	for (const tool of ["repomix", "codeGraph"])
		assert.equal(
			ops.find((item) => item.operationId === tool)?.[
				"x-openai-isConsequential"
			],
			false,
		);
	assert.doesNotMatch(
		JSON.stringify(openapi),
		/continueWorker|actionFinished|browserContinue|wakeAfterAction/i,
	);
});

test("CP-AGT-DEV-09 File Bridge + Code Interpreter produce candidates while Direct Tools prove real repo effects", () => {
	const profile = metadata.proflowAgent.carrierProfiles["custom-gpt"];
	assert.equal(profile.capabilities.codeInterpreter, true);
	assert.equal(profile.requirements.fileBridge, "required");
	for (const tool of ["repomix", "localDev", "codeGraph"])
		assert.ok(operationIds.includes(tool));
	assert.equal(operationIds.includes("executeCapability"), false);
	assert.match(
		metadata.proflowAgent.instructions,
		/Code Interpreter.*沙箱.*不等于真实 repo apply/,
	);
});

test("CP-AGT-DEV-10 reopen and tool-native handles reuse the Task-bound Worker/Conversation", () => {
	assert.match(
		metadata.proflowAgent.instructions,
		/REOPEN.*原 Task-bound worker/,
	);
	assert.ok(operationIds.includes("localDev"));
	assert.equal(operationIds.includes("getExecution"), false);
	assert.doesNotMatch(
		JSON.stringify(openapi),
		/worker\.create|createConversation|newWorker|duplicateWorker/i,
	);
});

test("CP-AGT-DEV-11 public research uses native Web Search while local/private engineering uses Direct Tools", () => {
	const profile = metadata.proflowAgent.carrierProfiles["custom-gpt"];
	assert.equal(profile.capabilities.webSearch, true);
	for (const tool of ["repomix", "localDev", "codeGraph"])
		assert.ok(operationIds.includes(tool));
	assert.equal(operationIds.includes("executeCapability"), false);
	assert.match(
		metadata.proflowAgent.instructions,
		/Web Search|公开互联网|public research/i,
	);
	assert.match(
		metadata.proflowAgent.instructions,
		/本地|当前磁盘|Local Dev|Repomix|CodeGraph/i,
	);
});
