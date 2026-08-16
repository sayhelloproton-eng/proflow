import assert from "node:assert/strict";
import { test } from "node:test";

import type { ExecuteCapabilityRequest } from "@tomflow/proflow-execution-contracts";
import {
	type BrowserPageObservation,
	type BrowserRealityPort,
	type BrowserVisionPort,
	createExecutionBrowserExtension,
	isVisionObservationVerified,
	parseCapturedScreenshot,
} from "../src/index.ts";

class BrowserHarness implements BrowserRealityPort {
	tabs = new Map<number, BrowserPageObservation>();
	messages = new Map<number, Set<string>>();
	submitCount = 0;
	activeWrites = 0;
	maxActiveWrites = 0;
	nextTab = 1;
	submittedTexts: string[] = [];
	async listTabs() {
		return [...this.tabs.values()];
	}
	async open(url: string) {
		const tabId = this.nextTab++;
		const observation = {
			tabId,
			windowId: 1,
			url,
			contentInstanceId: `content:${tabId}`,
			pageState: "IDLE" as const,
			activityKind: null,
			observedAt: new Date().toISOString(),
		};
		this.tabs.set(tabId, observation);
		this.messages.set(tabId, new Set());
		return observation;
	}
	async observe(tabId: number) {
		const tab = this.tabs.get(tabId);
		if (!tab) throw new Error("TAB_NOT_FOUND");
		return tab;
	}
	async submit(tabId: number, text: string, fingerprint: string) {
		this.activeWrites += 1;
		this.maxActiveWrites = Math.max(this.maxActiveWrites, this.activeWrites);
		await new Promise((resolve) => setTimeout(resolve, 5));
		this.submitCount += 1;
		this.submittedTexts.push(text);
		this.messages.get(tabId)?.add(fingerprint);
		const current = await this.observe(tabId);
		if (!current.url.includes("/c/")) {
			const changed = {
				...current,
				url: `${current.url}/c/c-created`,
				contentInstanceId: `${current.contentInstanceId}:navigated`,
			};
			this.tabs.set(tabId, changed);
		}
		this.activeWrites -= 1;
		return this.observe(tabId);
	}
	async hasMessage(tabId: number, fingerprint: string) {
		return this.messages.get(tabId)?.has(fingerprint) === true;
	}
	async screenshot(tabId: number) {
		await this.observe(tabId);
		return {
			evidenceRef: `screenshot:${tabId}`,
			dataUrl: `data:image/png;base64,${Buffer.from(`screenshot-${tabId}`).toString("base64")}`,
			mimeType: "image/png",
			sizeBytes: 11 + String(tabId).length,
			hash: `sha256:${tabId}`,
		};
	}
}

function request(
	capability: ExecuteCapabilityRequest["capability"],
	input: unknown,
	overrides: Record<string, unknown> = {},
) {
	return {
		contract: "execution",
		contractVersion: "1.0.0",
		idempotencyKey: `key:${capability}:${JSON.stringify(input)}`,
		callerRef: "caller:test",
		taskId: "task:1",
		roleRef: "g-dev",
		workerRef: "c-dev",
		capability,
		input,
		...overrides,
	} as ExecuteCapabilityRequest;
}

async function fixture(vision?: BrowserVisionPort) {
	const browser = new BrowserHarness();
	const bindings = new Map<
		string,
		{ workerRef: string; conversationLocator: string | null }
	>();
	const deliveryReports: string[] = [];
	let sequence = 0;
	const extension = createExecutionBrowserExtension({
		browser,
		...(vision ? { vision } : {}),
		task: {
			async getWorkerBinding(taskId: string, roleRef: string) {
				return bindings.get(`${taskId}:${roleRef}`) ?? null;
			},
			async bindWorker(input: {
				taskId: string;
				roleRef: string;
				workerRef: string;
				conversationLocator: string;
			}) {
				bindings.set(`${input.taskId}:${input.roleRef}`, {
					workerRef: input.workerRef,
					conversationLocator: input.conversationLocator,
				});
			},
		},
		agent: {
			async getPendingMessage(messageRef: string) {
				return {
					messageId: messageRef,
					threadId: "thread:1",
					taskId: "task:1",
					kind: "REPLY" as const,
					fromRoleRef: "g-peer",
					fromWorkerRef: "c-peer",
					targetRoleRef: "g-dev",
					targetWorkerRef: "c-dev",
					replyToMessageId: "message:question",
					content: "owner-backed reply content",
					status: "PENDING" as const,
				};
			},
			async reportPhysicalDelivery(messageRef: string) {
				deliveryReports.push(messageRef);
			},
		},
		idFactory: () => `id:${++sequence}`,
	});
	return { extension, browser, bindings, deliveryReports };
}

test("REG-EXE-BR-01 stable role/worker identity rejects stale transient content instances", async () => {
	const { extension, browser } = await fixture();
	const tab = await browser.open("https://chatgpt.com/g/g-dev/c/c-dev");
	extension.registerContentSession(tab);
	extension.registerContentSession({
		...tab,
		contentInstanceId: "content:new",
	});
	assert.equal(
		extension.isContentSessionCurrent(tab.tabId, tab.contentInstanceId),
		false,
	);
	assert.equal(
		extension.isContentSessionCurrent(tab.tabId, "content:new"),
		true,
	);
	assert.deepEqual(extension.parseCarrierIdentity(tab.url), {
		roleRef: "g-dev",
		workerRef: "c-dev",
	});
	assert.deepEqual(
		extension.parseCarrierIdentity(
			"https://chatgpt.com/g/g-dev/c/0198a45c-12ab-7def-9123-abcdef012345",
		),
		{
			roleRef: "g-dev",
			workerRef: "0198a45c-12ab-7def-9123-abcdef012345",
		},
	);
});

test("REG-EXE-BR-02 CREATE captures real URL c-id, existing worker RESTORE wins, duplicate CREATE is zero", async () => {
	const { extension, browser, bindings } = await fixture();
	const created = await extension.execute({
		request: request("worker.create", {
			roleRef: "g-dev",
			roleUrl: "https://chatgpt.com/g/g-dev",
			bootstrapFingerprint: "bootstrap:1",
		}),
		admission: {
			policy: "ALLOW",
			decisionPath: "deterministic",
			approval: "NOT_REQUIRED",
		},
		onEffectStarted() {},
	});
	assert.equal(created.result.capability, "worker.create");
	assert.equal(bindings.get("task:1:g-dev")?.workerRef, "c-created");
	assert.equal(browser.submitCount, 1);
	const restored = await extension.execute({
		request: request("worker.restore", {
			roleRef: "g-dev",
			workerRef: "c-created",
			conversationUrl: "https://chatgpt.com/g/g-dev/c/c-created",
		}),
		admission: {
			policy: "ALLOW",
			decisionPath: "deterministic",
			approval: "NOT_REQUIRED",
		},
	});
	assert.equal(restored.result.capability, "worker.restore");
	assert.equal(browser.submitCount, 1);
	await assert.rejects(
		() =>
			extension.execute({
				request: request("worker.create", {
					roleRef: "g-dev",
					roleUrl: "https://chatgpt.com/g/g-dev",
					bootstrapFingerprint: "bootstrap:2",
				}),
				admission: {
					policy: "ALLOW",
					decisionPath: "deterministic",
					approval: "NOT_REQUIRED",
				},
			}),
		/WORKER_ALREADY_BOUND/,
	);
});

test("PRESMOKE-B3-BINDING-01 RESTORE uses durable TaskRoleBinding conversationLocator instead of reconstructing a URL", async () => {
	const { extension, browser, bindings } = await fixture();
	const durableLocator =
		"https://chatgpt.com/g/g-dev/c/c-dev?proflowLocator=durable-owner-fact";
	bindings.set("task:1:g-dev", {
		workerRef: "c-dev",
		conversationLocator: durableLocator,
	});
	// Same role/worker identity on a stale locator must not override the
	// Task-owned durable conversationLocator recovery truth.
	await browser.open("https://chatgpt.com/g/g-dev/c/c-dev?staleLocator=1");
	const restored = await extension.execute({
		request: request("worker.restore", {
			roleRef: "g-dev",
			workerRef: "c-dev",
			conversationUrl: durableLocator,
		}),
		admission: {
			policy: "ALLOW",
			decisionPath: "deterministic",
			approval: "NOT_REQUIRED",
		},
	});
	assert.equal(restored.result.capability, "worker.restore");
	assert.equal(browser.tabs.size, 2);
	assert.equal(
		[...browser.tabs.values()].some((tab) => tab.url === durableLocator),
		true,
	);
	await assert.rejects(
		() =>
			extension.execute({
				request: request("worker.restore", {
					roleRef: "g-dev",
					workerRef: "c-dev",
					conversationUrl: "https://chatgpt.com/g/g-dev/c/c-dev",
				}),
				admission: {
					policy: "ALLOW",
					decisionPath: "deterministic",
					approval: "NOT_REQUIRED",
				},
			}),
		/CONVERSATION_LOCATOR_MISMATCH/,
	);
});

test("REG-EXE-BR-03 WAKE sends only bounded identity trigger and never claims Node or Effect completion", async () => {
	const { extension, browser, bindings } = await fixture();
	bindings.set("task:1:g-dev", {
		workerRef: "c-dev",
		conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
	});
	const result = await extension.execute({
		request: request("worker.wake", {
			roleRef: "g-dev",
			workerRef: "c-dev",
			taskId: "task:1",
			nodeId: "node:1",
			runNo: 1,
			trigger: "NODE_READY",
			fingerprint: "wake:1",
		}),
		admission: {
			policy: "ALLOW",
			decisionPath: "deterministic",
			approval: "NOT_REQUIRED",
		},
		onEffectStarted() {},
	});
	assert.deepEqual(result.result, {
		capability: "worker.wake",
		data: {
			roleRef: "g-dev",
			workerRef: "c-dev",
			triggerFingerprint: "wake:1",
			delivered: true,
		},
	});
	assert.equal(browser.submitCount, 1);
	assert.match(browser.submittedTexts[0] ?? "", /"fingerprint":"wake:1"/);
	assert.match(
		browser.submittedTexts[0] ?? "",
		/"protocol":"proflow\.agent\.browser-trigger\.v1"/,
	);
	assert.match(browser.submittedTexts[0] ?? "", /"triggerType":"NODE_READY"/);
	assert.match(browser.submittedTexts[0] ?? "", /"nodeId":"node:1"/);
	assert.match(browser.submittedTexts[0] ?? "", /"runNo":1/);
	assert.match(browser.submittedTexts[0] ?? "", /"taskId":"task:1"/);
	assert.doesNotMatch(
		JSON.stringify(result),
		/taskDocuments|nodeCompleted|effectSucceeded/,
	);
});

test("PRESMOKE-B3-WAKE-01 worker.wake rejects untyped/arbitrary wake reasons before Browser effect", async () => {
	const { extension, browser, bindings } = await fixture();
	bindings.set("task:1:g-dev", {
		workerRef: "c-dev",
		conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
	});
	await assert.rejects(
		() =>
			extension.execute({
				request: request("worker.wake", {
					roleRef: "g-dev",
					workerRef: "c-dev",
					taskId: "task:1",
					nodeId: "node:1",
					runNo: 1,
					trigger: "NODE_READY task:1 node:2 run:1",
					fingerprint: "wake:invalid",
				}),
				admission: {
					policy: "ALLOW",
					decisionPath: "deterministic",
					approval: "NOT_REQUIRED",
				},
				onEffectStarted() {},
			}),
		/WAKE_TRIGGER_TYPE_INVALID/,
	);
	assert.equal(browser.submitCount, 0);
});

test("REG-EXE-BR-04 page state, Progress Gap and Runtime Stall have deterministic observations", async () => {
	const { extension } = await fixture();
	assert.equal(
		extension.classifyProgress({
			pageState: "IDLE",
			nodeInProgress: true,
			millisecondsWithoutProgress: 5_000,
			legitimateWait: false,
		}),
		"PROGRESS_GAP",
	);
	assert.equal(
		extension.classifyProgress({
			pageState: "BUSY",
			nodeInProgress: true,
			millisecondsWithoutProgress: 60_001,
			legitimateWait: false,
		}),
		"RUNTIME_STALL",
	);
	assert.equal(
		extension.classifyProgress({
			pageState: "BUSY",
			nodeInProgress: true,
			millisecondsWithoutProgress: 60_001,
			legitimateWait: true,
		}),
		"EXPECTED_WAIT",
	);
});

test("REG-EXE-BR-05 permission fallback captures evidence and Side Panel remains read-only", async () => {
	const { extension, browser } = await fixture();
	const tab = await browser.open("https://chatgpt.com/g/g-dev/c/c-dev");
	extension.registerContentSession({
		...tab,
		pageState: "BLOCKED",
		activityKind: "ACTION_PERMISSION",
	});
	const fallback = await extension.handlePermissionFallback(
		tab.tabId,
		"continuation:1",
	);
	assert.deepEqual(fallback, {
		status: "WAITING_HUMAN",
		continuationRef: "continuation:1",
		evidenceRef: `screenshot:${tab.tabId}`,
	});
	assert.equal(browser.submitCount, 0);
	const panel = extension.getSidePanelSnapshot();
	assert.equal(Object.isFrozen(panel), true);
	assert.doesNotMatch(
		JSON.stringify(panel),
		/credential|authorization|click|submit/i,
	);
});

test("REG-EXE-BR-06 writes are globally serial and logical delivery follows physical verification", async () => {
	const { extension, browser, bindings, deliveryReports } = await fixture();
	bindings.set("task:1:g-dev", {
		workerRef: "c-dev",
		conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
	});
	await Promise.all([
		extension.execute({
			request: request("worker.wake", {
				roleRef: "g-dev",
				workerRef: "c-dev",
				taskId: "task:1",
				nodeId: "node:1",
				runNo: 1,
				trigger: "NODE_READY",
				fingerprint: "wake:one",
			}),
			admission: {
				policy: "ALLOW",
				decisionPath: "deterministic",
				approval: "NOT_REQUIRED",
			},
			onEffectStarted() {},
		}),
		extension.execute({
			request: request("collaboration.deliver", {
				roleRef: "g-dev",
				workerRef: "c-dev",
				messageRef: "message:1",
				contentFingerprint: "message:fp",
			}),
			admission: {
				policy: "ALLOW",
				decisionPath: "deterministic",
				approval: "NOT_REQUIRED",
			},
			onEffectStarted() {},
		}),
	]);
	assert.equal(browser.maxActiveWrites, 1);
	assert.deepEqual(deliveryReports, []);
	assert.match(
		browser.submittedTexts.find((text) => text.includes("PEER_REPLY_READY")) ??
			"",
		/owner-backed reply content/,
	);
});

test("REG-EXE-BR-07 bounded Recovery Scan verifies EFFECT_STARTED reality without blind replay", async () => {
	const { extension, browser, bindings } = await fixture();
	bindings.set("task:1:g-dev", {
		workerRef: "c-dev",
		conversationLocator: "https://chatgpt.com/g/g-dev/c/c-dev",
	});
	const tab = await browser.open("https://chatgpt.com/g/g-dev/c/c-dev");
	browser.messages.get(tab.tabId)?.add("wake:already");
	const unfinished = request("worker.wake", {
		roleRef: "g-dev",
		workerRef: "c-dev",
		taskId: "task:1",
		nodeId: "node:1",
		runNo: 1,
		trigger: "already",
		fingerprint: "wake:already",
	});
	const first = await extension.recoveryScan([
		{ request: unfinished, effectStarted: true },
	]);
	const second = await extension.recoveryScan([
		{ request: unfinished, effectStarted: true },
	]);
	assert.equal(first.reconciled[0]?.state, "APPLIED");
	assert.equal(second.status, "ALREADY_COMPLETED");
	assert.equal(browser.submitCount, 0);
});

test("REG-EXE-BR-08 real Chrome and ChatGPT E3/E4 remains ACTION_REQUIRED locally", async () => {
	const { behaviorAdapter } = await import("../deployment/adapter.ts");
	assert.equal(behaviorAdapter.status().result.status, "ACTION_REQUIRED");
});

type VisionInspectInput = Parameters<BrowserVisionPort["inspect"]>[0];

function recordingVisionPort(
	calls: VisionInspectInput[],
	options: { fail?: boolean } = {},
): BrowserVisionPort {
	return {
		async inspect(input) {
			calls.push(input);
			if (options.fail) throw new Error("provider vision failure");
			return {
				status: "OBSERVED",
				observationRef: "vision:1",
				pageState: "BLOCKED",
				activityKind: "ACTION_PERMISSION",
				confidence: 0.9,
				recommendedNext: "REQUEST_HUMAN",
				reasonCode: "PERMISSION_PROMPT",
				rationale: "permission prompt visible",
			};
		},
	};
}

test("REG-EXE-BR-09 deterministic DOM observation makes zero Vision calls", async () => {
	const calls: VisionInspectInput[] = [];
	const { extension, browser } = await fixture(recordingVisionPort(calls));
	const tab = await browser.open("https://chatgpt.com/g/g-dev/c/c-dev");
	await extension.execute({
		request: request("browser.observe", { targetRef: `tab:${tab.tabId}` }),
		admission: {
			policy: "ALLOW",
			decisionPath: "deterministic",
			approval: "NOT_REQUIRED",
		},
	});
	extension.classifyProgress({
		pageState: "IDLE",
		nodeInProgress: true,
		millisecondsWithoutProgress: 5_000,
		legitimateWait: false,
	});
	await extension.execute({
		request: request("browser.verify", {
			targetRef: `tab:${tab.tabId}`,
			expectedFingerprint: "absent",
		}),
		admission: {
			policy: "ALLOW",
			decisionPath: "deterministic",
			approval: "NOT_REQUIRED",
		},
	});
	assert.equal(calls.length, 0);
});

test("REG-EXE-BR-10 screenshot → Vision receives the exact captured image and returns a typed observation", async () => {
	const calls: VisionInspectInput[] = [];
	const { extension, browser } = await fixture(recordingVisionPort(calls));
	const tab = await browser.open("https://chatgpt.com/g/g-dev/c/c-dev");
	const observedAt = new Date().toISOString();
	const observation = await extension.inspectScreenshot(tab.tabId, {
		targetRef: `tab:${tab.tabId}`,
		pageState: "BLOCKED",
		activityKind: "ACTION_PERMISSION",
		observedAt,
	});
	assert.equal(observation.status, "OBSERVED");
	if (observation.status !== "OBSERVED") return;
	assert.equal(observation.recommendedNext, "REQUEST_HUMAN");
	assert.equal(calls.length, 1);
	const call = calls[0];
	assert.ok(call);
	const expectedBase64 = Buffer.from(`screenshot-${tab.tabId}`).toString(
		"base64",
	);
	assert.equal(call.image.mimeType, "image/png");
	assert.equal(call.image.hash, `sha256:${tab.tabId}`);
	assert.equal(call.image.sizeBytes, 11 + String(tab.tabId).length);
	assert.equal(call.image.base64, expectedBase64);
	assert.equal(call.image.dataUrl, `data:image/png;base64,${expectedBase64}`);
	assert.equal(call.observationContext.targetRef, `tab:${tab.tabId}`);
	assert.equal(call.observationContext.pageState, "BLOCKED");
	assert.equal(call.observationContext.observedAt, observedAt);

	const result = await extension.execute({
		request: request("browser.screenshot", { targetRef: `tab:${tab.tabId}` }),
		admission: {
			policy: "ALLOW",
			decisionPath: "deterministic",
			approval: "NOT_REQUIRED",
		},
	});
	assert.equal(result.result.capability, "browser.screenshot");
	assert.equal(
		(result.artifacts[0]?.metadata?.vision as { status?: string } | undefined)
			?.status,
		"OBSERVED",
	);
	assert.equal(
		(result.result.data as { visionFallback?: string }).visionFallback,
		"REAL_EXTERNAL_PENDING",
	);
	assert.doesNotMatch(JSON.stringify(result), /dataUrl|base64/);

	// The production browser.observe path must automatically escalate only when
	// deterministic DOM/runtime observation reports ambiguity/recovery.
	browser.tabs.set(tab.tabId, {
		...(await browser.observe(tab.tabId)),
		pageState: "UNKNOWN",
		activityKind: "RECOVERING",
		observedAt: new Date().toISOString(),
	});
	const automaticFallback = await extension.execute({
		request: request("browser.observe", { targetRef: `tab:${tab.tabId}` }),
		admission: {
			policy: "ALLOW",
			decisionPath: "deterministic",
			approval: "NOT_REQUIRED",
		},
	});
	assert.equal(calls.length, 3);
	assert.equal(automaticFallback.result.capability, "browser.observe");
	assert.equal(
		(automaticFallback.result.data as { verified?: boolean }).verified,
		false,
		"REQUEST_HUMAN remains diagnostic evidence and cannot verify the page",
	);
	assert.equal(
		automaticFallback.artifacts[0]?.metadata?.source,
		"browser.observe.vision-fallback",
	);
	assert.equal(
		(automaticFallback.artifacts[0]?.metadata?.vision as { status?: string })
			?.status,
		"OBSERVED",
	);
	assert.doesNotMatch(JSON.stringify(automaticFallback), /dataUrl|base64/);
});

test("REG-EXE-BR-11 missing or failing Vision port yields typed defer, never fabricated success", async () => {
	const { extension, browser } = await fixture();
	const tab = await browser.open("https://chatgpt.com/g/g-dev/c/c-dev");
	const missing = await extension.inspectScreenshot(tab.tabId, {
		targetRef: `tab:${tab.tabId}`,
		pageState: "BLOCKED",
		activityKind: "ACTION_PERMISSION",
		observedAt: new Date().toISOString(),
	});
	assert.equal(missing.status, "DEFERRED");
	if (missing.status !== "DEFERRED") return;
	assert.equal(missing.reasonCode, "VISION_PORT_UNAVAILABLE");
	browser.tabs.set(tab.tabId, {
		...(await browser.observe(tab.tabId)),
		pageState: "UNKNOWN",
		activityKind: "RECOVERING",
	});
	const automaticDeferred = await extension.execute({
		request: request("browser.observe", { targetRef: `tab:${tab.tabId}` }),
		admission: {
			policy: "ALLOW",
			decisionPath: "deterministic",
			approval: "NOT_REQUIRED",
		},
	});
	assert.equal(
		(automaticDeferred.result.data as { verified?: boolean }).verified,
		false,
	);
	assert.equal(
		(automaticDeferred.artifacts[0]?.metadata?.vision as { status?: string })
			?.status,
		"DEFERRED",
	);

	const failing = await fixture(recordingVisionPort([], { fail: true }));
	const failingTab = await failing.browser.open(
		"https://chatgpt.com/g/g-dev/c/c-dev",
	);
	const failed = await failing.extension.inspectScreenshot(failingTab.tabId, {
		targetRef: `tab:${failingTab.tabId}`,
		pageState: "BLOCKED",
		activityKind: "ACTION_PERMISSION",
		observedAt: new Date().toISOString(),
	});
	assert.equal(failed.status, "DEFERRED");
	if (failed.status !== "DEFERRED") return;
	assert.equal(failed.reasonCode, "VISION_INFERENCE_FAILED");
});

test("REG-EXE-BR-12 screenshot boundary rejects unsupported MIME and mismatched dataUrl", () => {
	assert.throws(
		() =>
			parseCapturedScreenshot({
				dataUrl: "data:image/svg+xml;base64,AA==",
				mimeType: "image/svg+xml",
				sizeBytes: 1,
				hash: "sha256:x",
			}),
		/not a supported image type/,
	);
	assert.throws(
		() =>
			parseCapturedScreenshot({
				dataUrl: "data:image/jpeg;base64,AA==",
				mimeType: "image/png",
				sizeBytes: 1,
				hash: "sha256:x",
			}),
		/does not match its mimeType/,
	);
	assert.throws(
		() =>
			parseCapturedScreenshot({
				dataUrl: "data:image/png;base64,AA==",
				mimeType: "image/png",
				sizeBytes: 0,
				hash: "sha256:x",
			}),
		/sizeBytes must be a positive integer/,
	);
});

test("REG-EXE-BR-13 Vision verification requires deterministic confidence and no human escalation", () => {
	assert.equal(
		isVisionObservationVerified({
			status: "OBSERVED",
			observationRef: "vision:reliable",
			pageState: "BLOCKED",
			activityKind: "ACTION_PERMISSION",
			confidence: 0.9,
			recommendedNext: "WAIT",
			reasonCode: "KNOWN_WAIT",
			rationale: "known waiting state",
		}),
		true,
	);
	for (const observation of [
		{
			pageState: "UNKNOWN" as const,
			confidence: 0.9,
			recommendedNext: "WAIT" as const,
		},
		{
			pageState: "BLOCKED" as const,
			confidence: 0.5,
			recommendedNext: "WAIT" as const,
		},
		{
			pageState: "BLOCKED" as const,
			confidence: 0.9,
			recommendedNext: "REQUEST_HUMAN" as const,
		},
	]) {
		assert.equal(
			isVisionObservationVerified({
				status: "OBSERVED",
				observationRef: "vision:bounded",
				pageState: observation.pageState,
				activityKind: "ACTION_PERMISSION",
				confidence: observation.confidence,
				recommendedNext: observation.recommendedNext,
				reasonCode: "BOUNDED",
				rationale: "bounded diagnostic",
			}),
			false,
		);
	}
});
