import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { MODEL_RUNTIME_PUBLIC_API } from "../src/index.ts";

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
	assert.doesNotMatch(text, /(?:NODE_READY|EXECUTION_RESULT_READY|PEER_REPLY_READY)[^\n]{0,160}infer/i);
	assert.doesNotMatch(text, /(?:startNode|completeNode|waitNode|reopenNode)\s*\(/);
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
	]) assert.match(text, new RegExp(concern, "i"));
	assert.doesNotMatch(text, /rawSecret|fullRepo|fullSource|fullLogs/);
});

test("CP-MODEL-RT-11 batch/carry-forward/drill-down/global synthesis stay caller-owned", async () => {
	const text = await runtimeSource();
	assert.doesNotMatch(text, /class\s+SystemObserver|createSystemObserver|AssessmentStore|CarryForwardStore/i);
	assert.doesNotMatch(text, /globalSynthesis\s*\(/i);
	assert.doesNotMatch(text, /drillDown\s*\(/i);
	assert.match(text, /request\.payload/);
});

test("CP-MODEL-RT-12 background assessments defer behind business and model unavailability cannot mutate Task", async () => {
	const text = await runtimeSource();
	assert.match(text, /queues\[job\.request\.priority\]/);
	assert.match(text, /\["business",\s*"background"\]/);
	assert.doesNotMatch(text, /(?:INFERENCE_FAILED|MODEL_BUSY|server_paused)[^\n]{0,180}(?:failNode|waitNode|terminateTask)/i);
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
	assert.doesNotMatch(runtime, /confidence\s*[>=]+\s*0\.\d+[^\n]{0,180}(?:ALLOW|approve|execute|complete)/i);
	assert.doesNotMatch(runtime, /confidence[^\n]{0,180}(?:hard rule|policy)[^\n]{0,80}(?:override|bypass)/i);
});
