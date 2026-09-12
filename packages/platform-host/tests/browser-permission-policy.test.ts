import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyBrowserPermission } from "../src/browser-permission-policy.ts";

const base = {
	role: {
		agentPackageRef: "@tomflow/proflow-agent-test-ops" as const,
		registeredPackageVersion: "0.1.0",
		roleRef: "g-test",
		carrierUrl: "https://chatgpt.com/g/g-test",
	},
	validation: {
		agentPackageRef: "@tomflow/proflow-agent-test-ops",
		registeredPackageVersion: "0.1.0",
		roleRef: "g-test",
		carrierUrl: "https://chatgpt.com/g/g-test",
		gatewayUrl: "https://0br1cj2q-41705.jpe1.devtunnels.ms",
	},
	targetHost: "0br1cj2q-41705.jpe1.devtunnels.ms",
	currentGatewayUrl: "https://0br1cj2q-41705.jpe1.devtunnels.ms",
	operationId: "getTask",
	context: {
		conversationLocator: "https://chatgpt.com/g/g-test/c/worker-test",
		workerRef: "worker-test",
		taskBinding: {
			agentPackageRef: "@tomflow/proflow-agent-test-ops",
			roleRef: "g-test",
			workerRef: "worker-test",
			conversationLocator: "https://chatgpt.com/g/g-test/c/worker-test",
		},
	},
};

test("CP-EXE-BR-23 trusted current Role target and operation auto-allows carrier permission", () => {
	assert.deepEqual(classifyBrowserPermission(base), {
		decision: "AUTO_ALLOW",
		reason: "KNOWN_PROFLOW_ACTION",
	});
});

test("CP-EXE-BR-23 current ChatGPT slugged conversation locator auto-allows carrier permission", () => {
	const conversationLocator =
		"https://chatgpt.com/g/g-test-bu-shu-ce-shi-yan-shou/c/worker-test";
	assert.deepEqual(
		classifyBrowserPermission({
			...base,
			context: {
				...base.context,
				conversationLocator,
				taskBinding: { ...base.context.taskBinding, conversationLocator },
			},
		}),
		{
			decision: "AUTO_ALLOW",
			reason: "KNOWN_PROFLOW_ACTION",
		},
	);
});

test("CP-EXE-BR-23 unknown target or operation fails closed", () => {
	assert.equal(
		classifyBrowserPermission({ ...base, targetHost: "evil.example" }).decision,
		"HUMAN_REQUIRED",
	);
	assert.equal(
		classifyBrowserPermission({ ...base, operationId: "unknownTool" }).decision,
		"HUMAN_REQUIRED",
	);
});

test("CP-EXE-BR-23 role/task context mismatch fails closed", () => {
	assert.deepEqual(
		classifyBrowserPermission({
			...base,
			context: {
				...base.context,
				workerRef: "worker-other",
			},
		}),
		{
			decision: "HUMAN_REQUIRED",
			reason: "CONTEXT_MISMATCH",
		},
	);
});

test("CP-EXE-BR-23 unbound or locator-mismatched Worker context fails closed", () => {
	assert.equal(
		classifyBrowserPermission({
			...base,
			context: { ...base.context, workerRef: null },
		}).decision,
		"HUMAN_REQUIRED",
	);
	assert.equal(
		classifyBrowserPermission({
			...base,
			context: {
				...base.context,
				taskBinding: { ...base.context.taskBinding, workerRef: null },
			},
		}).decision,
		"HUMAN_REQUIRED",
	);
	assert.equal(
		classifyBrowserPermission({
			...base,
			context: {
				...base.context,
				taskBinding: {
					...base.context.taskBinding,
					conversationLocator: "https://chatgpt.com/g/g-test/c/worker-other",
				},
			},
		}).decision,
		"HUMAN_REQUIRED",
	);
});

test("CP-EXE-BR-23 malformed or non-current carrier locator fails closed", () => {
	for (const conversationLocator of [
		"https://chatgpt.com/g/g-test",
		"https://chatgpt.com/g/g-other/c/worker-test",
		"https://chatgpt.com/g/g-test-/c/worker-test",
		"https://chatgpt.com/g/g-test/c/worker-test?stale=1",
	]) {
		assert.equal(
			classifyBrowserPermission({
				...base,
				context: { ...base.context, conversationLocator },
			}).decision,
			"HUMAN_REQUIRED",
		);
	}
});

test("CP-EXE-BR-23 untrusted gateway evidence scheme fails closed", () => {
	assert.deepEqual(
		classifyBrowserPermission({
			...base,
			validation: { ...base.validation, gatewayUrl: "http://evil.example" },
		}),
		{ decision: "HUMAN_REQUIRED", reason: "GATEWAY_MISMATCH" },
	);
});

test("CP-EXE-BR-23 stale validation target cannot override current Provider facts", () => {
	for (const currentGatewayUrl of [
		null,
		"https://replacement.example.test",
		"not-a-url",
	])
		assert.deepEqual(
			classifyBrowserPermission({ ...base, currentGatewayUrl }),
			{ decision: "HUMAN_REQUIRED", reason: "GATEWAY_MISMATCH" },
		);
});

test("CP-EXE-BR-23 stale role-carrier validation cannot establish trust", () => {
	assert.equal(
		classifyBrowserPermission({
			...base,
			validation: { ...base.validation, roleRef: "g-other" },
		}).decision,
		"HUMAN_REQUIRED",
	);
});
