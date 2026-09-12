import {
	type ExecuteCapabilityRequest,
	type ExecutorPrecondition,
	executeCapabilityRequestSchema,
} from "@tomflow/proflow-execution-contracts";
import type { BrowserPageObservation } from "./browser-reality.ts";
import type {
	ExecutionBrowserContext,
	Reconciliation,
} from "./execution-browser-context.ts";

export function createBrowserReconciliation(context: ExecutionBrowserContext) {
	let recoveryCompleted = false;

	const reconcile = async (
		requestRaw: ExecuteCapabilityRequest,
		preconditionRaw: ExecutorPrecondition,
	): Promise<Reconciliation> => {
		const request = executeCapabilityRequestSchema.parse(requestRaw);
		if (
			preconditionRaw.kind !== "browser" ||
			preconditionRaw.capability !== request.capability
		)
			return { state: "UNKNOWN", evidence: [] };
		const precondition = preconditionRaw;

		const observeTarget = async (): Promise<BrowserPageObservation | null> => {
			if (precondition.roleRef && precondition.workerRef)
				return context.matchingTab(
					precondition.roleRef,
					precondition.workerRef,
				);
			if (precondition.targetRef) {
				const numericTab = Number(precondition.targetRef.replace(/^tab:/, ""));
				if (Number.isInteger(numericTab)) {
					try {
						return await context.options.browser.observe(numericTab);
					} catch {
						return null;
					}
				}
			}
			return null;
		};

		if (request.capability === "worker.create") {
			const roleRef = precondition.roleRef;
			const taskId = precondition.taskId;
			if (!roleRef || !taskId || !precondition.fingerprint)
				return { state: "UNKNOWN", evidence: [] };

			const boundWorker = await context.options.task.getWorkerBinding(
				taskId,
				roleRef,
			);
			if (boundWorker) {
				const observed = await context.matchingTab(
					roleRef,
					boundWorker.workerRef,
				);
				if (!observed) return { state: "UNKNOWN", evidence: [] };
				if (
					!(await context.options.browser.hasMessage(
						observed.tabId,
						precondition.fingerprint,
					))
				)
					return { state: "UNKNOWN", evidence: [] };
				const evidence = context.browserEvidence(observed, true);
				return {
					state: "APPLIED",
					evidence: [evidence],
					result: {
						capability: "worker.create",
						data: {
							roleRef,
							workerRef: boundWorker.workerRef,
							conversationUrl: observed.url,
							verified: true,
						},
					},
				};
			}

			const candidates: BrowserPageObservation[] = [];
			for (const tab of await context.options.browser.listTabs()) {
				try {
					const identity = context.parseCarrierIdentity(tab.url);
					if (
						identity.roleRef === roleRef &&
						identity.workerRef !== null &&
						(await context.options.browser.hasMessage(
							tab.tabId,
							precondition.fingerprint,
						))
					)
						candidates.push(tab);
				} catch {
					/* unrelated tab */
				}
			}
			if (candidates.length !== 1) return { state: "UNKNOWN", evidence: [] };
			const observed = candidates[0];
			if (!observed) return { state: "UNKNOWN", evidence: [] };
			const identity = context.parseCarrierIdentity(observed.url);
			if (!identity.workerRef) return { state: "UNKNOWN", evidence: [] };
			await context.options.task.bindWorker({
				taskId,
				roleRef,
				workerRef: identity.workerRef,
				conversationLocator: observed.url,
			});
			const evidence = context.browserEvidence(observed, true);
			return {
				state: "APPLIED",
				evidence: [evidence],
				result: {
					capability: "worker.create",
					data: {
						roleRef,
						workerRef: identity.workerRef,
						conversationUrl: observed.url,
						verified: true,
					},
				},
			};
		}

		if (request.capability === "worker.wake") {
			if (
				!precondition.roleRef ||
				!precondition.workerRef ||
				!precondition.fingerprint
			)
				return { state: "UNKNOWN", evidence: [] };
			const observed = await context.matchingTab(
				precondition.roleRef,
				precondition.workerRef,
			);
			if (!observed) return { state: "UNKNOWN", evidence: [] };
			const delivered = await context.options.browser.hasMessage(
				observed.tabId,
				precondition.fingerprint,
			);
			const evidence = context.browserEvidence(observed, delivered);
			if (!delivered) return { state: "NOT_APPLIED", evidence: [evidence] };
			return {
				state: "APPLIED",
				evidence: [evidence],
				result: {
					capability: "worker.wake",
					data: {
						roleRef: precondition.roleRef,
						workerRef: precondition.workerRef,
						triggerFingerprint: precondition.fingerprint,
						delivered: true,
					},
				},
			};
		}

		if (request.capability === "collaboration.deliver") {
			if (
				!precondition.roleRef ||
				!precondition.workerRef ||
				!precondition.fingerprint ||
				!precondition.messageRef
			)
				return { state: "UNKNOWN", evidence: [] };
			const observed = await context.matchingTab(
				precondition.roleRef,
				precondition.workerRef,
			);
			if (!observed) return { state: "UNKNOWN", evidence: [] };
			const delivered = await context.options.browser.hasMessage(
				observed.tabId,
				precondition.fingerprint,
			);
			const evidence = context.browserEvidence(observed, delivered);
			if (!delivered) return { state: "NOT_APPLIED", evidence: [evidence] };
			return {
				state: "APPLIED",
				evidence: [evidence],
				result: {
					capability: "collaboration.deliver",
					data: {
						messageRef: precondition.messageRef,
						delivered: true,
						evidenceRef: evidence.evidenceRef,
					},
				},
			};
		}

		if (request.capability === "browser.submit" && precondition.fingerprint) {
			const observed = await observeTarget();
			if (!observed) return { state: "UNKNOWN", evidence: [] };
			const delivered = await context.options.browser.hasMessage(
				observed.tabId,
				precondition.fingerprint,
			);
			const evidence = context.browserEvidence(observed, delivered);
			if (!delivered) return { state: "NOT_APPLIED", evidence: [evidence] };
			return {
				state: "APPLIED",
				evidence: [evidence],
				result: {
					capability: "browser.submit",
					data: {
						targetRef: precondition.targetRef ?? `tab:${observed.tabId}`,
						verified: true,
						observationRef: evidence.observationRef,
					},
				},
			};
		}

		if (request.capability === "browser.navigate" && precondition.expectedUrl) {
			const observed = await observeTarget();
			if (!observed || observed.url !== precondition.expectedUrl)
				return { state: "UNKNOWN", evidence: [] };
			const evidence = context.browserEvidence(observed, true);
			return {
				state: "APPLIED",
				evidence: [evidence],
				result: {
					capability: "browser.navigate",
					data: {
						targetRef: precondition.targetRef ?? `tab:${observed.tabId}`,
						verified: true,
						observationRef: evidence.observationRef,
					},
				},
			};
		}

		return { state: "UNKNOWN", evidence: [] };
	};

	const recoveryScan = async (
		unfinished: Array<{
			request: ExecuteCapabilityRequest;
			effectStarted: boolean;
		}>,
	) => {
		if (recoveryCompleted)
			return { status: "ALREADY_COMPLETED" as const, reconciled: [] };
		recoveryCompleted = true;
		for (const tab of await context.options.browser.listTabs()) {
			try {
				context.registerContentSession(tab);
			} catch {
				/* unrelated tab */
			}
		}
		const reconciled = [];
		for (const item of unfinished)
			reconciled.push(
				item.effectStarted
					? await reconcile(
							item.request,
							context.browserPrecondition(item.request),
						)
					: { state: "NOT_APPLIED" as const, evidence: [] },
			);
		return { status: "COMPLETED" as const, reconciled };
	};

	return Object.freeze({ reconcile, recoveryScan });
}
