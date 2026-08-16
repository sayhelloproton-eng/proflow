import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
	new URL("../src/index.ts", import.meta.url),
	"utf8",
);
const packageJson = JSON.parse(
	await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};

test("REG-HOST-COMPOSITION-01 formal owner packages stay independent while Host only composes public paths", () => {
	for (const dependency of [
		"@tomflow/proflow-task-orchestration",
		"@tomflow/proflow-agent-runtime",
	])
		assert.equal(
			packageJson.dependencies?.[dependency] !== undefined,
			true,
			dependency,
		);
	for (const service of [
		"@tomflow/proflow-execution-runtime",
		"@tomflow/proflow-model-runtime",
	])
		assert.equal(
			packageJson.devDependencies?.[service] !== undefined,
			true,
			service,
		);
	assert.doesNotMatch(
		source,
		/createExecutionRuntime\(|createModelRuntimeProcess\(|createAgentGatewayProcess\(/,
	);
});

test("REG-HOST-COMPOSITION-02 old Task Driver/authorization compatibility surface is not part of the current composition contract", () => {
	assert.doesNotMatch(source, /authorizeTask|TASK_AUTHORIZED|requiredRoleRef/);
	assert.doesNotMatch(source, /execution-runtime:task-driver/);
	assert.match(source, /requiredAgentPackageRef|agentPackageRef/);
});
