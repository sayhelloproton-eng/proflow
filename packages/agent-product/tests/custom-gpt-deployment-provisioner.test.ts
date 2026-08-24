import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";

test("Real-2 agent-product Module.setup uses the reusable Custom GPT role API", async () => {
	const adapter = await readFile(
		new URL("../deployment/adapter.ts", import.meta.url),
		"utf8",
	);
	assert.match(
		adapter,
		/@tomflow\/proflow-execution-browser-extension\/custom-gpt-role/,
	);
	assert.match(adapter, /createCustomGptRole\(/);
	assert.match(adapter, /createWorkspaceRoleSetupClient\(/);
	assert.match(
		adapter,
		/saveRole: \(input\) => roleClient\.saveCurrentRole\(input\)/,
	);
	assert.match(
		adapter,
		/inspectRole: \(input\) => roleClient\.inspectRole\(input\)/,
	);
	assert.match(adapter, /reality\.status === "MISSING"/);
	assert.match(adapter, /provisioningStatus: result\.status/);
	assert.doesNotMatch(adapter, /gpts\/editor\/\$\{|editExisting|fallbackEdit/i);
	assert.doesNotMatch(
		adapter,
		/setupPlan|setup 0[1-4]|openCustomGptEditor|打开编辑器|复制公开 URL/,
	);
});

test("Real-2 agent-product no longer owns a private Custom GPT provisioner", async () => {
	await assert.rejects(
		access(
			new URL("../src/custom-gpt-deployment-provisioner.ts", import.meta.url),
		),
	);
});
