import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { z } from "zod";

import {
	cancelAndRestartProof,
	fakeProvider,
	healthMatrix,
	inferenceTimeoutProof,
	queueTimeoutProof,
	verifiedTestRoles,
} from "./fixtures.ts";

async function runtimeApi() {
	return import("../src/index.ts");
}

const request = (mode: "fast" | "reason" | "auto", priority = "business") => ({
	contractVersion: "1.0.0" as const,
	specRef: "test.control.v1",
	mode,
	priority,
	trace: { callerRef: "test:caller" },
	payload: { value: "input" },
	timeoutMs: 100,
});

const specInput = {
	id: "test.control",
	version: "1.0.0",
	purpose: "test controlled inference",
	allowedModes: ["fast", "reason", "auto"] as const,
	requiredModalities: ["text"] as const,
	inputSchema: z.object({ value: z.string() }).strict(),
	outputSchema: z
		.object({ decision: z.enum(["ALLOW", "DENY", "ESCALATE"]) })
		.strict(),
	instruction: "Return one controlled decision.",
	maxOutputTokens: 64,
	repair: "once" as const,
	routing: {
		startRole: "fast" as const,
		allowReasonEscalation: true,
		escalateDecisions: ["ESCALATE"],
	},
};

test("CP-MODEL-RT-01 FAST/REASON never fallback and AUTO escalates only by Spec", async () => {
	const api = await runtimeApi();
	const calls: string[] = [];
	const runtime = api.createModelRuntime({
		specs: [api.createReasoningSpec(specInput)],
		roles: verifiedTestRoles(),
		provider: fakeProvider(async ({ role }: { role: string }) => {
			calls.push(role);
			return JSON.stringify({
				decision: role === "fast" ? "ESCALATE" : "ALLOW",
			});
		}),
	});
	assert.equal((await runtime.infer(request("fast"))).actualMode, "fast");
	assert.deepEqual(calls, ["fast"]);
	calls.length = 0;
	assert.equal((await runtime.infer(request("reason"))).actualMode, "reason");
	assert.deepEqual(calls, ["reason"]);
	calls.length = 0;
	assert.equal((await runtime.infer(request("auto"))).actualMode, "reason");
	assert.deepEqual(calls, ["fast", "reason"]);
});

test("CP-MODEL-RT-02 one real lane prioritizes queued business and distinguishes timeouts", async () => {
	const api = await runtimeApi();
	const order: string[] = [];
	const releases: Array<() => void> = [];
	const startedResolvers: Array<() => void> = [];
	const started = Array.from(
		{ length: 3 },
		() =>
			new Promise<void>((resolve) => {
				startedResolvers.push(resolve);
			}),
	);
	const runtime = api.createModelRuntime({
		specs: [api.createReasoningSpec(specInput)],
		roles: verifiedTestRoles(),
		provider: fakeProvider(
			({ request: input }: { request: { trace: { callerRef: string } } }) =>
				new Promise<string>((resolve) => {
					const callIndex = order.length;
					order.push(input.trace.callerRef);
					releases.push(() => resolve('{"decision":"ALLOW"}'));
					startedResolvers[callIndex]?.();
				}),
		),
	});
	const active = runtime.infer({
		...request("fast", "background"),
		trace: { callerRef: "active" },
		timeoutMs: 30_000,
	});
	await started[0];
	const background = runtime.infer({
		...request("fast", "background"),
		trace: { callerRef: "background" },
		timeoutMs: 30_000,
	});
	const business = runtime.infer({
		...request("fast"),
		trace: { callerRef: "business" },
		timeoutMs: 30_000,
	});
	releases.shift()?.();
	await started[1];
	assert.deepEqual(order, ["active", "business"]);
	await active;
	releases.shift()?.();
	await started[2];
	assert.deepEqual(order, ["active", "business", "background"]);
	await business;
	releases.shift()?.();
	await background;
	assert.equal((await queueTimeoutProof()).error?.code, "QUEUE_TIMEOUT");
	assert.equal(
		(await inferenceTimeoutProof()).error?.code,
		"INFERENCE_TIMEOUT",
	);
});

test("CP-MODEL-RT-03 capability verification mismatch makes role and health unavailable", async () => {
	const api = await runtimeApi();
	const declared = verifiedTestRoles();
	const roles = api.verifyRoleCapabilities({
		declared: {
			fast: { profile: declared.fast.profile },
			reason: { profile: declared.reason.profile },
		},
		observed: {
			fast: {
				modelRef: declared.fast.profile.modelRef,
				text: true,
				image: false,
				structuredOutput: "native",
				contextWindow: declared.fast.profile.contextWindow,
				maxOutputTokens: declared.fast.profile.maxOutputTokens,
				reasoning: "no-thinking",
				reasoningBasis: "provider-response-thinking-absent",
				verifiedAt: new Date().toISOString(),
			},
			reason: {
				modelRef: declared.reason.profile.modelRef,
				text: true,
				image: true,
				structuredOutput: "unsupported",
				contextWindow: declared.reason.profile.contextWindow,
				maxOutputTokens: declared.reason.profile.maxOutputTokens,
				reasoning: "thinking",
				reasoningBasis: "provider-response-thinking-closed",
				verifiedAt: new Date().toISOString(),
			},
		},
	});
	assert.equal(roles.fast.state, "UNAVAILABLE");
	assert.equal(roles.reason.state, "UNAVAILABLE");
	assert.equal(api.healthFromRoles(roles).runtime, "UNAVAILABLE");
});

test("CP-MODEL-RT-04 deterministic prompt and invalid output perform at most one repair", async () => {
	const api = await runtimeApi();
	const spec = api.createReasoningSpec(specInput);
	assert.equal(
		api.renderPrompt(spec, { value: "input" }),
		api.renderPrompt(spec, { value: "input" }),
	);
	let calls = 0;
	const runtime = api.createModelRuntime({
		specs: [spec],
		roles: verifiedTestRoles(),
		provider: fakeProvider(async () => {
			calls++;
			return calls === 1 ? "not-json" : '{"decision":"ALLOW"}';
		}),
	});
	assert.equal((await runtime.infer(request("fast"))).status, "SUCCEEDED");
	assert.equal(calls, 2);
});

test("CP-MODEL-RT-05 proposal remains max-one data and Model exposes no Effect executor", async () => {
	const api = await runtimeApi();
	assert.equal(
		(api.MODEL_RUNTIME_PUBLIC_API as readonly string[]).includes(
			"executeCapability",
		),
		false,
	);
	assert.deepEqual(api.MODEL_RUNTIME_PUBLIC_API, ["infer", "getRuntimeStatus"]);
});

test("CP-MODEL-RT-06 queued/running cancel and restart are explicit with no inference DB", async () => {
	const proof = await cancelAndRestartProof();
	assert.deepEqual(proof, {
		queued: "CANCELLED",
		running: "CANCELLED",
		restartedQueued: "INFERENCE_FAILED",
		restartedRunning: "INFERENCE_FAILED",
		lateResultDiscarded: true,
		persistentInferenceStore: false,
	});
});

test("CP-MODEL-RT-07 status reports fresh READY/DEGRADED/UNAVAILABLE lane and role diagnostics", async () => {
	assert.deepEqual(
		healthMatrix().map((item: { runtime: string }) => item.runtime),
		["READY", "DEGRADED", "UNAVAILABLE"],
	);
});

test("CP-MODEL-RT-08 M2/M3/M4 require committed real-provider evidence", async () => {
	const evidence = JSON.parse(
		await readFile(
			new URL(
				"../../../spec/模型与推理领域/08-测试用例与验证/REAL-PROVIDER-EVIDENCE.json",
				import.meta.url,
			),
			"utf8",
		),
	) as { M2?: string; M3?: string; M4?: string; realProvider?: boolean };
	assert.deepEqual(evidence, {
		...evidence,
		realProvider: true,
		M2: "PASS",
		M3: "PASS",
		M4: "PASS",
	});
});
