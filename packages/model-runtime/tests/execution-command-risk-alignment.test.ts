import assert from "node:assert/strict";
import { test } from "node:test";

import { createModelRuntime } from "../src/index.ts";
import { executionCommandRiskSpec } from "../src/specs/execution-command-risk.ts";
import { fakeProvider, verifiedTestRoles } from "./fixtures.ts";

const request = {
	contractVersion: "1.0.0" as const,
	specRef: executionCommandRiskSpec.specRef,
	mode: "auto" as const,
	priority: "business" as const,
	trace: {
		callerRef: "execution-runtime:model-decision",
		executionRef: "execution:1",
	},
	payload: {
		capability: "file.write",
		inputFingerprint: "sha256:abc",
		callerRef: "g-role",
		operation: { path: "README.md", bytes: 12 },
	},
};

test("PRESMOKE-B5-MODEL-01 execution.command-risk AUTO is FAST-first and escalates to REASON only on typed ESCALATE", async () => {
	const calls: string[] = [];
	const runtime = createModelRuntime({
		specs: [executionCommandRiskSpec],
		roles: verifiedTestRoles(),
		provider: fakeProvider(async ({ role }: { role: string }) => {
			calls.push(role);
			return JSON.stringify({
				decision: role === "fast" ? "ESCALATE" : "ALLOW",
				reasonCode: role === "fast" ? "NEEDS_REASON" : "BOUNDED_ALLOW",
				confidence: 0.8,
				rationale: "bounded test verdict",
			});
		}),
	});
	const result = await runtime.infer(request);
	assert.equal(result.status, "SUCCEEDED");
	assert.equal(result.actualMode, "reason");
	assert.deepEqual(calls, ["fast", "reason"]);
});

test("PRESMOKE-B5-MODEL-02 REASON ESCALATE remains caller-owned Human escalation, not autonomous ALLOW", async () => {
	const runtime = createModelRuntime({
		specs: [executionCommandRiskSpec],
		roles: verifiedTestRoles(),
		provider: fakeProvider(async () =>
			JSON.stringify({
				decision: "ESCALATE",
				reasonCode: "HUMAN_REQUIRED",
				confidence: 0.55,
				rationale: "uncertain side effect",
			}),
		),
	});
	const result = await runtime.infer(request);
	assert.equal(result.status, "SUCCEEDED");
	assert.deepEqual((result.data as { decision: string }).decision, "ESCALATE");
});
