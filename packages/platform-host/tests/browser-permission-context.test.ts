import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveBrowserPermissionTaskBinding } from "../src/browser-permission-context.ts";

const complete = {
	agentPackageRef: "@tomflow/proflow-agent-controller-dev",
	roleRef: "g-dev",
	workerRef: "c-dev",
	conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
};
const pending = {
	...complete,
	workerRef: null,
	conversationLocator: null,
};

function owner(tasks: Record<string, Array<typeof complete | typeof pending>>) {
	return {
		listTaskIds: () => Object.keys(tasks),
		getRoleBindings: (taskId: string) => tasks[taskId] ?? null,
	};
}

test("task-scoped permission preserves the exact Task binding including pending state", () => {
	assert.deepEqual(
		resolveBrowserPermissionTaskBinding({
			taskId: "task:new",
			agentPackageRef: complete.agentPackageRef,
			roleRef: complete.roleRef,
			workerRef: null,
			conversationLocator: complete.conversationLocator,
			...owner({ "task:new": [pending], "task:old": [complete] }),
		}),
		pending,
	);
});

test("task-agnostic permission resolves only the same durable Worker conversation", () => {
	assert.deepEqual(
		resolveBrowserPermissionTaskBinding({
			agentPackageRef: complete.agentPackageRef,
			roleRef: complete.roleRef,
			workerRef: complete.workerRef,
			conversationLocator: complete.conversationLocator,
			...owner({ "task:old": [complete] }),
		}),
		complete,
	);
	assert.equal(
		resolveBrowserPermissionTaskBinding({
			agentPackageRef: complete.agentPackageRef,
			roleRef: complete.roleRef,
			workerRef: complete.workerRef,
			conversationLocator: "https://chatgpt.com/g/g-dev/c/c-other",
			...owner({ "task:old": [complete] }),
		}),
		null,
	);
});

test("task-agnostic permission never trusts an unbound or unknown worker", () => {
	assert.equal(
		resolveBrowserPermissionTaskBinding({
			agentPackageRef: complete.agentPackageRef,
			roleRef: complete.roleRef,
			workerRef: null,
			conversationLocator: complete.conversationLocator,
			...owner({ "task:new": [pending] }),
		}),
		null,
	);
});
