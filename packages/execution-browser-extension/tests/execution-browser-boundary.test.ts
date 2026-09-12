import assert from "node:assert/strict";
import { test } from "node:test";
import { createBrowserSessionState } from "../src/browser-session-state.ts";
import { createWorkerCarrierTarget } from "../src/worker-carrier-target.ts";
import { parseChatGptCarrierIdentity } from "../src/carrier-identity.ts";
import type { BrowserPageObservation } from "../src/browser-reality.ts";

function fixture() {
	const observation: BrowserPageObservation = {
		tabId: 1, windowId: 1, contentInstanceId: "content:1",
		url: "https://chatgpt.com/g/g-dev/c/c-dev", pageState: "IDLE",
		activityKind: null, observedAt: "2026-09-12T00:00:00.000Z",
	};
	const parseCarrierIdentity = (url: string) => {
		const identity = parseChatGptCarrierIdentity(url);
		if (!identity) throw new Error("INVALID_IDENTITY");
		return identity;
	};
	const browser = {
		listTabs: async () => [observation],
		observe: async () => observation,
		screenshot: async () => ({ evidenceRef: "shot:1", dataUrl: "", mimeType: "image/png", sizeBytes: 0, hash: "hash:1" }),
	};
	const sessions = createBrowserSessionState({
		browser, extensionInstanceId: "extension:1", now: () => new Date(observation.observedAt), parseCarrierIdentity,
	});
	return { observation, sessions, browser, parseCarrierIdentity };
}

test("session observations and snapshots cannot mutate the owning lane", () => {
	const { observation, sessions } = fixture();
	sessions.registerContentSession(observation);
	observation.contentInstanceId = "foreign";
	assert.equal(sessions.isContentSessionCurrent(1, "content:1"), true);
	const snapshot = sessions.getSidePanelSnapshot();
	snapshot.sessions[0]!.contentInstanceId = "foreign";
	snapshot.lanes[0]!.pageState = "BUSY";
	assert.equal(sessions.isContentSessionCurrent(1, "content:1"), true);
	assert.equal(sessions.getSidePanelSnapshot().lanes[0]?.pageState, "IDLE");
});

test("reconciliation tab discovery does not erase a permission continuation", async () => {
	const { observation, sessions } = fixture();
	sessions.registerContentSession(observation);
	await sessions.handlePermissionFallback(1, "continuation:1");
	assert.equal((await sessions.matchingTab("g-dev", "c-dev"))?.tabId, 1);
	const lane = sessions.getSidePanelSnapshot().lanes[0];
	assert.equal(lane?.continuationRef, "continuation:1");
	assert.equal(lane?.activityKind, "WAITING_HUMAN");
});

test("Worker target restoration rejects mismatched binding before opening a page", async () => {
	const { browser, sessions, parseCarrierIdentity } = fixture();
	let opens = 0;
	const restore = createWorkerCarrierTarget({
		browser: { ...browser, async open() { opens += 1; throw new Error("UNEXPECTED_OPEN"); } },
		task: { async getWorkerBinding() { return { workerRef: "c-other", conversationLocator: "https://chatgpt.com/g/g-dev/c/c-other" }; } },
		matchingTab: sessions.matchingTab, registerContentSession: sessions.registerContentSession, parseCarrierIdentity,
	});
	await assert.rejects(restore("task:1", "g-dev", "c-dev"), /WORKER_BINDING_MISMATCH/);
	assert.equal(opens, 0);
});
