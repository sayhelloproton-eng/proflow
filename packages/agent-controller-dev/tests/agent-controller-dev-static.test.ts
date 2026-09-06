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
	components: { schemas: Record<string, Record<string, unknown>> };
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

test("B1-AGT-DEV-01 Action schemas match Task owner versions and exact node-scoped file.read", () => {
	const schemas = parsed.components.schemas;
	const reopen = schemas.ReopenNodeInput;
	assert.ok(reopen);
	assert.deepEqual(reopen.required, [
		"taskId",
		"nodeId",
		"expectedTaskVersion",
		"idempotencyKey",
		"reason",
	]);
	assert.equal("expectedNodeVersion" in (reopen.properties as object), false);
	const document = schemas.PutTaskDocumentInput;
	assert.ok(document);
	assert.equal("expectedNodeVersion" in (document.properties as object), false);
	assert.deepEqual((document.properties as Record<string, unknown>).nodeId, {
		type: ["string", "null"],
	});
	const execute = schemas.ExecuteCapabilityInput;
	assert.ok(execute);
	for (const field of ["taskId", "nodeId", "runNo"])
		assert.ok((execute.required as string[]).includes(field));
	assert.equal("workerRef" in (execute.properties as object), false);
	assert.equal("projectRoot" in (execute.properties as object), false);
	const fileRead = (execute.anyOf as Array<Record<string, unknown>>)[0];
	assert.ok(fileRead);
	assert.deepEqual(
		(fileRead.properties as Record<string, unknown>).capability,
		{ type: "string", const: "file.read" },
	);
	assert.deepEqual((fileRead.properties as Record<string, unknown>).input, {
		$ref: "#/components/schemas/FileReadInput",
	});
	assert.deepEqual(schemas.FileReadInput, {
		type: "object",
		additionalProperties: false,
		required: ["path"],
		properties: {
			path: { type: "string" },
			encoding: { type: "string", const: "utf8" },
		},
	});
	assert.match(
		metadata.proflowAgent.instructions,
		/waitNode 只用于真实业务阻塞/,
	);
	assert.match(
		metadata.proflowAgent.instructions,
		/尚未形成可信 run 失败结论时保持 Node IN_PROGRESS/,
	);
	assert.match(
		metadata.proflowAgent.instructions,
		/UNKNOWN side effect 禁止盲重放/,
	);
});
test("CP-AGT-DEV-03 sandbox artifact is explicitly not real apply", () => {
	assert.match(
		metadata.proflowAgent.instructions,
		/sandbox artifact，不等于真实 repo apply/,
	);
});
test("CP-AGT-DEV-04 provisioning waits for Browser/Gateway prerequisites before any Role action", async () => {
	const { behaviorAdapter } = await import("../deployment/adapter.ts");
	const context = { workspaceRoot: "/__proflow_missing_agent_fixture__" };
	const status = (await behaviorAdapter.status(context)).result;
	assert.equal(status.status, "SUCCEEDED");
	assert.deepEqual(status.data, {
		setupStatus: "BLOCKED",
		runtimeStatus: "NOT_APPLICABLE",
		issues: [
			{
				scope: "SETUP",
				code: "UPSTREAM_NOT_READY",
				message:
					"等待 agent-gateway、execution-browser-extension 就绪后自动继续",
				relatedModuleRefs: ["agent-gateway", "execution-browser-extension"],
				nextCommand: "platform setup",
			},
		],
	});
	const setup = (await behaviorAdapter.setup(context)).result;
	assert.equal(setup.status, "SUCCEEDED");
	assert.deepEqual(setup.data, {
		waitingFor: ["agent-gateway", "execution-browser-extension"],
	});
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

test("REAL3-D1 Controller/Dev exposes explicit fail-closed Role adoption guidance", async () => {
	const [cli, adapter] = await Promise.all([
		readFile(new URL("../src/cli.ts", import.meta.url), "utf8"),
		readFile(new URL("../deployment/adapter.ts", import.meta.url), "utf8"),
	]);
	assert.match(cli, /role adopt https:\/\/chatgpt\.com\/g\/g-/);
	assert.match(cli, /adoptCurrentRoleVersion/);
	assert.doesNotMatch(cli, /updateRole|replaceRole/);
	assert.match(adapter, /resolve-custom-gpt-role-drift/);
	assert.match(adapter, /role adopt/);
	assert.match(adapter, /does not edit an existing GPT/i);
});
