import assert from "node:assert/strict";
import { test } from "node:test";

import {
	resolveHumanCarrierPermission,
	resolveRoutineCarrierPermission,
} from "../src/carrier-permission-lifecycle.ts";

const facts = {
	kind: "ACTION_PERMISSION" as const,
	targetHost: "gateway.example.test",
	operationId: "getTask",
	taskId: "task-1",
	actions: ["allowAlways", "allowOnce", "deny"] as const,
	fingerprint: "permission:v1:test",
};

test("CP-EXE-BR-24 trusted routine permission auto-allows exactly once and verifies release", async () => {
	const actions: string[] = [];
	const result = await resolveRoutineCarrierPermission({
		facts: { ...facts, actions: [...facts.actions] },
		autoAlreadyAttempted: false,
		port: {
			async classify() {
				return { decision: "AUTO_ALLOW", reason: "KNOWN_PROFLOW_ACTION" };
			},
			revalidate: () => true,
			async act(action) {
				actions.push(action);
			},
			async released() {
				return true;
			},
		},
	});
	assert.deepEqual(result, { status: "RELEASED", action: "allowAlways" });
	assert.deepEqual(actions, ["allowAlways"]);
});

test("CP-EXE-BR-23 human-required or stale routine permission never clicks", async () => {
	let clicks = 0;
	const human = await resolveRoutineCarrierPermission({
		facts: { ...facts, actions: [...facts.actions] },
		autoAlreadyAttempted: false,
		port: {
			async classify() {
				return { decision: "HUMAN_REQUIRED", reason: "GATEWAY_MISMATCH" };
			},
			revalidate: () => true,
			async act() {
				clicks += 1;
			},
			async released() {
				return false;
			},
		},
	});
	assert.deepEqual(human, {
		status: "HUMAN_REQUIRED",
		reason: "GATEWAY_MISMATCH",
	});
	assert.equal(clicks, 0);

	const stale = await resolveRoutineCarrierPermission({
		facts: { ...facts, actions: [...facts.actions] },
		autoAlreadyAttempted: false,
		port: {
			async classify() {
				return { decision: "AUTO_ALLOW", reason: "KNOWN_PROFLOW_ACTION" };
			},
			revalidate: () => false,
			async act() {
				clicks += 1;
			},
			async released() {
				return false;
			},
		},
	});
	assert.deepEqual(stale, { status: "STALE" });
	assert.equal(clicks, 0);
});

test("CP-EXE-BR-24 does not repeat an unconfirmed automatic permission action", async () => {
	let clicks = 0;
	const attempted = await resolveRoutineCarrierPermission({
		facts: { ...facts, actions: [...facts.actions] },
		autoAlreadyAttempted: true,
		port: {
			async classify() {
				return { decision: "AUTO_ALLOW", reason: "KNOWN_PROFLOW_ACTION" };
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
	assert.deepEqual(attempted, {
		status: "HUMAN_REQUIRED",
		reason: "AUTO_ALLOW_REALITY_UNCONFIRMED",
	});
	assert.equal(clicks, 0);

	const unconfirmed = await resolveRoutineCarrierPermission({
		facts: { ...facts, actions: [...facts.actions] },
		autoAlreadyAttempted: false,
		port: {
			async classify() {
				return { decision: "AUTO_ALLOW", reason: "KNOWN_PROFLOW_ACTION" };
			},
			revalidate: () => true,
			async act() {
				clicks += 1;
			},
			async released() {
				return false;
			},
		},
	});
	assert.deepEqual(unconfirmed, {
		status: "HUMAN_REQUIRED",
		reason: "AUTO_ALLOW_REALITY_UNCONFIRMED",
	});
	assert.equal(clicks, 1);
});

test("CP-EXE-BR-24 human anomaly uses one-time semantic action and requires release proof", async () => {
	const actions: string[] = [];
	await resolveHumanCarrierPermission({
		action: "allowOnce",
		revalidate: () => true,
		async act(action) {
			actions.push(action);
		},
		async released() {
			return true;
		},
	});
	assert.deepEqual(actions, ["allowOnce"]);

	await resolveHumanCarrierPermission({
		action: "deny",
		revalidate: () => true,
		async act(action) {
			actions.push(action);
		},
		async released() {
			return true;
		},
	});
	assert.deepEqual(actions, ["allowOnce", "deny"]);

	await assert.rejects(
		resolveHumanCarrierPermission({
			action: "deny",
			revalidate: () => false,
			async act() {
				assert.fail("stale permission must not be clicked");
			},
			async released() {
				return true;
			},
		}),
		/STALE_PERMISSION/,
	);
});
