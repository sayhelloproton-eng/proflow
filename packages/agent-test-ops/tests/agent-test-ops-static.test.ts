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
	});
	assert.equal(behaviorAdapter.setup(context).result.status, "ACTION_REQUIRED");
	assert.match(metadata.proflowAgent.instructions, /REOPEN 必须复用原 worker/);
});
