import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
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
const operations = (text: string) =>
	[...text.matchAll(/operationId:\s*([A-Za-z0-9_-]+)/g)].map(
		(match) => match[1],
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
	assert.equal(
		(openapi.match(/x-openai-isConsequential:/g) ?? []).length,
		operations(openapi).length,
	);
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
