import type { BrowserRealityPort } from "./browser-reality.ts";
import type { BrowserSessionState } from "./browser-session-state.ts";
import type { RestoreWorker } from "./worker-carrier-target.ts";
import type { TaskBrowserPort, AgentDeliveryPort } from "./execution-browser-context.ts";
import type { ExecuteCapabilityRequest } from "@tomflow/proflow-execution-contracts";
import type {
	ExecutionBrowserContext,
	ExecutorInvocation,
	ExecutorResult,
} from "./execution-browser-context.ts";
import { ExecutionBrowserError } from "./execution-browser-context.ts";

const workerWakeTriggerTypes = new Set([
	"NODE_READY",
	"REOPEN",
	"EXECUTION_RESULT_READY",
	"PEER_REPLY_READY",
	"RECOVERY_RESUME",
	"TASK_RESUMED",
]);

const workerCapabilities = new Set([
	"worker.create",
	"worker.restore",
	"worker.wake",
	"collaboration.deliver",
]);

export async function executeWorkerCarrier(
	context: Pick<
		ExecutionBrowserContext,
		"serializeWrite" | "parseCarrierIdentity" | "effectStarted" | "result" | "now" | "browserEvidence"
	> & {
		browser: Pick<BrowserRealityPort, "open" | "observe" | "submit" | "hasMessage" | "guardWake">;
	},
	raw: ExecutorInvocation,
	request: ExecuteCapabilityRequest,
	ports: {
		task: TaskBrowserPort;
		agent: Pick<AgentDeliveryPort, "getPendingMessage">;
		restoreWorker: RestoreWorker;
		registerContentSession: BrowserSessionState["registerContentSession"];
	},
): Promise<ExecutorResult | null> {
	if (!workerCapabilities.has(request.capability)) return null;
	if (!request.taskId)
		throw new ExecutionBrowserError(
			"PRECONDITION_FAILED",
			"TASK_ID_REQUIRED",
		);
	const taskId = request.taskId;
	const options = {
		browser: context.browser,
		task: ports.task,
		agent: ports.agent,
	};

	if (request.capability === "worker.create")
		return context.serializeWrite(async () => {
			if (await options.task.getWorkerBinding(taskId, request.input.roleRef))
				throw new ExecutionBrowserError(
					"PRECONDITION_FAILED",
					"WORKER_ALREADY_BOUND",
				);
			const roleIdentity = context.parseCarrierIdentity(request.input.roleUrl);
			if (
				roleIdentity.roleRef !== request.input.roleRef ||
				roleIdentity.workerRef
			)
				throw new ExecutionBrowserError(
					"PRECONDITION_FAILED",
					"ROLE_URL_MISMATCH",
				);
			const opened = await options.browser.open(request.input.roleUrl);
			const openedIdentity = context.parseCarrierIdentity(opened.url);
			if (
				openedIdentity.roleRef !== request.input.roleRef ||
				openedIdentity.workerRef !== null
			)
				throw new ExecutionBrowserError(
					"PRECONDITION_FAILED",
					"OPENED_ROLE_IDENTITY_MISMATCH",
				);
			const precondition = await context.effectStarted(raw);
			const submitted = await options.browser.submit(
				opened.tabId,
				`WORKER_BIND ${request.input.bootstrapFingerprint}`,
				request.input.bootstrapFingerprint,
			);
			if (
				!(await options.browser.hasMessage(
					submitted.tabId,
					request.input.bootstrapFingerprint,
				))
			)
				throw new ExecutionBrowserError(
					"UNKNOWN_SIDE_EFFECT",
					"CREATE_MESSAGE_REALITY_UNCONFIRMED",
				);
			const observed = await options.browser.observe(opened.tabId);
			const identity = context.parseCarrierIdentity(observed.url);
			if (identity.roleRef !== request.input.roleRef || !identity.workerRef)
				throw new ExecutionBrowserError(
					"UNKNOWN_SIDE_EFFECT",
					"CREATE_REALITY_UNCONFIRMED",
				);
			await options.task.bindWorker({
				taskId,
				roleRef: identity.roleRef,
				workerRef: identity.workerRef,
				conversationLocator: observed.url,
			});
			ports.registerContentSession(observed);
			return context.result(
				{
					capability: "worker.create",
					data: {
						roleRef: identity.roleRef,
						workerRef: identity.workerRef,
						conversationUrl: observed.url,
						verified: true,
					},
				},
				observed,
				true,
				precondition,
			);
		});

	if (request.capability === "worker.restore") {
		const observed = await ports.restoreWorker(
			taskId,
			request.input.roleRef,
			request.input.workerRef,
			request.input.conversationUrl,
		);
		return context.result(
			{
				capability: "worker.restore",
				data: {
					roleRef: request.input.roleRef,
					workerRef: request.input.workerRef,
					restored: true,
				},
			},
			observed,
			false,
		);
	}

	if (request.capability === "worker.wake")
		return context.serializeWrite(async () => {
			if (!workerWakeTriggerTypes.has(request.input.trigger))
				throw new ExecutionBrowserError(
					"PRECONDITION_FAILED",
					"WAKE_TRIGGER_TYPE_INVALID",
				);
			const observed = await ports.restoreWorker(
				taskId,
				request.input.roleRef,
				request.input.workerRef,
			);
			if (!options.browser.guardWake)
				throw new ExecutionBrowserError(
					"EXECUTOR_UNAVAILABLE",
					"WAKE_GUARD_REQUIRED",
				);
			if (
				!(await options.browser.guardWake({
					taskId,
					roleRef: request.input.roleRef,
					workerRef: request.input.workerRef,
					conversationLocator: observed.url,
				}))
			)
				throw new ExecutionBrowserError(
					"PRECONDITION_FAILED",
					"CARRIER_CONTINUATION_HUMAN_DENIED",
				);
			if (observed.pageState === "BUSY" || observed.pageState === "BLOCKED")
				throw new ExecutionBrowserError(
					"PRECONDITION_FAILED",
					"PAGE_NOT_WRITABLE",
				);
			const precondition = await context.effectStarted(raw);
			const trigger = JSON.stringify({
				protocol: "proflow.agent.browser-trigger.v1",
				triggerRef: request.input.fingerprint,
				triggerType: request.input.trigger,
				taskId,
				nodeId: request.input.nodeId,
				runNo: request.input.runNo,
				roleRef: request.input.roleRef,
				workerRef: request.input.workerRef,
				occurredAt: context.now().toISOString(),
				fingerprint: request.input.fingerprint,
				payload: { trigger: request.input.trigger },
			});
			const after = await options.browser.submit(
				observed.tabId,
				trigger,
				request.input.fingerprint,
				{
					taskId,
					roleRef: request.input.roleRef,
					workerRef: request.input.workerRef,
					conversationLocator: observed.url,
				},
			);
			if (
				!(await options.browser.hasMessage(
					after.tabId,
					request.input.fingerprint,
				))
			)
				throw new ExecutionBrowserError(
					"UNKNOWN_SIDE_EFFECT",
					"WAKE_REALITY_UNCONFIRMED",
				);
			ports.registerContentSession(after);
			return context.result(
				{
					capability: "worker.wake",
					data: {
						roleRef: request.input.roleRef,
						workerRef: request.input.workerRef,
						triggerFingerprint: request.input.fingerprint,
						delivered: true,
					},
				},
				after,
				true,
				precondition,
			);
		});

	if (request.capability === "collaboration.deliver")
		return context.serializeWrite(async () => {
			const message = await options.agent.getPendingMessage(
				request.input.messageRef,
			);
			if (
				message.messageId !== request.input.messageRef ||
				message.taskId !== taskId ||
				message.targetRoleRef !== request.input.roleRef ||
				message.targetWorkerRef !== request.input.workerRef ||
				message.status !== "PENDING"
			)
				throw new ExecutionBrowserError(
					"PRECONDITION_FAILED",
					"DELIVERY_OWNER_FACT_MISMATCH",
				);
			const observed = await ports.restoreWorker(
				taskId,
				request.input.roleRef,
				request.input.workerRef,
			);
			const precondition = await context.effectStarted(raw);
			const trigger = JSON.stringify({
				protocol: "proflow.agent.browser-trigger.v1",
				triggerRef: message.messageId,
				triggerType:
					message.kind === "REPLY" ? "PEER_REPLY_READY" : "PEER_MESSAGE",
				taskId,
				roleRef: message.targetRoleRef,
				workerRef: message.targetWorkerRef,
				occurredAt: context.now().toISOString(),
				fingerprint: request.input.contentFingerprint,
				payload: { collaboration: message },
			});
			const after = await options.browser.submit(
				observed.tabId,
				trigger,
				request.input.contentFingerprint,
			);
			if (
				!(await options.browser.hasMessage(
					after.tabId,
					request.input.contentFingerprint,
				))
			)
				throw new ExecutionBrowserError(
					"UNKNOWN_SIDE_EFFECT",
					"DELIVERY_REALITY_UNCONFIRMED",
				);
			const evidence = context.browserEvidence(after, true);
			return {
				...context.result(
					{
						capability: "collaboration.deliver",
						data: {
							messageRef: request.input.messageRef,
							delivered: true,
							evidenceRef: evidence.evidenceRef,
						},
					},
					after,
					true,
					precondition,
				),
				evidence: [evidence],
			};
		});

	return null;
}
