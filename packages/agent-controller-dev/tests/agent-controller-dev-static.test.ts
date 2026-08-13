import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const metadata = JSON.parse(
	await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as { proflowAgent: { instructions: string } };
const openapi = await readFile(
	new URL("../actions/custom-gpt.openapi.yaml", import.meta.url),
	"utf8",
);
const operations = [
	...openapi.matchAll(/operationId:\s*([A-Za-z0-9_-]+)/g),
].map((match) => match[1]);
test("CP-AGT-DEV-01 instructions and Action allowlist are role-minimal", () => {
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
	assert.equal(behaviorAdapter.status().result.status, "ACTION_REQUIRED");
	assert.match(
		metadata.proflowAgent.instructions,
		/REOPEN 使用原 Task-bound worker/,
	);
});
