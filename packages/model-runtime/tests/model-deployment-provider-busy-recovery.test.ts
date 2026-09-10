import assert from "node:assert/strict";
import { test } from "node:test";

import { createOpenAIModelDeploymentProbe } from "../deployment/role-mapper.ts";

test("deployment probe retries transient provider-busy 409 responses before rejecting a valid candidate", async () => {
	let calls = 0;
	const sleeps: number[] = [];
	const probe = createOpenAIModelDeploymentProbe({
		baseUrl: "http://phone.local:4400/v1",
		cooldownMs: 0,
		sleep: async (milliseconds) => {
			sleeps.push(milliseconds);
		},
		fetch: async () => {
			calls += 1;
			if (calls <= 3)
				return Response.json(
					{
						error: {
							code: "model_busy",
							message: "server is busy with the previous model",
						},
					},
					{ status: 409 },
				);
			return Response.json({
				choices: [
					{
						message: {
							content: '<think>bounded</think>{"probe":"PASS"}',
						},
					},
				],
			});
		},
	});

	const result = await probe({ id: "provider/reason" });
	assert.equal(result.reasoning, "thinking");
	assert.equal(result.structuredOutput, "native");
	assert.equal(result.vision, false);
	assert.equal(calls, 4);
	assert.deepEqual(sleeps, [5_000, 5_000, 5_000]);
});
