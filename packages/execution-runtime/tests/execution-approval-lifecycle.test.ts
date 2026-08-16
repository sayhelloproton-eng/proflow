import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { createLocalExecutorPort } from "../src/executors/local-adapter.ts";
import {
	createExecutionRuntime,
	type ExecutionExecutorPort,
} from "../src/index.ts";

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "proflow-approval-owner-"));
	await writeFile(join(root, "package.json"), "{}");
	const executor: ExecutionExecutorPort = {
		execute: async ({ onEffectStarted }) => {
			await onEffectStarted?.({
				kind: "file.write",
				capability: "file.write",
				path: "danger.txt",
				beforeHash: "sha256:before",
				expectedAfterHash: "sha256:after",
			});
			return {
				successful: true,
				effectApplied: true,
				result: {
					capability: "file.write",
					data: { path: "danger.txt", bytes: 1, afterHash: "sha256:after" },
				},
				evidence: [],
				artifacts: [],
			};
		},
		reconcile: async () => ({ state: "NOT_APPLIED", evidence: [] }),
		readArtifact: async () => ({
			chunk: "",
			nextOffset: 0,
			eof: true,
			bytes: 0,
		}),
	};
	let now = new Date("2026-08-16T00:00:00.000Z");
	const runtime = await createExecutionRuntime({
		databasePath: join(root, ".proflow", "execution.db"),
		localExecutor: executor,
		now: () => now,
		policy: {
			decide: () => ({
				decision: "REVIEW",
				decisionPath: "reason",
				approvalRequired: true,
			}),
		},
		modelDecision: {
			decide: async () => ({
				decision: "ALLOW",
				decisionPath: "reason",
				approvalRequired: true,
			}),
		},
	});
	return {
		runtime,
		setNow(value: string) {
			now = new Date(value);
		},
	};
}

const request = (approvalRef?: string) => ({
	contract: "execution",
	contractVersion: "1.0.0",
	executionRef: "execution:approval-case",
	callerRef: "worker:controller",
	taskId: "task:approval-case",
	roleRef: "role:controller",
	workerRef: "worker:controller",
	idempotencyKey: "approval-case",
	capability: "file.write",
	input: { path: "danger.txt", content: "x" },
	...(approvalRef ? { approvalRef } : {}),
});

test("PRESMOKE-B4-APPROVAL-01 durable approval lifecycle binds execution/scope/fingerprint and consumes at effect boundary", async () => {
	const { runtime } = await fixture();
	const pendingExecution = await runtime.executeCapability(request());
	assert.equal(pendingExecution.error?.code, "APPROVAL_REQUIRED");
	assert.ok(pendingExecution.approvalRef);
	const approval = runtime.getExecutionApproval(pendingExecution.approvalRef);
	assert.equal(approval.status, "PENDING");
	assert.equal(approval.requestedByActorRef, "execution-runtime:policy");
	assert.equal(approval.callerRef, "worker:controller");
	assert.equal(approval.taskId, "task:approval-case");
	assert.equal(approval.capability, "file.write");
	assert.match(approval.effectFingerprint, /^sha256:/);
	assert.match(approval.scopeFingerprint, /^sha256:/);
	const allowed = runtime.decideExecutionApproval({
		contract: "execution.approval",
		contractVersion: "1.0.0",
		approvalRef: approval.approvalRef,
		actorRef: "human:owner",
		expectedVersion: 1,
		decision: "ALLOW",
	});
	assert.equal(allowed.status, "APPROVED");
	const completed = await runtime.executeCapability(
		request(approval.approvalRef),
	);
	assert.equal(completed.status, "SUCCEEDED");
	assert.equal(
		runtime.getExecutionApproval(approval.approvalRef).status,
		"CONSUMED",
	);
	runtime.close();
});

test("PRESMOKE-B4-APPROVAL-02 deny/revoke/version/expiry are authoritative and stale approval cannot execute", async () => {
	const { runtime, setNow } = await fixture();
	await runtime.executeCapability(request());
	const denied = runtime.requestExecutionApproval({
		contract: "execution.approval",
		contractVersion: "1.0.0",
		executionRef: "execution:approval-case",
		actorRef: "human:owner",
		expiresAt: "2026-08-16T01:00:00.000Z",
	});
	assert.equal(
		runtime.decideExecutionApproval({
			contract: "execution.approval",
			contractVersion: "1.0.0",
			approvalRef: denied.approvalRef,
			actorRef: "human:owner",
			expectedVersion: 1,
			decision: "DENY",
			reason: "not allowed",
		}).status,
		"DENIED",
	);
	const deniedRun = await runtime.executeCapability(
		request(denied.approvalRef),
	);
	assert.equal(deniedRun.error?.code, "APPROVAL_INVALID");

	const expiring = runtime.requestExecutionApproval({
		contract: "execution.approval",
		contractVersion: "1.0.0",
		executionRef: "execution:approval-case",
		actorRef: "human:owner",
		expiresAt: "2026-08-16T00:10:00.000Z",
	});
	runtime.decideExecutionApproval({
		contract: "execution.approval",
		contractVersion: "1.0.0",
		approvalRef: expiring.approvalRef,
		actorRef: "human:owner",
		expectedVersion: 1,
		decision: "ALLOW",
	});
	setNow("2026-08-16T00:11:00.000Z");
	assert.equal(
		runtime.getExecutionApproval(expiring.approvalRef).status,
		"EXPIRED",
	);

	const revocable = runtime.requestExecutionApproval({
		contract: "execution.approval",
		contractVersion: "1.0.0",
		executionRef: "execution:approval-case",
		actorRef: "human:owner",
		expiresAt: "2026-08-16T02:00:00.000Z",
	});
	const approved = runtime.decideExecutionApproval({
		contract: "execution.approval",
		contractVersion: "1.0.0",
		approvalRef: revocable.approvalRef,
		actorRef: "human:owner",
		expectedVersion: 1,
		decision: "ALLOW",
	});
	assert.throws(() =>
		runtime.revokeExecutionApproval({
			contract: "execution.approval",
			contractVersion: "1.0.0",
			approvalRef: revocable.approvalRef,
			actorRef: "human:owner",
			expectedVersion: 1,
			reason: "stale",
		}),
	);
	assert.equal(
		runtime.revokeExecutionApproval({
			contract: "execution.approval",
			contractVersion: "1.0.0",
			approvalRef: revocable.approvalRef,
			actorRef: "human:owner",
			expectedVersion: approved.version,
			reason: "withdrawn",
		}).status,
		"REVOKED",
	);
	runtime.close();
});

test("PRESMOKE-B4-APPROVAL-03 repeated approval-required decision reuses one durable PENDING draft", async () => {
	const { runtime } = await fixture();
	const first = await runtime.executeCapability(request());
	const second = await runtime.executeCapability(request());
	assert.equal(first.error?.code, "APPROVAL_REQUIRED");
	assert.equal(second.error?.code, "APPROVAL_REQUIRED");
	assert.equal(second.approvalRef, first.approvalRef);
	assert.equal(
		runtime.listExecutionApprovals({
			executionRef: "execution:approval-case",
			status: "PENDING",
		}).length,
		1,
	);
	runtime.close();
});

test("PRESMOKE-B4-APPROVAL-04 aborted effect boundary cannot consume approval first", async () => {
	const source = await readFile(
		new URL("../src/index.ts", import.meta.url),
		"utf8",
	);
	const start = source.indexOf("async onEffectStarted(value)");
	const end = source.indexOf("precondition = value;", start);
	assert.ok(start >= 0 && end > start);
	const boundary = source.slice(start, end);
	assert.ok(boundary.indexOf("controller.signal.aborted") >= 0);
	assert.ok(
		boundary.indexOf("controller.signal.aborted") <
			boundary.indexOf("approvalOwner.consume"),
	);
});

test("CP-EXE-RT-16/RF-EXE-RT-16 patch approval fingerprint binds durable Artifact hash/base metadata", async () => {
	const source = await readFile(
		new URL("../src/approval-owner.ts", import.meta.url),
		"utf8",
	);
	assert.match(source, /patchArtifactBinding/);
	assert.match(source, /hash: artifact\.hash/);
	assert.match(source, /baseHash: artifact\.metadata\?\.baseHash/);
	assert.match(source, /patchArtifact: patchArtifactBinding\(request\)/);
});

test("PRESMOKE-B6-APPROVAL-01 automatic approval binds the concrete effect precondition and rejects stale reality", async () => {
	const exec = promisify(execFile);
	const root = await mkdtemp(join(tmpdir(), "proflow-approval-precondition-"));
	await writeFile(join(root, "package.json"), "{}");
	await exec("git", ["init", "-q"], { cwd: root });
	const local = await createLocalExecutorPort({
		projectRoot: root,
		artifactRoot: join(root, ".artifacts"),
	});
	const runtime = await createExecutionRuntime({
		databasePath: join(root, ".proflow", "execution.db"),
		localExecutor: local,
		policy: {
			decide: () => ({
				decision: "REVIEW",
				decisionPath: "reason",
				approvalRequired: true,
			}),
		},
		modelDecision: {
			decide: async () => ({
				decision: "ALLOW",
				decisionPath: "reason",
				approvalRequired: true,
			}),
		},
	});
	const write = (approvalRef?: string, content = "B") => ({
		contract: "execution",
		contractVersion: "1.0.0",
		callerRef: "worker:controller",
		taskId: "task:precondition",
		roleRef: "role:controller",
		workerRef: "worker:controller",
		idempotencyKey: `precondition-${content}`,
		capability: "file.write",
		input: { path: "danger.txt", content },
		...(approvalRef ? { approvalRef } : {}),
	});

	await writeFile(join(root, "danger.txt"), "A");
	const pending = await runtime.executeCapability(write());
	assert.equal(pending.error?.code, "APPROVAL_REQUIRED");
	assert.ok(pending.approvalRef);
	const draft = runtime.getExecutionApproval(pending.approvalRef);
	assert.match(draft.preconditionFingerprint ?? "", /^sha256:/);
	assert.notEqual(draft.preconditionFingerprint, undefined);

	await writeFile(join(root, "danger.txt"), "C");
	runtime.decideExecutionApproval({
		contract: "execution.approval",
		contractVersion: "1.0.0",
		approvalRef: pending.approvalRef,
		actorRef: "human:owner",
		expectedVersion: draft.version,
		decision: "ALLOW",
	});
	const stale = await runtime.executeCapability(write(pending.approvalRef));
	assert.equal(stale.error?.code, "APPROVAL_INVALID");
	runtime.close();

	const root2 = await mkdtemp(join(tmpdir(), "proflow-approval-precondition-"));
	await writeFile(join(root2, "package.json"), "{}");
	await exec("git", ["init", "-q"], { cwd: root2 });
	const local2 = await createLocalExecutorPort({
		projectRoot: root2,
		artifactRoot: join(root2, ".artifacts"),
	});
	const runtime2 = await createExecutionRuntime({
		databasePath: join(root2, ".proflow", "execution.db"),
		localExecutor: local2,
		policy: {
			decide: () => ({
				decision: "REVIEW",
				decisionPath: "reason",
				approvalRequired: true,
			}),
		},
		modelDecision: {
			decide: async () => ({
				decision: "ALLOW",
				decisionPath: "reason",
				approvalRequired: true,
			}),
		},
	});
	const write2 = (approvalRef?: string) => ({
		contract: "execution",
		contractVersion: "1.0.0",
		callerRef: "worker:controller",
		taskId: "task:precondition",
		roleRef: "role:controller",
		workerRef: "worker:controller",
		idempotencyKey: "precondition-unchanged",
		capability: "file.write",
		input: { path: "danger.txt", content: "B" },
		...(approvalRef ? { approvalRef } : {}),
	});
	await writeFile(join(root2, "danger.txt"), "A");
	const pending2 = await runtime2.executeCapability(write2());
	assert.equal(pending2.error?.code, "APPROVAL_REQUIRED");
	assert.ok(pending2.approvalRef);
	const draft2 = runtime2.getExecutionApproval(pending2.approvalRef);
	runtime2.decideExecutionApproval({
		contract: "execution.approval",
		contractVersion: "1.0.0",
		approvalRef: pending2.approvalRef,
		actorRef: "human:owner",
		expectedVersion: draft2.version,
		decision: "ALLOW",
	});
	const completed = await runtime2.executeCapability(
		write2(pending2.approvalRef),
	);
	assert.equal(completed.status, "SUCCEEDED");
	assert.equal(
		runtime2.getExecutionApproval(pending2.approvalRef).status,
		"CONSUMED",
	);
	runtime2.close();
});
