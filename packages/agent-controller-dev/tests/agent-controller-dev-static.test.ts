import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

const metadata = JSON.parse(
	await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as { proflowAgent: { instructions: string } };
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
	const status = behaviorAdapter.status().result;
	assert.equal(status.status, "SUCCEEDED");
	assert.deepEqual(status.data, {
		configStatus: "READY",
		runtimeStatus: "UNKNOWN",
	});
	assert.equal(behaviorAdapter.preflight().result.status, "ACTION_REQUIRED");
	assert.match(
		metadata.proflowAgent.instructions,
		/REOPEN 使用原 Task-bound worker/,
	);
});
