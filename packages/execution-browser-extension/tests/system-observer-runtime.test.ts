import assert from "node:assert/strict";
import { test } from "node:test";

import {
	createSystemObserver,
	SYSTEM_OBSERVER_VIEWS,
	type SystemObserverReasonResult,
} from "../src/system-observer.ts";

function result(
	overrides: Partial<SystemObserverReasonResult> = {},
): SystemObserverReasonResult {
	return {
		health: "HEALTHY",
		findings: [],
		risks: [],
		anomalies: [],
		hypotheses: [],
		unresolved: [],
		needsDrilldown: [],
		evidenceRefs: [],
		confidence: 0.9,
		carryForward: [],
		rationale: "bounded assessment",
		...overrides,
	};
}

test("PRESMOKE-B3-SYSOBS-01 evaluates four concern batches and uses all eight owner views for global synthesis", async () => {
	const reads: string[] = [];
	const reasonInputs: Array<{ kind: string; scope: string; views: string[] }> =
		[];
	const observer = createSystemObserver({
		snapshots: {
			async readView(view) {
				reads.push(view);
				return { summary: `${view}-summary` };
			},
		},
		reason: async (input) => {
			reasonInputs.push({
				kind: input.kind,
				scope: input.scope,
				views: Object.keys(input.views),
			});
			return result();
		},
		idFactory: () => "sys-1",
		now: () => new Date("2026-08-15T15:00:00.000Z"),
	});

	const output = await observer.synthesize();
	assert.equal(output.assessmentRef, "assessment:sys-1");
	assert.equal(output.status, "ASSESSED");
	assert.equal(output.priority, "LOWEST");
	assert.equal(output.assessments.length, 4);
	assert.equal(
		reasonInputs.filter((entry) => entry.kind === "CONCERN_BATCH").length,
		4,
	);
	assert.deepEqual(
		new Set(reasonInputs.at(-1)?.views),
		new Set(SYSTEM_OBSERVER_VIEWS),
	);
	assert.ok(SYSTEM_OBSERVER_VIEWS.every((view) => reads.includes(view)));
});

test("PRESMOKE-B3-SYSOBS-02 carries prior unresolved state and performs targeted drill-down before global synthesis", async () => {
	const drilldowns: string[] = [];
	const requests: unknown[] = [];
	let batchNo = 0;
	const observer = createSystemObserver({
		snapshots: {
			async readView(view) {
				return { view };
			},
			async readDrilldown(input) {
				drilldowns.push(input.topic);
				return { topic: input.topic, evidenceRef: "evidence:unknown-1" };
			},
		},
		reason: async (input) => {
			requests.push(input);
			if (input.kind === "CONCERN_BATCH" && batchNo++ === 1) {
				return result({
					health: "DEGRADED",
					unresolved: ["execution unknown trend"],
					needsDrilldown: ["execution-unknown"],
					carryForward: [
						{ hypothesis: "unknown rate rising", confidence: 0.7 },
					],
				});
			}
			return result();
		},
		idFactory: () => "sys-2",
	});

	const output = await observer.synthesize({
		previousUnresolved: ["previous carrier drift"],
		previousCarryForward: [{ hypothesis: "selector drift", confidence: 0.6 }],
	});
	assert.deepEqual(drilldowns, ["execution-unknown"]);
	assert.equal(output.drilldown.length, 1);
	const global = requests.at(-1) as {
		kind: string;
		previousUnresolved: string[];
		previousCarryForward: unknown[];
		drilldown: unknown[];
	};
	assert.equal(global.kind, "GLOBAL_SYNTHESIS");
	assert.deepEqual(global.previousUnresolved, ["previous carrier drift"]);
	assert.equal(global.previousCarryForward.length, 1);
	assert.equal(global.drilldown.length, 1);
});

test("PRESMOKE-B3-SYSOBS-03 reason unavailability/failure defers and never synthesizes owner facts", async () => {
	let readCount = 0;
	const unavailable = createSystemObserver({
		snapshots: {
			async readView() {
				readCount += 1;
				return {};
			},
		},
		idFactory: () => "unavailable",
	});
	const unavailableResult = await unavailable.synthesize();
	assert.equal(unavailableResult.assessmentRef, "assessment:unavailable");
	assert.equal(unavailableResult.priority, "DEFERRED");
	assert.deepEqual(unavailableResult.assessments, []);
	assert.deepEqual(unavailableResult.drilldown, []);
	assert.equal(unavailableResult.global, null);
	assert.equal(unavailableResult.status, "DEFERRED");
	assert.equal(unavailableResult.errorCode, "REASON_UNAVAILABLE");
	assert.equal(readCount, 0);

	const failed = createSystemObserver({
		snapshots: {
			async readView() {
				return {};
			},
		},
		reason: async () => {
			throw new Error("model unavailable");
		},
		idFactory: () => "failed",
	});
	const output = await failed.synthesize();
	assert.equal(output.status, "DEFERRED");
	assert.equal(output.errorCode, "REASON_FAILED");
	assert.equal(output.global, null);

	const typedUnavailable = createSystemObserver({
		snapshots: {
			async readView() {
				return {};
			},
		},
		reason: async () => ({ ok: false, errorCode: "REASON_UNAVAILABLE" }),
		idFactory: () => "typed-unavailable",
	});
	const typedUnavailableResult = await typedUnavailable.synthesize();
	assert.equal(typedUnavailableResult.status, "DEFERRED");
	assert.equal(typedUnavailableResult.errorCode, "REASON_UNAVAILABLE");
	assert.equal(typedUnavailableResult.global, null);
});

test("PRESMOKE-B5-SYSOBS-04 CONTEXT_TOO_LARGE is caller-owned: pair splits, single view compacts, and synthesis continues", async () => {
	const calls: Array<{
		scope: string;
		viewCount: number;
		previousCount: number;
	}> = [];
	const overflowed = new Set<string>();
	const observer = createSystemObserver({
		snapshots: {
			async readView(view) {
				return {
					summary: `${view}:${"x".repeat(1200)}`,
					health: "HEALTHY",
					findings: [],
				};
			},
		},
		reason: async (input) => {
			calls.push({
				scope: input.scope,
				viewCount: Object.keys(input.views).length,
				previousCount: input.previousUnresolved.length,
			});
			if (input.scope === "task-worker" && !overflowed.has("pair")) {
				overflowed.add("pair");
				return { ok: false, errorCode: "CONTEXT_TOO_LARGE" };
			}
			if (input.scope === "task-worker:task" && !overflowed.has("single")) {
				overflowed.add("single");
				return { ok: false, errorCode: "CONTEXT_TOO_LARGE" };
			}
			return result();
		},
		idFactory: () => "adaptive",
	});
	const output = await observer.synthesize({
		previousUnresolved: Array.from({ length: 40 }, (_, i) => `previous-${i}`),
	});
	assert.equal(output.status, "ASSESSED");
	assert.ok(
		calls.some((call) => call.scope === "task-worker" && call.viewCount === 2),
	);
	assert.ok(
		calls.some(
			(call) => call.scope === "task-worker:task" && call.viewCount === 1,
		),
	);
	assert.ok(
		calls.some(
			(call) =>
				call.scope === "task-worker:task:compact" && call.previousCount <= 8,
		),
	);
});

test("PRESMOKE-B5-SYSOBS-05 global CONTEXT_TOO_LARGE gets one explicit compact synthesis retry", async () => {
	let globalCalls = 0;
	const observer = createSystemObserver({
		snapshots: {
			async readView(view) {
				return { summary: `${view}:${"y".repeat(900)}`, health: "HEALTHY" };
			},
		},
		reason: async (input) => {
			if (input.kind === "GLOBAL_SYNTHESIS" && globalCalls++ === 0)
				return { ok: false, errorCode: "CONTEXT_TOO_LARGE" };
			return result();
		},
		idFactory: () => "global-adaptive",
	});
	const output = await observer.synthesize();
	assert.equal(output.status, "ASSESSED");
	assert.equal(globalCalls, 2);
});
