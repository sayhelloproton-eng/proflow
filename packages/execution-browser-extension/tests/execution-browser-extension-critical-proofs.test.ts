import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { ExecuteCapabilityRequest } from "@tomflow/proflow-execution-contracts";
import { createExecutionRuntime } from "@tomflow/proflow-execution-runtime";
import {
	type BrowserPageObservation,
	type BrowserRealityPort,
	createExecutionBrowserExtension,
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
		return { evidenceRef: `screenshot:${tabId}` };
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

async function fixture() {
	const browser = new BrowserHarness();
	const bindings = new Map<string, string>();
	const deliveryReports: string[] = [];
	let sequence = 0;
	const extension = createExecutionBrowserExtension({
		browser,
		task: {
			async getWorkerBinding(taskId: string, roleRef: string) {
				return bindings.get(`${taskId}:${roleRef}`) ?? null;
			},
			async bindWorker(input: {
				taskId: string;
				roleRef: string;
				workerRef: string;
			}) {
				bindings.set(`${input.taskId}:${input.roleRef}`, input.workerRef);
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

test("CP-EXE-BR-01 stable role/worker identity rejects stale transient content instances", async () => {
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

test("CP-EXE-BR-02 CREATE captures real URL c-id, existing worker RESTORE wins, duplicate CREATE is zero", async () => {
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
	assert.equal(bindings.get("task:1:g-dev"), "c-created");
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

test("CP-EXE-BR-03 WAKE sends only bounded identity trigger and never claims Node or Effect completion", async () => {
	const { extension, browser, bindings } = await fixture();
	bindings.set("task:1:g-dev", "c-dev");
	const result = await extension.execute({
		request: request("worker.wake", {
			roleRef: "g-dev",
			workerRef: "c-dev",
			trigger: "NODE_READY task:1 node:2 run:1",
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
	assert.doesNotMatch(
		JSON.stringify(result),
		/taskDocuments|nodeCompleted|effectSucceeded/,
	);
});

test("CP-EXE-BR-04 page state, Progress Gap and Runtime Stall have deterministic observations", async () => {
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

test("CP-EXE-BR-05 permission fallback captures evidence and Side Panel remains read-only", async () => {
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

test("CP-EXE-BR-06 writes are globally serial and logical delivery follows physical verification", async () => {
	const { extension, browser, bindings, deliveryReports } = await fixture();
	bindings.set("task:1:g-dev", "c-dev");
	await Promise.all([
		extension.execute({
			request: request("worker.wake", {
				roleRef: "g-dev",
				workerRef: "c-dev",
				trigger: "one",
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
		browser.submittedTexts.find((text) => text.includes("PEER_MESSAGE")) ?? "",
		/owner-backed reply content/,
	);
});

test("CP-EXE-BR-06 logical delivery finalizes only after durable Execution success", async () => {
	const directory = await mkdtemp(join(tmpdir(), "proflow-delivery-order-"));
	const { extension, browser, bindings, deliveryReports } = await fixture();
	bindings.set("task:1:g-dev", "c-dev");
	await browser.open("https://chatgpt.com/g/g-dev/c/c-dev");
	const runtime = await createExecutionRuntime({
		databasePath: join(directory, "execution.sqlite"),
		localExecutor: {
			async execute() {
				throw new Error("LOCAL_EXECUTOR_NOT_EXPECTED");
			},
			async reconcile() {
				return { state: "UNKNOWN" as const, evidence: [] };
			},
			async readArtifact() {
				throw new Error("ARTIFACT_NOT_EXPECTED");
			},
		},
		browserExecutor: extension,
		policy: {
			decide() {
				return {
					decision: "ALLOW" as const,
					decisionPath: "deterministic" as const,
				};
			},
		},
	});
	try {
		const record = await runtime.executeCapability(
			request("collaboration.deliver", {
				roleRef: "g-dev",
				workerRef: "c-dev",
				messageRef: "message:committed",
				contentFingerprint: "message:committed-fingerprint",
			}),
		);
		assert.equal(record.status, "SUCCEEDED");
		assert.equal(record.sideEffectState, "APPLIED");
		assert.deepEqual(deliveryReports, []);
		await extension.finalizeCollaborationDelivery(record);
		assert.deepEqual(deliveryReports, ["message:committed"]);
		const { result: _result, ...withoutResult } = record;
		await assert.rejects(
			() =>
				extension.finalizeCollaborationDelivery({
					...withoutResult,
					status: "FAILED",
					sideEffectState: "NOT_APPLIED",
					error: {
						code: "EXECUTION_FAILED",
						message: "controlled failure",
						retryable: false,
					},
				}),
			/COLLABORATION_EXECUTION_NOT_COMMITTED/,
		);
	} finally {
		runtime.close();
		await rm(directory, { recursive: true, force: true });
	}
});

test("CP-EXE-BR-07 bounded Recovery Scan verifies EFFECT_STARTED reality without blind replay", async () => {
	const { extension, browser, bindings } = await fixture();
	bindings.set("task:1:g-dev", "c-dev");
	const tab = await browser.open("https://chatgpt.com/g/g-dev/c/c-dev");
	browser.messages.get(tab.tabId)?.add("wake:already");
	const unfinished = request("worker.wake", {
		roleRef: "g-dev",
		workerRef: "c-dev",
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

test("CP-EXE-BR-08 real Chrome and ChatGPT E3/E4 remains ACTION_REQUIRED locally", async () => {
	const { behaviorAdapter } = await import("../deployment/adapter.ts");
	assert.equal(behaviorAdapter.status().result.status, "ACTION_REQUIRED");
});
