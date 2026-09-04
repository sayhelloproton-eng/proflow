import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyBrowserPermission } from "../src/browser-permission-policy.ts";

const role = {
	agentPackageRef: "@tomflow/proflow-agent-test-ops" as const,
	registeredPackageVersion: "0.1.0",
	roleRef: "g-test",
	carrierUrl: "https://chatgpt.com/g/g-test",
};
const conversationLocator = "https://chatgpt.com/g/g-test/c/worker-test";
const base = {
	role,
	validation: {
		agentPackageRef: role.agentPackageRef,
		registeredPackageVersion: role.registeredPackageVersion,
		roleRef: role.roleRef,
		carrierUrl: role.carrierUrl,
		gatewayUrl: "https://gateway.example.test",
	},
	targetHost: "gateway.example.test",
	currentGatewayUrl: "https://gateway.example.test",
	operationId: "getTask",
	context: {
		conversationLocator,
		workerRef: "worker-test",
		taskBinding: {
			agentPackageRef: role.agentPackageRef,
			roleRef: role.roleRef,
			workerRef: null,
			conversationLocator: null,
		},
	},
};

test("CP-EXE-BR-28 trusted Worker with an existing unbound Role binding defers", () => {
	assert.deepEqual(classifyBrowserPermission(base), {
		decision: "DEFER",
		reason: "TASK_BINDING_PENDING",
	});
});

test("CP-EXE-BR-28 missing, partial or conflicting binding fails closed", () => {
	for (const taskBinding of [
		null,
		{ ...base.context.taskBinding, workerRef: "worker-test" },
		{
			...base.context.taskBinding,
			workerRef: "worker-other",
			conversationLocator: "https://chatgpt.com/g/g-test/c/worker-other",
		},
	])
		assert.deepEqual(
			classifyBrowserPermission({
				...base,
				context: { ...base.context, taskBinding },
			}),
			{ decision: "HUMAN_REQUIRED", reason: "CONTEXT_MISMATCH" },
		);
});
