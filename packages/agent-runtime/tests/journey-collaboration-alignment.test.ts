import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function source(): Promise<string> {
	return readFile(new URL("../src/index.ts", import.meta.url), "utf8");
}

test("CP-AGT-RUNTIME-07 v1 is exactly three fixed logical Agent Packages; registry is not Product New Task discovery", async () => {
	const productOpenApi = await readFile(
		new URL("../../agent-product/custom-gpt.openapi.yaml", import.meta.url),
		"utf8",
	);
	for (const forbidden of [
		"createTask",
		"listRegisteredRoles",
		"getRegisteredRole",
	])
		assert.doesNotMatch(
			productOpenApi,
			new RegExp(`operationId:\\s*${forbidden}\\b`),
		);
	for (const pkg of [
		"@tomflow/proflow-agent-product",
		"@tomflow/proflow-agent-controller-dev",
		"@tomflow/proflow-agent-test-ops",
	]) {
		assert.ok(pkg.startsWith("@tomflow/proflow-agent-"));
	}
});

test("CP-AGT-RUNTIME-08 credential authenticates roleRef while Task owner keeps durable worker binding", async () => {
	const text = await source();
	assert.match(text, /authenticateBearer/);
	assert.match(text, /authenticatedRoleRef/);
	assert.match(text, /task\.getTask/);
	assert.doesNotMatch(text, /CREATE TABLE IF NOT EXISTS task_role_bindings/i);
	assert.doesNotMatch(
		text,
		/credential[^\n]{0,100}(?:tabId|frameId|conversationLocator)/i,
	);
});

test("CP-AGT-RUNTIME-09 collaboration facts correlate with Task but cannot create workflow state", async () => {
	const text = await source();
	assert.match(text, /askPeer/);
	assert.match(text, /replyPeer/);
	assert.match(text, /taskId/);
	assert.doesNotMatch(
		text,
		/(?:startNode|completeNode|waitNode|reopenNode)\s*\(/,
	);
	assert.doesNotMatch(text, /INSERT INTO\s+(?:tasks|nodes|task_events)/i);
});

test("CP-AGT-RUNTIME-10 Agent Runtime owns no browser/observer scheduler identity or persistence", async () => {
	const text = await source();
	for (const forbidden of [
		/frameId/i,
		/tabId/i,
		/TaskObserver(?:Store|Repository|Scheduler)/i,
		/SystemObserver(?:Store|Repository|Scheduler)/i,
		/CarrierScheduler/i,
	])
		assert.doesNotMatch(text, forbidden);
});
