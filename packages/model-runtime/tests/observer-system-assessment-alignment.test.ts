import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { MODEL_RUNTIME_PUBLIC_API } from "../src/index.ts";
import { systemHealthAssessmentSpec } from "../src/specs/system-health-assessment.ts";

async function runtimeSource(): Promise<string> {
	return readFile(new URL("../src/index.ts", import.meta.url), "utf8");
}

async function assessmentSpecSource(): Promise<string> {
	return readFile(
		new URL("../src/specs/system-health-assessment.ts", import.meta.url),
		"utf8",
	);
}

test("CP-MODEL-RT-09 normal Task progression is not a Model Runtime scheduling concern", async () => {
	assert.deepEqual(MODEL_RUNTIME_PUBLIC_API, ["infer", "getRuntimeStatus"]);
	const text = await runtimeSource();
	assert.doesNotMatch(
		text,
		/(?:NODE_READY|EXECUTION_RESULT_READY|PEER_REPLY_READY)[^\n]{0,160}infer/i,
	);
	assert.doesNotMatch(
		text,
		/(?:startNode|completeNode|waitNode|reopenNode)\s*\(/,
	);
});

test("CP-MODEL-RT-10 System Assessment spec consumes bounded views and excludes raw secret/full-repo/full-log payloads", async () => {
	const text = await assessmentSpecSource();
	for (const concern of [
		"task",
		"worker",
		"collaboration",
		"execution",
		"carrier",
		"model",
		"deployment",
		"artifact",
	])
		assert.match(text, new RegExp(concern, "i"));
	assert.doesNotMatch(text, /rawSecret|fullRepo|fullSource|fullLogs/);
});

test("CP-MODEL-RT-11 batch/carry-forward/drill-down/global synthesis stay caller-owned", async () => {
	const text = await runtimeSource();
	assert.doesNotMatch(
		text,
		/class\s+SystemObserver|createSystemObserver|AssessmentStore|CarryForwardStore/i,
	);
	assert.doesNotMatch(text, /globalSynthesis\s*\(/i);
	assert.doesNotMatch(text, /drillDown\s*\(/i);
	assert.match(text, /request\.payload/);
});

test("CP-MODEL-RT-12 background assessments defer behind business and model unavailability cannot mutate Task", async () => {
	const text = await runtimeSource();
	assert.match(text, /queues\[job\.request\.priority\]/);
	assert.match(text, /\["business",\s*"background"\]/);
	assert.doesNotMatch(
		text,
		/(?:INFERENCE_FAILED|MODEL_BUSY|server_paused)[^\n]{0,180}(?:failNode|waitNode|terminateTask)/i,
	);
});

test("CP-MODEL-RT-13 real phone REASON load gate remains evidence-backed, not inferred from contextWindow", async () => {
	const plan = await readFile(
		new URL(
			"../../../spec/模型与推理领域/07-测试计划/modules/model-runtime.md",
			import.meta.url,
		),
		"utf8",
	);
	assert.match(plan, /CP-MODEL-RT-13/);
	assert.match(plan, /latency/);
	assert.match(plan, /cross-batch reference retention/);
	assert.match(plan, /synthesis correctness/);
	assert.match(plan, /理论 context window 不能替代真实 gate/);
});

test("RF-MODEL-RT-14 model confidence never outranks Owner fact or Policy", async () => {
	const runtime = await runtimeSource();
	assert.doesNotMatch(
		runtime,
		/confidence\s*[>=]+\s*0\.\d+[^\n]{0,180}(?:ALLOW|approve|execute|complete)/i,
	);
	assert.doesNotMatch(
		runtime,
		/confidence[^\n]{0,180}(?:hard rule|policy)[^\n]{0,80}(?:override|bypass)/i,
	);
});

test("PRESMOKE-B3-SYSOBS-MODEL-01 System Assessment schema accepts bounded concern batches without requiring all eight views", () => {
	const parsed = systemHealthAssessmentSpec.inputSchema.parse({
		assessmentKind: "CONCERN_BATCH",
		scope: "task-worker",
		observedAt: "2026-08-15T15:00:00.000Z",
		views: {
			task: { summary: "one active task", health: "HEALTHY" },
			worker: { summary: "one bound worker", health: "HEALTHY" },
		},
		previousUnresolved: [],
		previousCarryForward: [],
	});
	assert.deepEqual(Object.keys(parsed.views ?? {}).sort(), ["task", "worker"]);
	assert.equal(parsed.assessmentKind, "CONCERN_BATCH");
});

test("PRESMOKE-B3-SYSOBS-MODEL-02 System Assessment output uses frozen CRITICAL health vocabulary", () => {
	const parsed = systemHealthAssessmentSpec.outputSchema.parse({
		scope: "global",
		health: "CRITICAL",
		findings: ["cross-domain degradation"],
		risks: [],
		anomalies: [],
		hypotheses: [],
		unresolved: [],
		needsDrilldown: [],
		evidenceRefs: [],
		carryForward: [],
		confidence: 0.8,
		rationale: "bounded evidence indicates critical degradation",
	});
	assert.equal(parsed.health, "CRITICAL");
});
