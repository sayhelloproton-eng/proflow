import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRoutineCarrierPermission } from "../src/carrier-permission-lifecycle.ts";

const facts = {
	kind: "ACTION_PERMISSION" as const,
	targetHost: "gateway.example.test",
	operationId: "getTask",
	taskId: "task-1",
	actions: ["allowAlways", "allowOnce", "deny"] as const,
	fingerprint: "permission:v1:race",
};

test("CP-EXE-BR-28 same permission reclassifies from DEFER to AUTO_ALLOW exactly once", async () => {
	let classifications = 0;
	let waits = 0;
	const actions: string[] = [];
	const result = await resolveRoutineCarrierPermission({
		facts: { ...facts, actions: [...facts.actions] },
		autoAlreadyAttempted: false,
		maxClassifications: 3,
		port: {
			async classify() {
				classifications += 1;
				return classifications === 1
					? { decision: "DEFER" as const, reason: "TASK_BINDING_PENDING" }
					: { decision: "AUTO_ALLOW" as const, reason: "KNOWN_PROFLOW_ACTION" };
			},
			revalidate: () => true,
			async waitBeforeReclassify() {
				waits += 1;
			},
			async act(action) {
				actions.push(action);
			},
			async released() {
				return true;
			},
		},
	});
	assert.deepEqual(result, { status: "RELEASED", action: "allowAlways" });
	assert.equal(classifications, 2);
	assert.equal(waits, 1);
	assert.deepEqual(actions, ["allowAlways"]);
});

test("CP-EXE-BR-28 bounded DEFER becomes human-required without clicking", async () => {
	let clicks = 0;
	const result = await resolveRoutineCarrierPermission({
		facts: { ...facts, actions: [...facts.actions] },
		autoAlreadyAttempted: false,
		maxClassifications: 2,
		port: {
			async classify() {
				return { decision: "DEFER" as const, reason: "TASK_BINDING_PENDING" };
			},
			revalidate: () => true,
			async waitBeforeReclassify() {},
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
		reason: "PERMISSION_CONTEXT_DEFER_TIMEOUT",
	});
	assert.equal(clicks, 0);
});

test("CP-EXE-BR-28 conflicting binding during DEFER fails closed", async () => {
	let classifications = 0;
	let clicks = 0;
	const result = await resolveRoutineCarrierPermission({
		facts: { ...facts, actions: [...facts.actions] },
		autoAlreadyAttempted: false,
		maxClassifications: 3,
		port: {
			async classify() {
				classifications += 1;
				return classifications === 1
					? { decision: "DEFER" as const, reason: "TASK_BINDING_PENDING" }
					: { decision: "HUMAN_REQUIRED" as const, reason: "CONTEXT_MISMATCH" };
			},
			revalidate: () => true,
			async waitBeforeReclassify() {},
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
		reason: "CONTEXT_MISMATCH",
	});
	assert.equal(classifications, 2);
	assert.equal(clicks, 0);
});
