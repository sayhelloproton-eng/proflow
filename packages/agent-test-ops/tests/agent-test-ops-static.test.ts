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
test("CP-AGT-TEST-01 instructions and Action allowlist preserve test/ops least privilege", () => {
	assert.equal(parsed.openapi, "3.1.0");
	assert.ok(parsed.security.length > 0);
	for (const path of Object.values(parsed.paths))
		for (const [method, operation] of Object.entries(path)) {
			assert.equal(typeof operation["x-openai-isConsequential"], "boolean");
			if (method === "post") assert.ok(operation.requestBody);
		}
	assert.match(
		metadata.proflowAgent.instructions,
		/test PASS 不等于 Task complete/,
	);
	assert.ok(operations.includes("executeCapability"));
	assert.equal(operations.includes("reopenNode"), false);
	assert.equal(operations.includes("startNode"), true);
	assert.doesNotMatch(openapi, /executeAnything|updateStatus|git\.push/);
	assert.doesNotMatch(openapi, /unevaluatedProperties|allOf:/);
});
test("CP-AGT-TEST-02 test result and evidence remain owner contract facts", () => {
	assert.ok(operations.includes("putTaskDocument"));
	assert.ok(operations.includes("getExecution"));
	assert.match(metadata.proflowAgent.instructions, /TaskDocument\/Evidence/);
});
test("CP-AGT-TEST-03 doctor verify recovery keep Deployment and Execution ownership", () => {
	assert.match(
		metadata.proflowAgent.instructions,
		/Deployment 或 Execution ownership/,
	);
	assert.doesNotMatch(
		openapi,
		/deployPlatform|restartGateway|setExecutionSuccess/,
	);
});
test("CP-AGT-TEST-04 provisioning/reopen real evidence remains external ACTION_REQUIRED", async () => {
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
				message: "ROLE_NOT_REGISTERED:@tomflow/proflow-agent-test-ops",
				relatedModuleRefs: [],
				nextCommand: "platform setup --module agent-test-ops",
			},
		],
	});
	assert.equal(behaviorAdapter.setup(context).result.status, "ACTION_REQUIRED");
	assert.match(metadata.proflowAgent.instructions, /REOPEN 必须复用原 worker/);
});

test("CP-REAL2-PROV-01 Test/Ops package owns complete Custom GPT provisioning material", async () => {
	const material = materializeAgentPackage(metadata);
	assert.equal(material.description, metadata.description);
	assert.equal(material.recommendedModel, "gpt-5-6");
	assert.deepEqual(material.capabilities, {
		webSearch: false,
		imageGeneration: false,
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

test("CP-REAL2-PROV-01 custom-gpt setup exposes complete Test/Ops provisioning material", () => {
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
		webSearch: false,
		imageGeneration: false,
		codeInterpreter: true,
	});
	assert.equal(setup.knowledgeBundle, "knowledge/custom-gpt-knowledge.zip");
	assert.equal(setup.actionSchema, "actions/custom-gpt.openapi.yaml");
	assert.equal(setup.gatewayUrl, "https://gateway.example.com");
	assert.equal("knowledgeFiles" in setup, false);
});
