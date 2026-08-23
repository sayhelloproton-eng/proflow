import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type CustomGptEditorPort,
	createCustomGptEditorDriver,
	parseCustomGptProvisioningRequest,
} from "../src/custom-gpt-editor-driver.ts";

const request = {
	packageName: "@tomflow/proflow-agent-product",
	version: "0.1.0",
	displayName: "Product Agent",
	description: "Product role",
	instructions: "Follow product instructions",
	conversationStarters: ["Start product work", "Review requirement"],
	recommendedModel: "gpt-5-6",
	capabilities: {
		webSearch: true,
		imageGeneration: false,
		codeInterpreter: true,
	},
	knowledgeBundle: "knowledge/custom-gpt-knowledge.zip",
	actionSchema: "openapi: 3.1.0\ninfo:\n  title: test\n",
	knowledgeFiles: [
		{
			name: "proflow-knowledge-smoke.md",
			mime: "text/markdown",
			sizeBytes: 24,
			sha256: `sha256:${"a".repeat(64)}`,
			url: "http://127.0.0.1:43123/v1/provisioning/files/file-test",
		},
	],
};

test("CP-EXE-BR-19 editor driver applies package-owned draft material without inventing defaults", async () => {
	const calls: Array<{ operation: string; key?: string; value: unknown }> = [];
	const port: CustomGptEditorPort = {
		async setTextField(field, value) {
			calls.push({ operation: "text", key: field, value });
		},
		async replaceConversationStarters(values) {
			calls.push({ operation: "starters", value: values });
		},
		async selectRecommendedModel(value) {
			calls.push({ operation: "model", value });
		},
		async setCapability(capability, enabled) {
			calls.push({ operation: "capability", key: capability, value: enabled });
		},
		async installActionSchema(value) {
			calls.push({ operation: "actionSchema", value });
		},
		async uploadKnowledge(files) {
			calls.push({ operation: "knowledge", value: files });
		},
		async createPrivate() {
			calls.push({ operation: "createPrivate", value: true });
			return {
				gptId: "g-product",
				carrierUrl: "https://chatgpt.com/g/g-product",
			};
		},
	};

	const material = parseCustomGptProvisioningRequest(request);
	const result = await createCustomGptEditorDriver(port).provision(material);
	assert.equal(result.status, "LIVE_CREATED");
	assert.equal(result.gptId, "g-product");
	assert.deepEqual(calls, [
		{ operation: "text", key: "displayName", value: request.displayName },
		{ operation: "text", key: "description", value: request.description },
		{ operation: "text", key: "instructions", value: request.instructions },
		{ operation: "starters", value: request.conversationStarters },
		{ operation: "model", value: request.recommendedModel },
		{ operation: "capability", key: "webSearch", value: true },
		{ operation: "capability", key: "imageGeneration", value: false },
		{ operation: "capability", key: "codeInterpreter", value: true },
		{ operation: "actionSchema", value: request.actionSchema },
		{ operation: "knowledge", value: request.knowledgeFiles },
		{ operation: "createPrivate", value: true },
	]);
});

test("CP-EXE-BR-19 provisioning request rejects missing package-owned values", () => {
	assert.throws(
		() =>
			parseCustomGptProvisioningRequest({ ...request, recommendedModel: "" }),
		/PROVISIONING_REQUEST_INVALID/,
	);
	assert.throws(
		() => parseCustomGptProvisioningRequest({ ...request, capabilities: {} }),
		/PROVISIONING_REQUEST_INVALID/,
	);
	assert.throws(
		() => parseCustomGptProvisioningRequest({ ...request, knowledgeFiles: [] }),
		/PROVISIONING_REQUEST_INVALID/,
	);
});
