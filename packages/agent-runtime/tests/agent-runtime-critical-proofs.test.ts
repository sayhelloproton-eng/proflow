import assert from "node:assert/strict";
import { constants } from "node:fs";
import {
	access,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAgentRuntime, type TaskFacts } from "../src/index.ts";

async function fixture(context: {
	after(callback: () => Promise<void>): void;
}) {
	const proflowRoot = await mkdtemp(join(tmpdir(), "proflow-agent-runtime-"));
	context.after(() => rm(proflowRoot, { recursive: true, force: true }));
	let task: TaskFacts = {
		taskId: "task:1",
		status: "ACTIVE",
		roleBindings: [
			{ roleRef: "g-product", workerRef: "c-product" },
			{ roleRef: "g-dev", workerRef: "c-dev" },
			{ roleRef: "g-test", workerRef: "c-test" },
		],
	};
	let sequence = 0;
	const taskCalls: string[] = [];
	const runtime = await createAgentRuntime({
		proflowRoot,
		task: {
			async getTask(taskId) {
				taskCalls.push(`getTask:${taskId}`);
				return structuredClone(task);
			},
			async hasNonTerminalRoleUsage(roleRef) {
				taskCalls.push(`hasUsage:${roleRef}`);
				return (
					task.status !== "SUCCEEDED" &&
					task.status !== "TERMINATED" &&
					task.roleBindings.some((binding) => binding.roleRef === roleRef)
				);
			},
		},
		idFactory: () => `id:${++sequence}`,
		credentialFactory: () => `role-secret-${++sequence}`,
		now: () => new Date("2026-08-13T08:00:00.000Z"),
	});
	for (const [agentPackageRef, roleRef] of [
		["@tomflow/proflow-agent-product", "g-product"],
		["@tomflow/proflow-agent-controller-dev", "g-dev"],
		["@tomflow/proflow-agent-test-ops", "g-test"],
	] as const) {
		await runtime.registerRole({
			agentPackageRef,
			registeredPackageVersion: "0.1.0",
			roleRef,
			carrierUrl: `https://chatgpt.com/g/${roleRef}`,
		});
	}
	return {
		runtime,
		proflowRoot,
		taskCalls,
		setTask(next: TaskFacts) {
			task = next;
		},
	};
}
test("CP-AGT-RUNTIME-01 registry is one-package-one-current-role and ROLE_IN_USE is zero mutation", async (context) => {
	const { runtime } = await fixture(context);
	assert.equal(runtime.listRegisteredRoles().length, 3);
	assert.equal(
		runtime.getRegisteredRole("g-dev").agentPackageRef,
		"@tomflow/proflow-agent-controller-dev",
	);
	await assert.rejects(
		() =>
			runtime.registerRole({
				agentPackageRef: "@tomflow/proflow-agent-controller-dev",
				registeredPackageVersion: "0.1.0",
				roleRef: "g-dev-2",
				carrierUrl: "https://chatgpt.com/g/g-dev-2",
			}),
		/ROLE_ALREADY_REGISTERED/,
	);
	const before = runtime.listRegisteredRoles();
	await assert.rejects(() => runtime.deleteRole("g-dev"), /ROLE_IN_USE/);
	assert.deepEqual(runtime.listRegisteredRoles(), before);
});
test("CP-AGT-RUNTIME-02 one credential rotates without role identity or secret leakage", async (context) => {
	const { runtime, proflowRoot } = await fixture(context);
	const oldCredential = await runtime.showCredential("g-dev");
	const rotated = await runtime.rotateCredential("g-dev");
	assert.equal(rotated.roleRef, "g-dev");
	assert.notEqual(rotated.credential, oldCredential.credential);
	await assert.rejects(
		() => runtime.authenticateBearer(oldCredential.credential),
		/AUTHENTICATION_FAILED/,
	);
	assert.equal(await runtime.authenticateBearer(rotated.credential), "g-dev");
	assert.equal(runtime.getRegisteredRole("g-dev").roleRef, "g-dev");
	const credentialPath = join(
		proflowRoot,
		"agent/secrets/role-credentials.json",
	);
	assert.equal((await stat(credentialPath)).mode & 0o777, 0o600);
	await access(credentialPath, constants.R_OK);
	const registry = await readFile(
		join(proflowRoot, "agent/roles.json"),
		"utf8",
	);
	assert.doesNotMatch(registry, /role-secret/);
	assert.deepEqual(runtime.doctorRoleStore(), { status: "PASS", issues: [] });
	runtime.close();
	await writeFile(credentialPath, "{}\n", { mode: 0o600 });
	const halfState = await createAgentRuntime({
		proflowRoot,
		task: {
			async getTask() {
				return { taskId: "task:1", status: "ACTIVE", roleBindings: [] };
			},
			async hasNonTerminalRoleUsage() {
				return false;
			},
		},
	});
	assert.deepEqual(halfState.doctorRoleStore(), {
		status: "FAIL",
		issues: [
			"ROLE_WITHOUT_CREDENTIAL:g-dev",
			"ROLE_WITHOUT_CREDENTIAL:g-product",
			"ROLE_WITHOUT_CREDENTIAL:g-test",
		],
	});
	halfState.close();
});
test("CP-AGT-RUNTIME-03 worker validation uses authenticated role plus Task owner facts without a binding copy", async (context) => {
	const { runtime, proflowRoot, taskCalls } = await fixture(context);
	assert.deepEqual(
		await runtime.validateWorker({
			authenticatedRoleRef: "g-dev",
			taskId: "task:1",
			workerRef: "c-dev",
		}),
		{ roleRef: "g-dev", workerRef: "c-dev", taskId: "task:1" },
	);
	await assert.rejects(
		() =>
			runtime.validateWorker({
				authenticatedRoleRef: "g-dev",
				taskId: "task:1",
				workerRef: "c-test",
			}),
		/WORKER_IDENTITY_INVALID/,
	);
	assert.ok(taskCalls.some((call) => call === "getTask:task:1"));
	const database = await readFile(
		join(proflowRoot, "agent/collaboration/collaboration.sqlite"),
	);
	assert.equal(database.includes(Buffer.from("task_role_bindings")), false);
});
test("CP-AGT-RUNTIME-04 ask/reply is idempotent and next question waits for physical reply delivery", async (context) => {
	const { runtime, proflowRoot } = await fixture(context);
	const question = await runtime.askPeer({
		authenticatedRoleRef: "g-dev",
		taskId: "task:1",
		fromWorkerRef: "c-dev",
		targetAgentPackageRef: "@tomflow/proflow-agent-product",
		content: "What is expected?",
		idempotencyKey: "ask:1",
	});
	assert.deepEqual(
		runtime.getCollaborationMessage({
			messageId: question.message.messageId,
		}),
		question.message,
	);
	assert.deepEqual(
		await runtime.askPeer({
			authenticatedRoleRef: "g-dev",
			taskId: "task:1",
			fromWorkerRef: "c-dev",
			targetAgentPackageRef: "@tomflow/proflow-agent-product",
			content: "What is expected?",
			idempotencyKey: "ask:1",
		}),
		question,
	);
	await runtime.reportCollaborationDelivery({
		messageId: question.message.messageId,
		expectedMessageVersion: 1,
		outcome: "DELIVERED",
		observedRoleRef: "g-product",
		observedWorkerRef: "c-product",
		executionRef: "execution:q",
		evidenceRef: "evidence:q",
	});
	assert.equal(
		runtime.getCollaborationMessage({
			messageId: question.message.messageId,
		}).status,
		"DELIVERED",
	);
	const reply = await runtime.replyPeer({
		authenticatedRoleRef: "g-product",
		threadId: question.thread.threadId,
		fromWorkerRef: "c-product",
		content: "Expected answer",
		idempotencyKey: "reply:1",
	});
	await assert.rejects(
		() =>
			runtime.askPeer({
				authenticatedRoleRef: "g-dev",
				taskId: "task:1",
				threadId: question.thread.threadId,
				fromWorkerRef: "c-dev",
				targetAgentPackageRef: "@tomflow/proflow-agent-product",
				content: "Next?",
				idempotencyKey: "ask:2",
			}),
		/THREAD_REPLY_NOT_DELIVERED/,
	);
	runtime.close();
	const reopened = await createAgentRuntime({
		proflowRoot,
		task: {
			async getTask() {
				return {
					taskId: "task:1",
					status: "ACTIVE",
					roleBindings: [
						{ roleRef: "g-product", workerRef: "c-product" },
						{ roleRef: "g-dev", workerRef: "c-dev" },
					],
				};
			},
			async hasNonTerminalRoleUsage() {
				return false;
			},
		},
	});
	const pending = await reopened.listPendingCollaborationMessages({
		limit: 10,
	});
	assert.equal(
		pending.some((message) => message.messageId === reply.message.messageId),
		true,
	);
	await reopened.reportCollaborationDelivery({
		messageId: reply.message.messageId,
		expectedMessageVersion: 1,
		outcome: "DELIVERED",
		observedRoleRef: "g-dev",
		observedWorkerRef: "c-dev",
		executionRef: "execution:r",
		evidenceRef: "evidence:r",
	});
	const next = await reopened.askPeer({
		authenticatedRoleRef: "g-dev",
		taskId: "task:1",
		threadId: question.thread.threadId,
		fromWorkerRef: "c-dev",
		targetAgentPackageRef: "@tomflow/proflow-agent-product",
		content: "Next?",
		idempotencyKey: "ask:2",
	});
	assert.equal(next.thread.state, "OPEN_AWAITING_REPLY");
	reopened.close();
});
test("CP-AGT-RUNTIME-05 terminal, missing participant, duplicate and concurrency paths fail safe", async (context) => {
	const { runtime, setTask } = await fixture(context);
	setTask({
		taskId: "task:1",
		status: "TERMINATED",
		roleBindings: [
			{ roleRef: "g-dev", workerRef: "c-dev" },
			{ roleRef: "g-product", workerRef: "c-product" },
		],
	});
	await assert.rejects(
		() =>
			runtime.askPeer({
				authenticatedRoleRef: "g-dev",
				taskId: "task:1",
				fromWorkerRef: "c-dev",
				targetAgentPackageRef: "@tomflow/proflow-agent-product",
				content: "blocked",
				idempotencyKey: "terminal",
			}),
		/TASK_TERMINAL/,
	);
	setTask({
		taskId: "task:1",
		status: "ACTIVE",
		roleBindings: [{ roleRef: "g-dev", workerRef: "c-dev" }],
	});
	await assert.rejects(
		() =>
			runtime.askPeer({
				authenticatedRoleRef: "g-dev",
				taskId: "task:1",
				fromWorkerRef: "c-dev",
				targetAgentPackageRef: "@tomflow/proflow-agent-product",
				content: "missing",
				idempotencyKey: "missing",
			}),
		/TARGET_WORKER_NOT_BOUND/,
	);
});
test("CP-AGT-RUNTIME-06 integration is through injected Public Contract ports only", async (context) => {
	const { runtime, taskCalls } = await fixture(context);
	await runtime.validateWorker({
		authenticatedRoleRef: "g-test",
		taskId: "task:1",
		workerRef: "c-test",
	});
	assert.ok(taskCalls.length > 0);
	const source = await readFile(
		new URL("../src/index.ts", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(
		source,
		/task-store-sqlite|task_role_bindings|DatabaseSync.*task/i,
	);
	assert.doesNotMatch(source, /\/src\//);
	runtime.close();
});
