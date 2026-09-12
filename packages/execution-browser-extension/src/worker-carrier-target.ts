import type { BrowserRealityPort } from "./browser-reality.ts";
import type { BrowserSessionState } from "./browser-session-state.ts";
import { ExecutionBrowserError, type TaskBrowserPort } from "./execution-browser-context.ts";

export function createWorkerCarrierTarget(ports: {
	task: Pick<TaskBrowserPort, "getWorkerBinding">;
	browser: Pick<BrowserRealityPort, "open" | "observe">;
	matchingTab: BrowserSessionState["matchingTab"];
	registerContentSession: BrowserSessionState["registerContentSession"];
	parseCarrierIdentity(raw: string): { roleRef: string; workerRef: string | null };
}) {
	const ensureRestored = async (
		taskId: string,
		roleRef: string,
		workerRef: string,
		expectedConversationLocator?: string,
	) => {
		if (!taskId)
			throw new ExecutionBrowserError("PRECONDITION_FAILED", "TASK_ID_REQUIRED");
		const bound = await ports.task.getWorkerBinding(taskId, roleRef);
		if (!bound || bound.workerRef !== workerRef)
			throw new ExecutionBrowserError(
				"PRECONDITION_FAILED",
				"WORKER_BINDING_MISMATCH",
			);
		if (!bound.conversationLocator)
			throw new ExecutionBrowserError(
				"PRECONDITION_FAILED",
				"CONVERSATION_LOCATOR_REQUIRED",
			);
		if (
			expectedConversationLocator !== undefined &&
			expectedConversationLocator !== bound.conversationLocator
		)
			throw new ExecutionBrowserError(
				"PRECONDITION_FAILED",
				"CONVERSATION_LOCATOR_MISMATCH",
			);
		const existing = await ports.matchingTab(roleRef, workerRef);
		if (existing?.url === bound.conversationLocator) {
			ports.registerContentSession(existing);
			return existing;
		}
		const opened = await ports.browser.open(bound.conversationLocator);
		const observed = await ports.browser.observe(opened.tabId);
		const identity = ports.parseCarrierIdentity(observed.url);
		if (identity.roleRef !== roleRef || identity.workerRef !== workerRef)
			throw new ExecutionBrowserError(
				"PRECONDITION_FAILED",
				"RESTORE_IDENTITY_MISMATCH",
			);
		if (observed.url !== bound.conversationLocator)
			throw new ExecutionBrowserError(
				"PRECONDITION_FAILED",
				"RESTORE_LOCATOR_MISMATCH",
			);
		ports.registerContentSession(observed);
		return observed;
	};

	return ensureRestored;
}

export type RestoreWorker = ReturnType<typeof createWorkerCarrierTarget>;
