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

test("task-agnostic permission accepts the same durable Worker identity reused by multiple Tasks", () => {
	assert.deepEqual(
		resolveBrowserPermissionTaskBinding({
			...complete,
			...owner({ "task:old": [complete], "task:fresh": [complete] }),
		}),
		complete,
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

for (const conflict of [
	{ ...complete, conversationLocator: "https://chatgpt.com/g/g-dev/c/stale" },
	{ ...complete, workerRef: "c-other" },
	{ ...complete, agentPackageRef: "foreign-package" },
]) {
	test(`task-agnostic permission rejects conflicting durable bindings: ${JSON.stringify(conflict)}`, () => {
		for (const bindings of [[complete, conflict], [conflict, complete]]) {
			assert.equal(
				resolveBrowserPermissionTaskBinding({
					...complete,
					...owner({ "task:a": [bindings[0]!], "task:b": [bindings[1]!] }),
				}),
				null,
			);
		}
	});
}

test("an unreadable candidate prevents trust even after an exact match", () => {
	assert.equal(
		resolveBrowserPermissionTaskBinding({
			...complete,
			listTaskIds: () => ["task:good", "task:unreadable"],
			getRoleBindings: (taskId) => (taskId === "task:good" ? [complete] : null),
		}),
		null,
	);
});

test("task-scoped lookup never falls back to another task and rejects duplicate roles", () => {
	for (const bindings of [[], [complete, complete]]) {
		assert.equal(
			resolveBrowserPermissionTaskBinding({
				...complete,
				taskId: "task:requested",
				...owner({ "task:requested": bindings, "task:other": [complete] }),
			}),
			null,
		);
	}
});
