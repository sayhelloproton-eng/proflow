import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
	detectActionPermission,
	permissionActionAllowed,
} from "../src/carrier-permission.ts";
import { classifyChatGptPageSignals } from "../src/chatgpt-runtime-adapter.ts";

const currentCard = {
	text: "“部署 + 测试验收”希望与“0br1cj2q-41705.jpe1.devtunnels.ms”对话\n工具调用：0br1cj2q_41705_jpe1_devtunnels_ms__jit_plugin.getTask\n将共享以下内容：{taskId: task-a6f859c00b1accd027d53d48}",
	buttonLabels: ["始终允许", "拒绝", "允许一次"],
};

const genericAllowCard = {
	text: "“研发 + 项目总控”希望与“0br1cj2q-41705.jpe1.devtunnels.ms”对话\n工具调用：0br1cj2q_41705_jpe1_devtunnels_ms__jit_plugin.localDev",
	buttonLabels: ["拒绝", "允许"],
};

test("CP-EXE-BR-22 detects current non-dialog ChatGPT Action permission semantically", () => {
	const facts = detectActionPermission([currentCard]);
	assert.ok(facts);
	assert.equal(facts.kind, "ACTION_PERMISSION");
	assert.equal(facts.operationId, "getTask");
	assert.equal(facts.targetHost, "0br1cj2q-41705.jpe1.devtunnels.ms");
	assert.equal(facts.taskId, "task-a6f859c00b1accd027d53d48");
	assert.deepEqual(facts.actions, ["allowAlways", "deny", "allowOnce"]);
	assert.match(facts.fingerprint, /^permission:v1:/);
});

test("CP-EXE-BR-22 detects current generic Allow/Deny permission without manufacturing Task context", () => {
	const facts = detectActionPermission([genericAllowCard]);
	assert.ok(facts);
	assert.equal(facts.kind, "ACTION_PERMISSION");
	assert.equal(facts.operationId, "localDev");
	assert.equal(facts.targetHost, "0br1cj2q-41705.jpe1.devtunnels.ms");
	assert.equal(facts.taskId, null);
	assert.deepEqual(facts.actions, ["deny", "allow"]);
	assert.equal(permissionActionAllowed(facts, facts.fingerprint, "allow"), true);
});

test("CP-EXE-BR-24 semantic permission action must be present on the same fingerprint", () => {
	const current = detectActionPermission([currentCard]);
	assert.ok(current);
	assert.equal(
		permissionActionAllowed(current, current.fingerprint, "allowAlways"),
		true,
	);
	assert.equal(
		permissionActionAllowed(current, "permission:v1:stale", "allowAlways"),
		false,
	);
	assert.equal(
		permissionActionAllowed(current, current.fingerprint, "unknown"),
		false,
	);
});

test("CP-EXE-BR-22 unrelated dialog-like content is not treated as Action permission", () => {
	const facts = detectActionPermission([
		{ text: "Sign in required", buttonLabels: ["Cancel", "Continue"] },
	]);
	assert.equal(facts, null);
});

test("CP-EXE-BR-22 Action permission wins over an otherwise ready composer", () => {
	const permission = detectActionPermission([genericAllowCard]);
	assert.ok(permission);
	assert.deepEqual(
		classifyChatGptPageSignals({
			permission,
			hasDialog: true,
			isGenerating: false,
			hasComposer: true,
		}),
		{
			pageState: "BLOCKED",
			activityKind: "ACTION_PERMISSION",
			blockerFacts: permission,
		},
	);
});

test("CP-EXE-BR-27 Content stays thin and Permission trust policy has its own controller", async () => {
	const [content, background, permissionController] = await Promise.all([
		readFile(new URL("../extension/content.ts", import.meta.url), "utf8"),
		readFile(new URL("../extension/background.ts", import.meta.url), "utf8"),
		readFile(
			new URL("../extension/runtime/permission-controller.ts", import.meta.url),
			"utf8",
		),
	]);
	assert.match(content, /observeChatGptPage/);
	assert.match(content, /performChatGptPermissionAction/);
	assert.match(content, /submitChatGptComposer/);
	assert.doesNotMatch(content, /roleOperations|KNOWN_PROFLOW_ACTION|AUTO_ALLOW/);
	assert.match(background, /createPermissionController/);
	assert.doesNotMatch(background, /resolveRoutineCarrierPermission|AUTO_ALLOW/);
	assert.match(permissionController, /resolveRoutineCarrierPermission/);
	assert.match(permissionController, /browser\.permission\.classify/);
	assert.doesNotMatch(permissionController, /operationId === "getTask"/);
});
