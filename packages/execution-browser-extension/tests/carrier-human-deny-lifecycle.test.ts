import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { createCarrierAttentionRegistry } from "../src/carrier-attention.ts";
import { createCarrierContinuationControl } from "../src/carrier-continuation-control.ts";
import { resolveRoutineCarrierPermission } from "../src/carrier-permission-lifecycle.ts";

const permission = {
	tabId: 7,
	contentInstanceId: "content:one",
	url: "https://chatgpt.com/g/g-test/c/worker-test",
	permissionFingerprint: "permission:v1:denied",
	taskId: "task-1",
	roleRef: "g-test",
	workerRef: "worker-test",
};
const denial = {
	attentionRef: "carrier-attention:7:denied-occurrence",
	...permission,
};
const facts = {
	kind: "ACTION_PERMISSION" as const,
	targetHost: "gateway.example.test",
	operationId: "getTask",
	taskId: permission.taskId,
	actions: ["allowAlways", "allowOnce", "deny"] as const,
	fingerprint: permission.permissionFingerprint,
};

function trustedPort(counters: {
	classifications: number;
	clicks: number;
	actions: string[];
}) {
	return {
		async classify() {
			counters.classifications += 1;
			return {
				decision: "AUTO_ALLOW" as const,
				reason: "KNOWN_PROFLOW_ACTION",
			};
		},
		revalidate: () => true,
		async act(action: string) {
			counters.clicks += 1;
			counters.actions.push(action);
		},
		async released() {
			return true;
		},
	};
}

test("CP-EXE-BR-33 deny plus same BLOCKED permission survives restart without auto action", async () => {
	const beforeRestart = createCarrierContinuationControl();
	beforeRestart.beginDenied(denial);
	const restored = createCarrierContinuationControl(beforeRestart.snapshot());
	const counters = { classifications: 0, clicks: 0, actions: [] as string[] };
	const result = await resolveRoutineCarrierPermission({
		facts: { ...facts, actions: [...facts.actions] },
		autoAlreadyAttempted: false,
		humanDenied: () => restored.hasMatchingPermissionDenial(permission),
		port: trustedPort(counters),
	});
	assert.deepEqual(result, {
		status: "HUMAN_REQUIRED",
		reason: "HUMAN_DENIED",
	});
	assert.deepEqual(counters, { classifications: 0, clicks: 0, actions: [] });
	assert.equal(restored.snapshot().length, 1);

	const attentions = createCarrierAttentionRegistry(() => "rebuilt-occurrence");
	const rebuilt = attentions.derive({
		...permission,
		targetHost: facts.targetHost,
		operationId: facts.operationId,
		reason: "HUMAN_DENIED",
		actions: ["allowOnce", "deny"],
		observedAt: "2026-09-04T05:00:00.000Z",
	});
	assert.equal(rebuilt.reason, "HUMAN_DENIED");
});

test("CP-EXE-BR-33 a later trusted context cannot override the same denied continuation", async () => {
	const control = createCarrierContinuationControl();
	control.beginDenied(denial);
	const counters = { classifications: 0, clicks: 0, actions: [] as string[] };
	await resolveRoutineCarrierPermission({
		facts: { ...facts, actions: [...facts.actions] },
		autoAlreadyAttempted: false,
		humanDenied: () => control.hasMatchingPermissionDenial(permission),
		port: trustedPort(counters),
	});
	assert.deepEqual(counters, { classifications: 0, clicks: 0, actions: [] });
});

test("CP-EXE-BR-33 denial established during classification still wins before auto action", async () => {
	let denied = false;
	let clicks = 0;
	const result = await resolveRoutineCarrierPermission({
		facts: { ...facts, actions: [...facts.actions] },
		autoAlreadyAttempted: false,
		humanDenied: () => denied,
		port: {
			async classify() {
				denied = true;
				return {
					decision: "AUTO_ALLOW" as const,
					reason: "KNOWN_PROFLOW_ACTION",
				};
			},
			revalidate: () => true,
			async act() {
				clicks += 1;
			},
			async released() {
				return true;
			},
		},
	});
	assert.deepEqual(result, {
		status: "HUMAN_REQUIRED",
		reason: "HUMAN_DENIED",
	});
	assert.equal(clicks, 0);
});

test("CP-EXE-BR-34 active denial is the final physical guard before backend-requested worker.wake", async () => {
	const control = createCarrierContinuationControl();
	control.beginDenied(denial);
	assert.equal(
		control.hasMatchingDispatchDenial({
			taskId: permission.taskId,
			roleRef: permission.roleRef,
			workerRef: permission.workerRef,
			conversationLocator: permission.url,
		}),
		true,
	);
	assert.equal(
		control.hasMatchingDispatchDenial({
			taskId: permission.taskId,
			roleRef: "g-other",
			workerRef: "worker-other",
			conversationLocator: "https://chatgpt.com/g/g-other/c/worker-other",
		}),
		false,
	);
	const [background, executor] = await Promise.all([
		readFile(new URL("../extension/background.ts", import.meta.url), "utf8"),
		readFile(new URL("../src/index.ts", import.meta.url), "utf8"),
	]);
	assert.match(background, /command\.type === "WAKE_GUARD"/);
	assert.match(
		background,
		/carrierContinuationControl\.hasMatchingDispatchDenial/,
	);
	assert.match(
		executor,
		/request\.capability === "worker\.wake"[\s\S]{0,1800}options\.browser\.guardWake[\s\S]{0,800}effectStarted\(raw\)[\s\S]{0,1200}options\.browser\.submit/,
	);
	assert.match(executor, /CARRIER_CONTINUATION_HUMAN_DENIED/);
});

test("CP-EXE-BR-35 consumed denial does not blacklist a future permission occurrence", async () => {
	const control = createCarrierContinuationControl();
	control.beginDenied(denial);
	const occurrenceIds = ["denied-occurrence", "future-occurrence"];
	const attentions = createCarrierAttentionRegistry(
		() => occurrenceIds.shift() ?? "missing",
	);
	const deniedAttention = attentions.derive({
		...permission,
		targetHost: facts.targetHost,
		operationId: facts.operationId,
		reason: "HUMAN_DENIED",
		actions: ["allowOnce", "deny"],
		observedAt: "2026-09-04T05:00:00.000Z",
	});
	assert.equal(
		control.suppressRecovery(
			{
				tabId: permission.tabId,
				url: permission.url,
				contentInstanceId: permission.contentInstanceId,
				pageState: "BLOCKED",
				blockerFacts: { fingerprint: permission.permissionFingerprint },
			},
			{
				tabId: permission.tabId,
				url: permission.url,
				contentInstanceId: permission.contentInstanceId,
				pageState: "IDLE",
			},
		),
		true,
	);
	assert.equal(attentions.delete(deniedAttention.attentionRef), true);
	const futureAttention = attentions.derive({
		...permission,
		targetHost: facts.targetHost,
		operationId: facts.operationId,
		reason: "CONTEXT_MISMATCH",
		actions: ["allowOnce", "deny"],
		observedAt: "2026-09-04T05:01:00.000Z",
	});
	assert.notEqual(futureAttention.attentionRef, deniedAttention.attentionRef);
	const counters = { classifications: 0, clicks: 0, actions: [] as string[] };
	const result = await resolveRoutineCarrierPermission({
		facts: {
			...facts,
			actions: [...facts.actions],
		},
		autoAlreadyAttempted: false,
		humanDenied: () => control.hasMatchingPermissionDenial(permission),
		port: trustedPort(counters),
	});
	assert.deepEqual(result, { status: "RELEASED", action: "allowAlways" });
	assert.deepEqual(counters, {
		classifications: 1,
		clicks: 1,
		actions: ["allowAlways"],
	});
});
