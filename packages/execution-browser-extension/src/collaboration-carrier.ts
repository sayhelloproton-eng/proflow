import {
	type ExecuteCapabilityRequest,
	parseExecutionRecord,
} from "@tomflow/proflow-execution-contracts";

export type PendingCollaborationCarrierMessage = {
	messageId: string;
	threadId: string;
	taskId: string;
	kind: "QUESTION" | "REPLY";
	fromRoleRef: string;
	fromWorkerRef: string;
	targetRoleRef: string;
	targetWorkerRef: string;
	replyToMessageId: string | null;
	content: string;
	status: "PENDING";
	deliveryAttemptCount: number;
	lastDeliveryErrorCode: string | null;
	executionRef: string | null;
	evidenceRef: string | null;
};

export interface CollaborationCarrierTaskPort {
	getWorkerBinding(
		taskId: string,
		roleRef: string,
	): Promise<{ workerRef: string; conversationLocator: string | null } | null>;
}

export interface CollaborationCarrierAgentPort {
	listPendingMessages(
		limit: number,
	): Promise<PendingCollaborationCarrierMessage[]>;
	getPendingMessage(
		messageRef: string,
	): Promise<PendingCollaborationCarrierMessage>;
	reportDeliveryOutcome(input: {
		messageRef: string;
		outcome: "DELIVERED" | "FAILED" | "UNKNOWN";
		executionRef?: string;
		evidenceRef?: string;
		errorCode?: string;
	}): Promise<void>;
}

export interface CollaborationCarrierExecutionPort {
	execute(request: ExecuteCapabilityRequest): Promise<unknown>;
}

export type CollaborationCarrierOutcome =
	| { status: "DELIVERED"; messageRef: string; executionRef: string }
	| {
			status: "PENDING" | "FAILED" | "UNKNOWN";
			messageRef: string;
			executionRef: string | null;
	  };

async function contentFingerprint(
	message: PendingCollaborationCarrierMessage,
): Promise<string> {
	const payload = new TextEncoder().encode(
		JSON.stringify({
			messageId: message.messageId,
			taskId: message.taskId,
			targetRoleRef: message.targetRoleRef,
			targetWorkerRef: message.targetWorkerRef,
			content: message.content,
		}),
	);
	const digest = await globalThis.crypto.subtle.digest("SHA-256", payload);
	const hex = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	return `sha256:${hex}`;
}

/**
 * Event-driven Collaboration Carrier application.
 *
 * The Agent owner keeps the durable PENDING message. This coordinator owns no
 * queue and runs no timer. A normal ask/reply event may call `deliverMessage`
 * once; process startup may call `recoverPending` once as a bounded recovery
 * scan. Physical delivery remains an Execution effect and logical DELIVERED is
 * written only after the durable Execution record proves APPLIED + delivered.
 */
export function createCollaborationCarrierApplication(options: {
	task: CollaborationCarrierTaskPort;
	agent: CollaborationCarrierAgentPort;
	execution: CollaborationCarrierExecutionPort;
	callerRef?: string;
}) {
	const callerRef = options.callerRef ?? "extension:collaboration-carrier";

	const deliverMessage = async (
		messageRef: string,
	): Promise<CollaborationCarrierOutcome> => {
		const message = await options.agent.getPendingMessage(messageRef);
		// UNKNOWN is a durable hold state. Startup recovery must not turn an
		// uncertain physical side effect into another Browser submission.
		if (message.lastDeliveryErrorCode === "UNKNOWN") {
			return {
				status: "UNKNOWN",
				messageRef,
				executionRef: message.executionRef,
			};
		}
		if (message.deliveryAttemptCount >= 3) {
			return {
				status: "FAILED",
				messageRef,
				executionRef: message.executionRef,
			};
		}
		const binding = await options.task.getWorkerBinding(
			message.taskId,
			message.targetRoleRef,
		);
		if (
			!binding ||
			binding.workerRef !== message.targetWorkerRef ||
			!binding.conversationLocator
		)
			return { status: "PENDING", messageRef, executionRef: null };

		const request: ExecuteCapabilityRequest = {
			contract: "execution",
			contractVersion: "1.0.0",
			idempotencyKey: `collaboration-deliver:${message.messageId}`,
			callerRef,
			correlationId: message.messageId,
			taskId: message.taskId,
			roleRef: message.targetRoleRef,
			workerRef: message.targetWorkerRef,
			capability: "collaboration.deliver",
			input: {
				roleRef: message.targetRoleRef,
				workerRef: message.targetWorkerRef,
				messageRef: message.messageId,
				contentFingerprint: await contentFingerprint(message),
			},
		};
		const execution = parseExecutionRecord(
			await options.execution.execute(request),
		);
		if (
			execution.status === "SUCCEEDED" &&
			execution.sideEffectState === "APPLIED" &&
			execution.result?.capability === "collaboration.deliver" &&
			execution.result.data.delivered === true
		) {
			await options.agent.reportDeliveryOutcome({
				messageRef: message.messageId,
				outcome: "DELIVERED",
				executionRef: execution.executionRef,
				evidenceRef: execution.result.data.evidenceRef,
			});
			return {
				status: "DELIVERED",
				messageRef,
				executionRef: execution.executionRef,
			};
		}
		if (
			execution.status === "UNKNOWN" ||
			execution.sideEffectState === "UNKNOWN"
		) {
			await options.agent.reportDeliveryOutcome({
				messageRef: message.messageId,
				outcome: "UNKNOWN",
				executionRef: execution.executionRef,
				errorCode: "UNKNOWN",
			});
			return {
				status: "UNKNOWN",
				messageRef,
				executionRef: execution.executionRef,
			};
		}
		if (execution.status === "FAILED") {
			await options.agent.reportDeliveryOutcome({
				messageRef: message.messageId,
				outcome: "FAILED",
				executionRef: execution.executionRef,
				errorCode: execution.error?.code ?? "EXECUTION_FAILED",
			});
			return {
				status: "FAILED",
				messageRef,
				executionRef: execution.executionRef,
			};
		}
		return {
			status: "PENDING",
			messageRef,
			executionRef: execution.executionRef,
		};
	};

	const recoverPending = async (limit = 50) => {
		if (!Number.isInteger(limit) || limit <= 0 || limit > 100)
			throw new TypeError("limit must be an integer from 1 through 100");
		const messages = await options.agent.listPendingMessages(limit);
		const outcomes: CollaborationCarrierOutcome[] = [];
		for (const message of messages) {
			try {
				outcomes.push(await deliverMessage(message.messageId));
			} catch {
				// The Agent PENDING fact is authoritative. A failed trigger is left
				// pending for the next explicit event/recovery; never synthesize a
				// second physical intent here.
				outcomes.push({
					status: "PENDING",
					messageRef: message.messageId,
					executionRef: null,
				});
			}
		}
		return outcomes;
	};

	return Object.freeze({ deliverMessage, recoverPending });
}
