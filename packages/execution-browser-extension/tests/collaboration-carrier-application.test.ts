import assert from "node:assert/strict";
import { test } from "node:test";

import type { ExecuteCapabilityRequest } from "@tomflow/proflow-execution-contracts";
import {
	createCollaborationCarrierApplication,
	type PendingCollaborationCarrierMessage,
} from "../src/collaboration-carrier.ts";

const now = "2026-08-15T00:00:00.000Z";

function pendingMessage(
	messageId = "message:1",
): PendingCollaborationCarrierMessage {
	return {
		messageId,
		threadId: "thread:1",
		taskId: "task:1",
		kind: "REPLY" as const,
		fromRoleRef: "g-peer",
		fromWorkerRef: "c-peer",
		targetRoleRef: "g-dev",
		targetWorkerRef: "c-dev",
		replyToMessageId: "message:q",
		content: "peer reply",
		status: "PENDING" as const,
		deliveryAttemptCount: 0,
		lastDeliveryErrorCode: null,
		executionRef: null,
		evidenceRef: null,
	};
}

function deliveredRecord(request: ExecuteCapabilityRequest) {
	return {
		contract: "execution",
		contractVersion: "1.0.0",
		executionRef: "execution:1",
		capability: "collaboration.deliver",
		callerRef: request.callerRef,
		correlationId: request.correlationId,
		taskId: request.taskId,
		roleRef: request.roleRef,
		workerRef: request.workerRef,
		idempotencyKey: request.idempotencyKey,
		inputFingerprint: "sha256:input",
		status: "SUCCEEDED",
		sideEffectState: "APPLIED",
		retryable: false,
		decisionPath: "fast",
		result: {
			capability: "collaboration.deliver",
			data: {
				messageRef: "message:1",
				delivered: true,
				evidenceRef: "evidence:1",
			},
		},
		evidence: [
			{
				kind: "browser",
				evidenceRef: "evidence:1",
				targetRef: "tab:1",
				observationRef: "observation:1",
				verified: true,
			},
		],
		evidenceRefs: ["evidence:1"],
		artifactRefs: [],
		attemptCount: 1,
		createdAt: now,
		startedAt: now,
		effectStartedAt: now,
		finishedAt: now,
		updatedAt: now,
	};
}

function unknownRecord(request: ExecuteCapabilityRequest) {
	return {
		contract: "execution",
		contractVersion: "1.0.0",
		executionRef: "execution:unknown",
		capability: "collaboration.deliver",
		callerRef: request.callerRef,
		correlationId: request.correlationId,
		taskId: request.taskId,
		roleRef: request.roleRef,
		workerRef: request.workerRef,
		idempotencyKey: request.idempotencyKey,
		inputFingerprint: "sha256:input",
		status: "UNKNOWN",
		sideEffectState: "UNKNOWN",
		retryable: false,
		evidence: [],
		evidenceRefs: [],
		artifactRefs: [],
		error: {
			code: "UNKNOWN_SIDE_EFFECT",
			message: "delivery reality is uncertain",
			retryable: false,
		},
		attemptCount: 1,
		createdAt: now,
		finishedAt: now,
		updatedAt: now,
	};
}

test("PRESMOKE-B3-COLLAB-01 pending message drives one stable Execution intent and logical delivery follows durable success", async () => {
	const message = pendingMessage();
	const requests: ExecuteCapabilityRequest[] = [];
	const reports: Array<[string, string, string]> = [];
	const application = createCollaborationCarrierApplication({
		task: {
			async getWorkerBinding() {
				return {
					workerRef: "c-dev",
					conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
				};
			},
		},
		agent: {
			async listPendingMessages() {
				return [message];
			},
			async getPendingMessage() {
				return message;
			},
			async reportDeliveryOutcome(input) {
				if (
					input.outcome === "DELIVERED" &&
					input.evidenceRef &&
					input.executionRef
				)
					reports.push([
						input.messageRef,
						input.evidenceRef,
						input.executionRef,
					]);
			},
		},
		execution: {
			async execute(request) {
				requests.push(request);
				return deliveredRecord(request);
			},
		},
	});

	const outcome = await application.deliverMessage(message.messageId);
	assert.equal(outcome.status, "DELIVERED");
	assert.equal(requests.length, 1);
	const firstRequest = requests[0];
	assert.ok(firstRequest);
	assert.equal(firstRequest.idempotencyKey, "collaboration-deliver:message:1");
	assert.equal(firstRequest.callerRef, "extension:collaboration-carrier");
	assert.equal(firstRequest.capability, "collaboration.deliver");
	if (firstRequest.capability !== "collaboration.deliver")
		throw new Error("COLLABORATION_REQUEST_EXPECTED");
	assert.equal(firstRequest.input.messageRef, "message:1");
	assert.deepEqual(reports, [["message:1", "evidence:1", "execution:1"]]);
});

test("PRESMOKE-B3-COLLAB-02 UNKNOWN is durably reported and startup recovery never resubmits the physical intent", async () => {
	let message = pendingMessage();
	const keys: string[] = [];
	const outcomes: string[] = [];
	const application = createCollaborationCarrierApplication({
		task: {
			async getWorkerBinding() {
				return {
					workerRef: "c-dev",
					conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
				};
			},
		},
		agent: {
			async listPendingMessages() {
				return [message];
			},
			async getPendingMessage() {
				return message;
			},
			async reportDeliveryOutcome(input) {
				outcomes.push(input.outcome);
				if (input.outcome === "UNKNOWN") {
					message = {
						...message,
						deliveryAttemptCount: message.deliveryAttemptCount + 1,
						lastDeliveryErrorCode: "UNKNOWN",
						executionRef: input.executionRef ?? null,
					};
				}
			},
		},
		execution: {
			async execute(request) {
				keys.push(request.idempotencyKey);
				return unknownRecord(request);
			},
		},
	});

	assert.equal(
		(await application.deliverMessage(message.messageId)).status,
		"UNKNOWN",
	);
	assert.deepEqual(outcomes, ["UNKNOWN"]);
	const recovered = await application.recoverPending(10);
	assert.equal(recovered[0]?.status, "UNKNOWN");
	assert.deepEqual(keys, ["collaboration-deliver:message:1"]);
});

test("PRESMOKE-B3-COLLAB-03 target durable binding and conversationLocator gate physical Execution", async () => {
	const message = pendingMessage();
	let executeCount = 0;
	const application = createCollaborationCarrierApplication({
		task: {
			async getWorkerBinding() {
				return { workerRef: "c-dev", conversationLocator: null };
			},
		},
		agent: {
			async listPendingMessages() {
				return [message];
			},
			async getPendingMessage() {
				return message;
			},
			async reportDeliveryOutcome() {},
		},
		execution: {
			async execute() {
				executeCount += 1;
				throw new Error("SHOULD_NOT_EXECUTE");
			},
		},
	});

	assert.deepEqual(await application.deliverMessage(message.messageId), {
		status: "PENDING",
		messageRef: "message:1",
		executionRef: null,
	});
	assert.equal(executeCount, 0);
});

test("PRESMOKE-B3-COLLAB-04 confirmed FAILED delivery is bounded and stops after three durable attempts", async () => {
	const message = {
		...pendingMessage(),
		deliveryAttemptCount: 3,
		lastDeliveryErrorCode: "EXECUTION_FAILED",
		executionRef: "execution:failed-3",
	};
	let executeCount = 0;
	const application = createCollaborationCarrierApplication({
		task: {
			async getWorkerBinding() {
				return {
					workerRef: "c-dev",
					conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
				};
			},
		},
		agent: {
			async listPendingMessages() {
				return [message];
			},
			async getPendingMessage() {
				return message;
			},
			async reportDeliveryOutcome() {},
		},
		execution: {
			async execute() {
				executeCount += 1;
				throw new Error("SHOULD_NOT_EXECUTE_AFTER_BOUND");
			},
		},
	});

	assert.deepEqual(await application.deliverMessage(message.messageId), {
		status: "FAILED",
		messageRef: message.messageId,
		executionRef: "execution:failed-3",
	});
	assert.equal(executeCount, 0);
});
