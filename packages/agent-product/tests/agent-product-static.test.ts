import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";
import { materializeAgentPackage } from "../src/index.ts";

const packageUrl = new URL("../package.json", import.meta.url);
const openApiUrl = new URL(
	"../actions/custom-gpt.openapi.yaml",
	import.meta.url,
);
async function artifacts() {
	const metadata = JSON.parse(await readFile(packageUrl, "utf8")) as Record<
		string,
		unknown
	>;
	const openapi = await readFile(openApiUrl, "utf8");
	return { metadata, openapi, material: materializeAgentPackage(metadata) };
}
type OpenApiOperation = {
	operationId: string;
	"x-openai-isConsequential": boolean;
	requestBody?: unknown;
};
type OpenApi = {
	openapi: string;
	security: unknown[];
	paths: Record<string, Record<string, OpenApiOperation>>;
};
const document = (text: string) => parse(text) as OpenApi;
const operations = (text: string) =>
	Object.values(document(text).paths).flatMap((path) =>
		Object.values(path).map((operation) => operation.operationId),
	);
test("CP-AGT-PROD-01 package manifest, instructions and static Knowledge exclude dynamic Task documents", async () => {
	const { metadata, material } = await artifacts();
	assert.equal(material.packageName, "@tomflow/proflow-agent-product");
	assert.match(material.instructions, /需求充分后再创建 Task/);
	assert.match(material.instructions, /真实 Browser c-id reality/);
	assert.deepEqual(material.knowledgeFiles, [
		"context/fixed-context.md",
		"memory/memory.md",
	]);
	assert.equal("agent.manifest" in metadata, false);
	assert.doesNotMatch(
		JSON.stringify(material.knowledgeFiles),
		/PRD|TEST_RESULT|TECHNICAL_DESIGN/,
	);
});
test("CP-AGT-PROD-02 OpenAPI is static, versioned and role-minimal", async () => {
	const { openapi } = await artifacts();
	const parsed = document(openapi);
	assert.equal(parsed.openapi, "3.1.0");
	assert.ok(parsed.security.length > 0);
	assert.deepEqual(
		new Set(operations(openapi)),
		new Set([
			"listRegisteredRoles",
			"getRegisteredRole",
			"createTask",
			"getTask",
			"putTaskDocument",
			"getTaskDocument",
			"askPeer",
			"replyPeer",
		]),
	);
	for (const path of Object.values(parsed.paths))
		for (const [method, operation] of Object.entries(path)) {
			assert.equal(typeof operation["x-openai-isConsequential"], "boolean");
			if (method === "post") assert.ok(operation.requestBody);
		}
	assert.doesNotMatch(
		openapi,
		/executeAnything|updateStatus|executeCapability|dynamic|capability catalog/i,
	);
});
test("CP-AGT-PROD-03/05 real pre-Task c-id and GPT behavior remain ACTION_REQUIRED until real Carrier evidence", async () => {
	const { behaviorAdapter } = await import("../deployment/adapter.ts");
	assert.equal(behaviorAdapter.status().result.status, "ACTION_REQUIRED");
});
test("CP-AGT-PROD-04 createTask is visible while Browser identity remains external", async () => {
	const { openapi } = await artifacts();
	assert.ok(operations(openapi).includes("createTask"));
	assert.doesNotMatch(
		openapi,
		/createConversation|worker\.create|tabId|windowId/,
	);
});
