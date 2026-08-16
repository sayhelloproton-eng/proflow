import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { taskDiagnosticSpec } from "../src/specs/task-diagnostic.ts";

test("PRESMOKE-B3-TASK-DIAG-01 Task Diagnostic is a typed REASON-only advisory spec and is registered in the shipped process", async () => {
	const input = taskDiagnosticSpec.inputSchema.parse({
		taskId: "task:1",
		nodeId: "node:dev",
		runNo: 1,
		anomaly: {
			kind: "UNKNOWN_REALITY",
			ref: "execution:unknown-1",
			facts: { executionStatus: "UNKNOWN", effectObserved: null },
		},
	});
	assert.equal(input.anomaly.kind, "UNKNOWN_REALITY");
	assert.deepEqual(taskDiagnosticSpec.allowedModes, ["reason"]);
	assert.equal(taskDiagnosticSpec.routing?.startRole, "reason");
	assert.equal(taskDiagnosticSpec.routing?.allowReasonEscalation, false);
	taskDiagnosticSpec.outputSchema.parse({
		finding: "Reality is ambiguous",
		probableCause: "Delivery response was lost",
		confidence: 0.7,
		recommendedNextObservation: "Observe current Conversation",
		recommendedRecoveryAction: "Reconcile before retry",
		needsHumanAttention: false,
	});

	const processSource = await readFile(
		new URL("../src/process.ts", import.meta.url),
		"utf8",
	);
	assert.match(
		processSource,
		/systemHealthAssessmentSpec[\s\S]*taskDiagnosticSpec/,
	);
});
