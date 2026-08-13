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
test("CP-AGT-TEST-01 instructions and Action allowlist preserve test/ops least privilege", () => {
	assert.match(
		metadata.proflowAgent.instructions,
		/test PASS 不等于 Task complete/,
	);
	assert.ok(operations.includes("executeCapability"));
	assert.equal(operations.includes("reopenNode"), false);
	assert.equal(operations.includes("startNode"), false);
	assert.doesNotMatch(openapi, /executeAnything|updateStatus|git\.push/);
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
	assert.equal(behaviorAdapter.status().result.status, "ACTION_REQUIRED");
	assert.match(metadata.proflowAgent.instructions, /REOPEN 必须复用原 worker/);
});
