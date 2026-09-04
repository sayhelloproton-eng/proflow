import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCarrierAttentionViews } from "../src/carrier-attention-view.ts";

test("CP-EXE-BR-25 Carrier Attention validates extension snapshot data at the UI boundary", () => {
	const valid = {
		attentionRef: "carrier-attention:17:permission:v1:one",
		taskId: "task-1",
		roleRef: "g-test",
		workerRef: "worker-test",
		targetHost: "gateway.example.test",
		operationId: "getTask",
		reason: "CONTEXT_MISMATCH",
		actions: ["allowOnce", "deny"],
		observedAt: "2026-09-04T04:00:00.000Z",
	};
	assert.deepEqual(
		parseCarrierAttentionViews([
			valid,
			null,
			{ ...valid, actions: ["allowAlways"] },
		]),
		[valid],
	);
	assert.deepEqual(
		parseCarrierAttentionViews({ carrierAttentions: [valid] }),
		[],
	);
});
