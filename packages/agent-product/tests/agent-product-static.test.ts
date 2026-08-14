import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";
import { materializeAgentPackage } from "../src/index.ts";

const packageUrl = new URL("../package.json", import.meta.url);
const openApiUrl = new URL("../actions/custom-gpt.openapi.yaml", import.meta.url);

async function artifacts() {
	const metadata = JSON.parse(await readFile(packageUrl, "utf8")) as Record<string, unknown>;
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

test("CP-AGT-PROD-01 generic Product package does not own pre-Task creation or require Knowledge specialization in v1", async () => {
	const { metadata, material } = await artifacts();
	assert.equal(material.packageName, "@tomflow/proflow-agent-product");
	assert.equal("agent.manifest" in metadata, false);
	assert.doesNotMatch(material.instructions, /需求充分后再创建\s*Task|Worker\s*可以先于\s*Task\s*存在/);
	assert.match(material.instructions, /Requirement|需求/);
	const profile = (metadata as {
		proflowAgent?: { carrierProfiles?: { "custom-gpt"?: { requirements?: Record<string, unknown> } } };
	}).proflowAgent?.carrierProfiles?.["custom-gpt"];
	assert.ok(profile);
	assert.equal("knowledge" in (profile?.requirements ?? {}), false);
	assert.equal("knowledgeUpload" in (profile?.requirements ?? {}), false);
	assert.doesNotMatch(JSON.stringify(material.knowledgeFiles), /PRD|TEST_RESULT|TECHNICAL_DESIGN/);
});

test("CP-AGT-PROD-02 Product GPT-facing OpenAPI is static and excludes New Task / dynamic Role discovery operations", async () => {
	const { openapi } = await artifacts();
	const parsed = document(openapi);
	assert.equal(parsed.openapi, "3.1.0");
	assert.ok(parsed.security.length > 0);
	assert.deepEqual(
		new Set(operations(openapi)),
		new Set(["getTask", "putTaskDocument", "getTaskDocument", "askPeer", "replyPeer"]),
	);
	for (const path of Object.values(parsed.paths))
		for (const [method, operation] of Object.entries(path)) {
			assert.equal(operation["x-openai-isConsequential"], false);
			if (method === "post") assert.ok(operation.requestBody);
		}
	assert.doesNotMatch(openapi, /createTask|listRegisteredRoles|getRegisteredRole|executeAnything|updateStatus/i);
});

test("CP-AGT-PROD-03 + CP-AGT-PROD-04 Extension-first Task ownership is reflected by the Product surface while real c-id binding remains external", async () => {
	const { openapi, material } = await artifacts();
	assert.equal(operations(openapi).includes("createTask"), false);
	assert.equal(operations(openapi).includes("putTaskDocument"), true);
	assert.doesNotMatch(openapi, /createConversation|worker\.create|tabId|windowId|frameId/);
	assert.doesNotMatch(material.instructions, /聊天.*(?:完成|确认).*Task.*(?:READY|ACTIVE)|自然语言.*Task.*状态/i);
	const { behaviorAdapter } = await import("../deployment/adapter.ts");
	assert.equal(behaviorAdapter.status().result.status, "ACTION_REQUIRED");
});

test("CP-AGT-PROD-05 one Worker Turn permits 0..N routine Actions without Browser continue protocol", async () => {
	const { openapi } = await artifacts();
	const parsed = document(openapi);
	for (const path of Object.values(parsed.paths))
		for (const operation of Object.values(path))
			assert.equal(operation["x-openai-isConsequential"], false);
	assert.doesNotMatch(openapi, /continue(?:Worker|Turn|Conversation)|actionFinished|browserContinue|wakeAfterAction/i);
});

test("CP-AGT-PROD-06 real GPT auth/Always Allow/File Bridge proof is not faked by package-local fixtures", async () => {
	const { behaviorAdapter } = await import("../deployment/adapter.ts");
	const status = behaviorAdapter.status().result;
	assert.equal(status.status, "ACTION_REQUIRED");
	assert.match(JSON.stringify(status), /ACTION_REQUIRED|web|Custom GPT|GPT/i);
});
