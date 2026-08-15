import assert from "node:assert/strict";
import { constants } from "node:fs";
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
			{
				agentPackageRef: "@tomflow/proflow-agent-product",
				roleRef: "g-product",
				workerRef: "c-product",
				conversationLocator: "https://chatgpt.com/g/g-product/c/c-product",
			},
			{
				agentPackageRef: "@tomflow/proflow-agent-controller-dev",
				roleRef: "g-dev",
				workerRef: "c-dev",
				conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
			},
			{
				agentPackageRef: "@tomflow/proflow-agent-test-ops",
				roleRef: "g-test",
				workerRef: "c-test",
				conversationLocator: "https://chatgpt.com/g/g-test/c/c-test",
			},
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
	await assert.rejects(() =>
		runtime.registerRole({
			agentPackageRef: "@tomflow/proflow-agent-product",
			registeredPackageVersion: "0.1.0",
			roleRef: "g-product-mismatch",
			carrierUrl: "https://chatgpt.com/g/g-other",
		}),
	);
	await assert.rejects(() =>
		runtime.registerRole({
			agentPackageRef: "@tomflow/proflow-agent-unknown",
			registeredPackageVersion: "0.1.0",
			roleRef: "g-unknown",
			carrierUrl: "https://chatgpt.com/g/g-unknown",
		}),
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
						{
							agentPackageRef: "@tomflow/proflow-agent-product",
							roleRef: "g-product",
							workerRef: "c-product",
							conversationLocator:
								"https://chatgpt.com/g/g-product/c/c-product",
						},
						{
							agentPackageRef: "@tomflow/proflow-agent-controller-dev",
							roleRef: "g-dev",
							workerRef: "c-dev",
							conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
						},
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
test("RF-AGT-RUNTIME-04 an existing pair thread cannot be retargeted to a third Task participant", async (context) => {
	const { runtime } = await fixture(context);
	const question = await runtime.askPeer({
		authenticatedRoleRef: "g-dev",
		taskId: "task:1",
		fromWorkerRef: "c-dev",
		targetAgentPackageRef: "@tomflow/proflow-agent-product",
		content: "Pair-bound question",
		idempotencyKey: "pair:ask:1",
	});
	await runtime.reportCollaborationDelivery({
		messageId: question.message.messageId,
		expectedMessageVersion: question.message.version,
		outcome: "DELIVERED",
		observedRoleRef: "g-product",
		observedWorkerRef: "c-product",
		executionRef: "execution:pair:q",
		evidenceRef: "evidence:pair:q",
	});
	const reply = await runtime.replyPeer({
		authenticatedRoleRef: "g-product",
		threadId: question.thread.threadId,
		fromWorkerRef: "c-product",
		content: "Pair-bound reply",
		idempotencyKey: "pair:reply:1",
	});
	await runtime.reportCollaborationDelivery({
		messageId: reply.message.messageId,
		expectedMessageVersion: reply.message.version,
		outcome: "DELIVERED",
		observedRoleRef: "g-dev",
		observedWorkerRef: "c-dev",
		executionRef: "execution:pair:r",
		evidenceRef: "evidence:pair:r",
	});
	await assert.rejects(
		() =>
			runtime.askPeer({
				authenticatedRoleRef: "g-dev",
				taskId: "task:1",
				threadId: question.thread.threadId,
				fromWorkerRef: "c-dev",
				targetAgentPackageRef: "@tomflow/proflow-agent-test-ops",
				content: "Illegal third-participant retarget",
				idempotencyKey: "pair:ask:retarget",
			}),
		/THREAD_TARGET_MISMATCH/,
	);
});

test("CP-AGT-RUNTIME-05 terminal, missing participant, duplicate and concurrency paths fail safe", async (context) => {
	const { runtime, setTask } = await fixture(context);
	setTask({
		taskId: "task:1",
		status: "TERMINATED",
		roleBindings: [
			{
				agentPackageRef: "@tomflow/proflow-agent-controller-dev",
				roleRef: "g-dev",
				workerRef: "c-dev",
				conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
			},
			{
				agentPackageRef: "@tomflow/proflow-agent-product",
				roleRef: "g-product",
				workerRef: "c-product",
				conversationLocator: "https://chatgpt.com/g/g-product/c/c-product",
			},
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
		roleBindings: [
			{
				agentPackageRef: "@tomflow/proflow-agent-controller-dev",
				roleRef: "g-dev",
				workerRef: "c-dev",
				conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
			},
		],
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
test("B2-AGT-01 DELIVERED outcome requires non-empty executionRef and evidenceRef", async (context) => {
	const { runtime } = await fixture(context);
	const question = await runtime.askPeer({
		authenticatedRoleRef: "g-dev",
		taskId: "task:1",
		fromWorkerRef: "c-dev",
		targetAgentPackageRef: "@tomflow/proflow-agent-product",
		content: "delivery proof",
		idempotencyKey: "deliver:1",
	});
	await assert.rejects(
		() =>
			runtime.reportCollaborationDelivery({
				messageId: question.message.messageId,
				expectedMessageVersion: 1,
				outcome: "DELIVERED",
				observedRoleRef: "g-product",
				observedWorkerRef: "c-product",
			}),
		/executionRef/,
	);
	await assert.rejects(
		() =>
			runtime.reportCollaborationDelivery({
				messageId: question.message.messageId,
				expectedMessageVersion: 1,
				outcome: "DELIVERED",
				observedRoleRef: "g-product",
				observedWorkerRef: "c-product",
				executionRef: "execution:q",
			}),
		/evidenceRef/,
	);
	assert.equal(
		runtime.getCollaborationMessage({ messageId: question.message.messageId })
			.status,
		"PENDING",
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
		runtime.getCollaborationMessage({ messageId: question.message.messageId })
			.status,
		"DELIVERED",
	);
	runtime.close();
});
test("B2-AGT-02 reply DELIVERED thread transition is atomic and checks its own row", async (context) => {
	const { runtime, proflowRoot } = await fixture(context);
	const question = await runtime.askPeer({
		authenticatedRoleRef: "g-dev",
		taskId: "task:1",
		fromWorkerRef: "c-dev",
		targetAgentPackageRef: "@tomflow/proflow-agent-product",
		content: "What is expected?",
		idempotencyKey: "atomic:ask",
	});
	await runtime.reportCollaborationDelivery({
		messageId: question.message.messageId,
		expectedMessageVersion: 1,
		outcome: "DELIVERED",
		observedRoleRef: "g-product",
		observedWorkerRef: "c-product",
		executionRef: "execution:q",
		evidenceRef: "evidence:q",
	});
	const reply = await runtime.replyPeer({
		authenticatedRoleRef: "g-product",
		threadId: question.thread.threadId,
		fromWorkerRef: "c-product",
		content: "answer",
		idempotencyKey: "atomic:reply",
	});
	const db = new DatabaseSync(
		join(proflowRoot, "agent/collaboration/collaboration.sqlite"),
	);
	db.prepare(
		"UPDATE collaboration_threads SET state='OPEN_CAN_ASK' WHERE thread_id=?",
	).run(reply.thread.threadId);
	db.close();
	await assert.rejects(
		() =>
			runtime.reportCollaborationDelivery({
				messageId: reply.message.messageId,
				expectedMessageVersion: 1,
				outcome: "DELIVERED",
				observedRoleRef: "g-dev",
				observedWorkerRef: "c-dev",
				executionRef: "execution:r",
				evidenceRef: "evidence:r",
			}),
		/COLLABORATION_VERSION_CONFLICT/,
	);
	assert.equal(
		runtime.getCollaborationMessage({ messageId: reply.message.messageId })
			.status,
		"PENDING",
	);
	runtime.close();
});
test("B2-AGT-03 FAILED/UNKNOWN delivery update refuses a silent stale no-op", async (context) => {
	const proflowRoot = await mkdtemp(join(tmpdir(), "proflow-agent-runtime-"));
	context.after(() => rm(proflowRoot, { recursive: true, force: true }));
	let sequence = 0;
	let mutate = false;
	let questionId = "";
	const runtime = await createAgentRuntime({
		proflowRoot,
		task: {
			async getTask(taskId) {
				if (mutate) {
					mutate = false;
					const db = new DatabaseSync(
						join(proflowRoot, "agent/collaboration/collaboration.sqlite"),
					);
					db.prepare(
						"UPDATE collaboration_messages SET status='DELIVERED', version=version+1 WHERE message_id=?",
					).run(questionId);
					db.close();
				}
				return {
					taskId,
					status: "ACTIVE",
					roleBindings: [
						{
							agentPackageRef: "@tomflow/proflow-agent-product",
							roleRef: "g-product",
							workerRef: "c-product",
							conversationLocator:
								"https://chatgpt.com/g/g-product/c/c-product",
						},
						{
							agentPackageRef: "@tomflow/proflow-agent-controller-dev",
							roleRef: "g-dev",
							workerRef: "c-dev",
							conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
						},
					],
				};
			},
			async hasNonTerminalRoleUsage() {
				return false;
			},
		},
		idFactory: () => `id:${++sequence}`,
		credentialFactory: () => `secret-${++sequence}`,
		now: () => new Date("2026-08-13T08:00:00.000Z"),
	});
	await runtime.registerRole({
		agentPackageRef: "@tomflow/proflow-agent-product",
		registeredPackageVersion: "0.1.0",
		roleRef: "g-product",
		carrierUrl: "https://chatgpt.com/g/g-product",
	});
	await runtime.registerRole({
		agentPackageRef: "@tomflow/proflow-agent-controller-dev",
		registeredPackageVersion: "0.1.0",
		roleRef: "g-dev",
		carrierUrl: "https://chatgpt.com/g/g-dev",
	});
	const question = await runtime.askPeer({
		authenticatedRoleRef: "g-dev",
		taskId: "task:1",
		fromWorkerRef: "c-dev",
		targetAgentPackageRef: "@tomflow/proflow-agent-product",
		content: "stale row",
		idempotencyKey: "stale:1",
	});
	questionId = question.message.messageId;
	mutate = true;
	await assert.rejects(
		() =>
			runtime.reportCollaborationDelivery({
				messageId: question.message.messageId,
				expectedMessageVersion: 1,
				outcome: "FAILED",
				observedRoleRef: "g-product",
				observedWorkerRef: "c-product",
				errorCode: "TRANSPORT_ERROR",
			}),
		/COLLABORATION_VERSION_CONFLICT/,
	);
	runtime.close();
});
test("B2-AGT-07 UNKNOWN delivery stays durable PENDING for external reconciliation without Agent-side replay", async (context) => {
	const { runtime } = await fixture(context);
	const question = await runtime.askPeer({
		authenticatedRoleRef: "g-dev",
		taskId: "task:1",
		fromWorkerRef: "c-dev",
		targetAgentPackageRef: "@tomflow/proflow-agent-product",
		content: "uncertain physical delivery",
		idempotencyKey: "unknown:ask",
	});
	const uncertain = await runtime.reportCollaborationDelivery({
		messageId: question.message.messageId,
		expectedMessageVersion: question.message.version,
		outcome: "UNKNOWN",
		observedRoleRef: "g-product",
		observedWorkerRef: "c-product",
		executionRef: "execution:unknown",
		evidenceRef: "evidence:unknown",
		errorCode: "UNKNOWN_SIDE_EFFECT",
	});
	assert.equal(uncertain.status, "PENDING");
	assert.equal(uncertain.deliveryAttemptCount, 1);
	assert.equal(uncertain.lastDeliveryErrorCode, "UNKNOWN_SIDE_EFFECT");
	assert.equal(uncertain.executionRef, "execution:unknown");
	assert.equal(uncertain.evidenceRef, "evidence:unknown");
	assert.equal(uncertain.version, question.message.version + 1);
	const pending = await runtime.listPendingCollaborationMessages({ limit: 10 });
	assert.equal(pending.length, 1);
	assert.equal(pending[0]?.messageId, question.message.messageId);
	assert.equal(pending[0]?.deliveryAttemptCount, 1);
	assert.equal(
		runtime.getCollaborationMessage({ messageId: question.message.messageId })
			.version,
		uncertain.version,
	);
	// Agent owns the durable logical fact only. It does not schedule or synthesize
	// a second physical delivery attempt; Browser/Execution must reconcile reality.
	runtime.close();
});

test("B2-AGT-04 terminal PENDING history never starves later active pending messages", async (context) => {
	const proflowRoot = await mkdtemp(join(tmpdir(), "proflow-agent-runtime-"));
	context.after(() => rm(proflowRoot, { recursive: true, force: true }));
	let sequence = 0;
	const tasks = new Map<string, TaskFacts>([
		[
			"task:terminal",
			{
				taskId: "task:terminal",
				status: "ACTIVE",
				roleBindings: [
					{
						agentPackageRef: "@tomflow/proflow-agent-product",
						roleRef: "g-product",
						workerRef: "c-product",
						conversationLocator: "https://chatgpt.com/g/g-product/c/c-product",
					},
					{
						agentPackageRef: "@tomflow/proflow-agent-controller-dev",
						roleRef: "g-dev",
						workerRef: "c-dev",
						conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
					},
				],
			},
		],
		[
			"task:active",
			{
				taskId: "task:active",
				status: "ACTIVE",
				roleBindings: [
					{
						agentPackageRef: "@tomflow/proflow-agent-product",
						roleRef: "g-product",
						workerRef: "c-product",
						conversationLocator: "https://chatgpt.com/g/g-product/c/c-product",
					},
					{
						agentPackageRef: "@tomflow/proflow-agent-controller-dev",
						roleRef: "g-dev",
						workerRef: "c-dev",
						conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
					},
				],
			},
		],
	]);
	const runtime = await createAgentRuntime({
		proflowRoot,
		task: {
			async getTask(taskId) {
				return structuredClone(tasks.get(taskId) as TaskFacts);
			},
			async hasNonTerminalRoleUsage() {
				return false;
			},
		},
		idFactory: () => `id:${++sequence}`,
		credentialFactory: () => `secret-${++sequence}`,
		now: () => new Date("2026-08-13T08:00:00.000Z"),
	});
	await runtime.registerRole({
		agentPackageRef: "@tomflow/proflow-agent-product",
		registeredPackageVersion: "0.1.0",
		roleRef: "g-product",
		carrierUrl: "https://chatgpt.com/g/g-product",
	});
	await runtime.registerRole({
		agentPackageRef: "@tomflow/proflow-agent-controller-dev",
		registeredPackageVersion: "0.1.0",
		roleRef: "g-dev",
		carrierUrl: "https://chatgpt.com/g/g-dev",
	});
	for (let index = 0; index < 3; index += 1)
		await runtime.askPeer({
			authenticatedRoleRef: "g-dev",
			taskId: "task:terminal",
			fromWorkerRef: "c-dev",
			targetAgentPackageRef: "@tomflow/proflow-agent-product",
			content: `terminal ${index}`,
			idempotencyKey: `terminal:${index}`,
		});
	for (let index = 0; index < 2; index += 1)
		await runtime.askPeer({
			authenticatedRoleRef: "g-dev",
			taskId: "task:active",
			fromWorkerRef: "c-dev",
			targetAgentPackageRef: "@tomflow/proflow-agent-product",
			content: `active ${index}`,
			idempotencyKey: `active:${index}`,
		});
	(tasks.get("task:terminal") as TaskFacts).status = "SUCCEEDED";
	const pending = await runtime.listPendingCollaborationMessages({ limit: 2 });
	assert.equal(pending.length, 2);
	assert.ok(pending.every((message) => message.taskId === "task:active"));
	runtime.close();
});
test("B2-AGT-05 terminal task delivery report never mutates historical PENDING messages", async (context) => {
	const { runtime, setTask } = await fixture(context);
	const question = await runtime.askPeer({
		authenticatedRoleRef: "g-dev",
		taskId: "task:1",
		fromWorkerRef: "c-dev",
		targetAgentPackageRef: "@tomflow/proflow-agent-product",
		content: "history",
		idempotencyKey: "hist:1",
	});
	setTask({
		taskId: "task:1",
		status: "TERMINATED",
		roleBindings: [
			{
				agentPackageRef: "@tomflow/proflow-agent-controller-dev",
				roleRef: "g-dev",
				workerRef: "c-dev",
				conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
			},
			{
				agentPackageRef: "@tomflow/proflow-agent-product",
				roleRef: "g-product",
				workerRef: "c-product",
				conversationLocator: "https://chatgpt.com/g/g-product/c/c-product",
			},
		],
	});
	await assert.rejects(
		() =>
			runtime.reportCollaborationDelivery({
				messageId: question.message.messageId,
				expectedMessageVersion: 1,
				outcome: "DELIVERED",
				observedRoleRef: "g-product",
				observedWorkerRef: "c-product",
				executionRef: "execution:q",
				evidenceRef: "evidence:q",
			}),
		/TASK_TERMINAL/,
	);
	assert.equal(
		runtime.getCollaborationMessage({ messageId: question.message.messageId })
			.status,
		"PENDING",
	);
	runtime.close();
});
test("B2-AGT-06 rotateCredential publishes only durable current authority", async (context) => {
	const { runtime, proflowRoot } = await fixture(context);
	const oldCredential = (await runtime.showCredential("g-dev")).credential;
	const credentialPath = join(
		proflowRoot,
		"agent/secrets/role-credentials.json",
	);
	const durableBefore = await readFile(credentialPath, "utf8");
	await rm(credentialPath);
	await mkdir(credentialPath);
	await assert.rejects(() => runtime.rotateCredential("g-dev"));
	assert.equal(
		(await runtime.showCredential("g-dev")).credential,
		oldCredential,
	);
	// If the durable authority is unavailable, authentication fails closed instead
	// of serving a stale in-memory credential snapshot.
	await assert.rejects(
		() => runtime.authenticateBearer(oldCredential),
		/AUTHENTICATION_FAILED/,
	);
	await rm(credentialPath, { recursive: true });
	await writeFile(credentialPath, durableBefore, { mode: 0o600 });
	assert.equal(await runtime.authenticateBearer(oldCredential), "g-dev");
	runtime.close();
});
