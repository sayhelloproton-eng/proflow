import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";
import { materializeAgentPackage } from "../src/index.ts";

const metadata = JSON.parse(
	await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as { description: string; proflowAgent: { instructions: string } };
const openapi = await readFile(
	new URL("../actions/custom-gpt.openapi.yaml", import.meta.url),
	"utf8",
);
type OpenApiOperation = {
	operationId: string;
	"x-openai-isConsequential": boolean;
	requestBody?: unknown;
};
const parsed = parse(openapi) as {
	openapi: string;
	security: unknown[];
	paths: Record<string, Record<string, OpenApiOperation>>;
};
const operations = Object.values(parsed.paths).flatMap((path) =>
	Object.values(path).map((operation) => operation.operationId),
);
test("CP-AGT-DEV-01 instructions and Action allowlist are role-minimal", () => {
	assert.equal(parsed.openapi, "3.1.0");
	assert.ok(parsed.security.length > 0);
	for (const path of Object.values(parsed.paths))
		for (const [method, operation] of Object.entries(path)) {
			assert.equal(typeof operation["x-openai-isConsequential"], "boolean");
			if (method === "post") assert.ok(operation.requestBody);
		}
	assert.match(metadata.proflowAgent.instructions, /typed Execution/);
	assert.deepEqual(
		new Set(operations),
		new Set([
			"getTask",
			"getNodeContext",
			"startNode",
			"completeNode",
			"waitNode",
			"failNode",
			"reopenNode",
			"getTaskDocument",
			"putTaskDocument",
			"askPeer",
			"replyPeer",
			"executeCapability",
			"getExecution",
			"readExecutionOutput",
		]),
	);
	assert.doesNotMatch(
		openapi,
		/executeAnything|updateStatus|browser\.click|role register/i,
	);
	assert.doesNotMatch(openapi, /unevaluatedProperties|allOf:/);
});
test("CP-AGT-DEV-02 Task and Execution access is owner Public Contract shaped", () => {
	assert.ok(operations.includes("getNodeContext"));
	assert.ok(operations.includes("executeCapability"));
	assert.doesNotMatch(openapi, /sqlite|repository|deep import|task-store/);
});
test("CP-AGT-DEV-03 sandbox artifact is explicitly not real apply", () => {
	assert.match(
		metadata.proflowAgent.instructions,
		/sandbox artifact，不等于真实 repo apply/,
	);
});
test("CP-AGT-DEV-04 provisioning/reopen real evidence remains external ACTION_REQUIRED", async () => {
	const { behaviorAdapter } = await import("../deployment/adapter.ts");
	const context = { workspaceRoot: "/__proflow_missing_agent_fixture__" };
	const status = behaviorAdapter.status(context).result;
	assert.equal(status.status, "SUCCEEDED");
	assert.deepEqual(status.data, {
		setupStatus: "ACTION_REQUIRED",
		runtimeStatus: "NOT_APPLICABLE",
		issues: [
			{
				scope: "SETUP",
				code: "ROLE_SETUP_REQUIRED",
				message: "ROLE_NOT_REGISTERED:@tomflow/proflow-agent-controller-dev",
				relatedModuleRefs: [],
				nextCommand: "platform setup --module agent-controller-dev",
			},
		],
	});
	const setup = (await behaviorAdapter.setup(context)).result;
	assert.equal(setup.status, "FAILED");
	assert.match(
		setup.error?.message ?? "",
		/agent-gateway publicBaseUrl is unavailable/,
	);
	assert.match(
		metadata.proflowAgent.instructions,
		/REOPEN 使用原 Task-bound worker/,
	);
});

test("CP-REAL2-PROV-01 Controller/Dev package owns complete Custom GPT provisioning material", async () => {
	const material = materializeAgentPackage(metadata);
	assert.equal(material.displayName, "研发 + 项目总控");
	assert.equal(material.description, metadata.description);
	assert.equal(material.recommendedModel, "gpt-5-6");
	assert.deepEqual(material.capabilities, {
		webSearch: true,
		imageGeneration: true,
		codeInterpreter: true,
	});
	assert.equal(material.actionSchema, "actions/custom-gpt.openapi.yaml");
	assert.equal(material.knowledgeBundle, "knowledge/custom-gpt-knowledge.zip");
	assert.equal("knowledgeFiles" in material, false);
	const bundle = await readFile(
		new URL(`../${material.knowledgeBundle}`, import.meta.url),
	);
	assert.equal(bundle.subarray(0, 2).toString("ascii"), "PK");
});

test("CP-REAL2-PROV-01 custom-gpt setup exposes complete Controller/Dev provisioning material", () => {
	const result = spawnSync(
		process.execPath,
		[
			new URL("../dist/src/cli.js", import.meta.url).pathname,
			"custom-gpt",
			"setup",
			"--gateway-url",
			"https://gateway.example.com",
		],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
	const setup = JSON.parse(result.stdout) as Record<string, unknown>;
	assert.equal(setup.description, metadata.description);
	assert.equal(setup.recommendedModel, "gpt-5-6");
	assert.deepEqual(setup.capabilities, {
		webSearch: true,
		imageGeneration: true,
		codeInterpreter: true,
	});
	assert.equal(setup.knowledgeBundle, "knowledge/custom-gpt-knowledge.zip");
	assert.equal(setup.actionSchema, "actions/custom-gpt.openapi.yaml");
	assert.equal(setup.gatewayUrl, "https://gateway.example.com");
	assert.equal("knowledgeFiles" in setup, false);
});

test("Real-2 Controller/Dev Module.setup uses the reusable Custom GPT role API", async () => {
	const adapter = await readFile(
		new URL("../deployment/adapter.ts", import.meta.url),
		"utf8",
	);
	assert.match(
		adapter,
		/@tomflow\/proflow-execution-browser-extension\/custom-gpt-role/,
	);
	assert.match(adapter, /createCustomGptRole\(/);
	assert.match(adapter, /createWorkspaceRoleSetupClient\(/);
	assert.match(
		adapter,
		/prepareCredential: \(\) => roleClient\.prepareRoleCredential\(\)/,
	);
	assert.match(
		adapter,
		/saveRole: \(input, preparedCredential\) =>\s*roleClient\.saveCurrentRole\(input, preparedCredential\)/,
	);
	assert.doesNotMatch(
		adapter,
		/setup 0[1-4]|openCustomGptEditor|create\/update the real Custom GPT/,
	);
});
