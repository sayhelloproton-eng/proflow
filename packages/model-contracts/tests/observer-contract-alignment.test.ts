import assert from "node:assert/strict";
import { test } from "node:test";
import {
	inferenceRequestSchema,
	MODEL_CONTRACT_DESCRIPTOR,
} from "../src/index.ts";

test("CP-MODEL-CON-05 Task Diagnostic/System Assessment reuse infer(specRef); no extra business inference API", () => {
	const descriptor = MODEL_CONTRACT_DESCRIPTOR as unknown as Record<
		string,
		unknown
	>;
	const serialized = JSON.stringify(descriptor);
	assert.doesNotMatch(serialized, /assessSystem|judgeTask/);
	assert.match(serialized, /specRef/);
});

test("CP-MODEL-CON-06 trace accepts assessmentRef and background priority; oversized context is typed, never silent", () => {
	const parsed = inferenceRequestSchema.parse({
		contractVersion: "1.0.0",
		specRef: "system.assessment.v1",
		mode: "reason",
		priority: "background",
		trace: {
			callerRef: "system-observer",
			correlationId: "assessment-cycle:1",
			assessmentRef: "assessment:previous",
		},
		payload: { scope: "system" },
	});
	assert.equal(parsed.priority, "background");
	assert.equal(parsed.trace.assessmentRef, "assessment:previous");
	assert.match(JSON.stringify(MODEL_CONTRACT_DESCRIPTOR), /CONTEXT_TOO_LARGE/);
});

test("CP-MODEL-CON-07 Observer output contract carries judgment only, never Task/Execution authority", () => {
	const serialized = JSON.stringify(MODEL_CONTRACT_DESCRIPTOR);
	for (const forbidden of [
		"completeNode",
		"reopenNode",
		"approveExecution",
		"executeCapability",
		"applyPatch",
	])
		assert.equal(serialized.includes(forbidden), false, forbidden);
});
