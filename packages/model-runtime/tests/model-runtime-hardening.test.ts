import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createReasoningSpec } from "@tomflow/proflow-model-contracts";
import { z } from "zod";
import {
	createFileModelRuntimeLogger,
	createModelRuntime,
	renderPrompt,
	verifyProviderCapabilities,
	verifyRoleCapabilities,
} from "../src/index.ts";
import { createOpenAICompatibleProvider } from "../src/provider.ts";
import { fakeProvider } from "./fixtures.ts";

const profile = (role: "fast" | "reason") => ({
	modelRef: `test-${role}`,
	reasoningModes: [role === "fast" ? "no-thinking" : "thinking"] as Array<
		"thinking" | "no-thinking"
	>,
	inputModalities: ["text", "image"] as Array<"text" | "image">,
	structuredOutput: "native" as const,
	contextWindow: 32_000,
	maxOutputTokens: 4_096,
});

const observed = {
	fast: {
		modelRef: "test-fast",
		text: true,
		image: true,
		structuredOutput: "native" as const,
		contextWindow: 32_000,
		maxOutputTokens: 4_096,
		reasoning: "no-thinking" as const,
		reasoningBasis: "provider-response-thinking-absent" as const,
		verifiedAt: new Date().toISOString(),
	},
	reason: {
		modelRef: "test-reason",
		text: true,
		image: true,
		structuredOutput: "native" as const,
		contextWindow: 32_000,
		maxOutputTokens: 4_096,
		reasoning: "thinking" as const,
		reasoningBasis: "provider-response-thinking-closed" as const,
		verifiedAt: new Date().toISOString(),
	},
};

function roles(
	overrides?: {
		fast?: Partial<ReturnType<typeof profile>>;
		reason?: Partial<ReturnType<typeof profile>>;
	},
	verifiedAt = observed.fast.verifiedAt,
) {
	return verifyRoleCapabilities({
		declared: {
			fast: { profile: { ...profile("fast"), ...overrides?.fast } },
			reason: { profile: { ...profile("reason"), ...overrides?.reason } },
		},
		observed: {
			fast: { ...observed.fast, verifiedAt },
			reason: { ...observed.reason, verifiedAt },
		},
	});
}

const spec = (input?: {
	id?: string;
	version?: string;
	requiredModalities?: readonly ("text" | "image")[];
	maxContextBytes?: number;
	maxOutputTokens?: number;
}) =>
	createReasoningSpec({
		id: input?.id ?? "hardening.control",
		version: input?.version ?? "1.0.0",
		purpose: "prove runtime hardening",
		allowedModes: ["fast", "reason"],
		requiredModalities: input?.requiredModalities ?? ["text"],
		inputSchema: z.object({ value: z.string() }).strict(),
		outputSchema: z.object({ decision: z.literal("ALLOW") }).strict(),
		instruction: "Return ALLOW.",
		...(input?.maxContextBytes
			? { maxContextBytes: input.maxContextBytes }
			: {}),
		maxOutputTokens: input?.maxOutputTokens ?? 16,
		repair: "none",
	});

const request = (
	specRef: string,
	input?: { images?: true; value?: string },
) => ({
	contractVersion: "1.0.0" as const,
	specRef,
	mode: "fast" as const,
	priority: "business" as const,
	trace: { callerRef: "hardening:test", correlationId: "correlation:test" },
	payload: { value: input?.value ?? "ok" },
	...(input?.images
		? { images: [{ mimeType: "image/png" as const, data: "YWJj" }] }
		: {}),
});

test("MOD-P1-01/07 admission rejects actual modality and profile limits before provider", async () => {
	let calls = 0;
	const provider = fakeProvider(async () => {
		calls += 1;
		return '{"decision":"ALLOW"}';
	});
	const imageSpec = spec({
		id: "hardening.image",
		requiredModalities: ["text", "image"],
	});
	const missingImage = createModelRuntime({
		specs: [imageSpec],
		roles: roles(),
		provider,
	});
	assert.equal(
		(await missingImage.infer(request(imageSpec.specRef))).error?.code,
		"CAPABILITY_UNSUPPORTED",
	);

	const outputSpec = spec({ id: "hardening.output", maxOutputTokens: 64 });
	const outputLimited = createModelRuntime({
		specs: [outputSpec],
		roles: roles({ fast: { maxOutputTokens: 32 } }),
		provider,
	});
	assert.equal(
		(await outputLimited.infer(request(outputSpec.specRef))).error?.code,
		"CAPABILITY_UNSUPPORTED",
	);

	const contextSpec = spec({ id: "hardening.context" });
	const contextLimited = createModelRuntime({
		specs: [contextSpec],
		roles: roles({ fast: { contextWindow: 8 } }),
		provider,
	});
	assert.equal(
		(
			await contextLimited.infer(
				request(contextSpec.specRef, { value: "context exceeds eight bytes" }),
			)
		).error?.code,
		"CAPABILITY_UNSUPPORTED",
	);
	assert.equal(calls, 0);
});

test("B2-MOD-01 pre-aborted signal fails fast and never reaches provider, queue, or lane", async () => {
	const control = spec();
	let calls = 0;
	const runtime = createModelRuntime({
		specs: [control],
		roles: roles(),
		provider: fakeProvider(async () => {
			calls += 1;
			return '{"decision":"ALLOW"}';
		}),
	});

	// Caller signal already aborted before infer: typed CANCELLED, zero calls.
	const callerController = new AbortController();
	callerController.abort();
	const cancelled = await runtime.infer(request(control.specRef), {
		signal: callerController.signal,
	});
	assert.equal(cancelled.status, "CANCELLED");
	assert.equal(cancelled.error?.code, "CANCELLED");

	// Pre-aborted restart signal keeps the RESTART vs caller-cancel distinction.
	const restartController = new AbortController();
	restartController.abort("RESTART");
	const restarted = await runtime.infer(request(control.specRef), {
		signal: restartController.signal,
	});
	assert.equal(restarted.status, "FAILED");
	assert.equal(restarted.error?.code, "INFERENCE_FAILED");

	// Abort exactly at the enqueue boundary: job is removed before the drain.
	const boundaryController = new AbortController();
	const boundary = runtime.infer(request(control.specRef), {
		signal: boundaryController.signal,
	});
	boundaryController.abort();
	assert.equal((await boundary).status, "CANCELLED");

	// Provider was never invoked, lane/queue never occupied, no late success.
	assert.equal(calls, 0);
	assert.equal(runtime.getRuntimeStatus().businessQueueDepth, 0);
	assert.equal(runtime.getRuntimeStatus().lane, "IDLE");

	// A subsequent normal inference still succeeds: the lane is not poisoned.
	const ok = await runtime.infer(request(control.specRef));
	assert.equal(ok.status, "SUCCEEDED");
	assert.equal(calls, 1);
});

test("MOD-P1-02/03 runtime rejects caller-forged READY and keeps auditable reasoning verification", () => {
	assert.throws(
		() =>
			createModelRuntime({
				specs: [spec()],
				roles: {
					fast: { state: "READY", profile: profile("fast") },
					reason: { state: "READY", profile: profile("reason") },
				} as never,
				provider: fakeProvider(async () => '{"decision":"ALLOW"}'),
			}),
		/capability verification/i,
	);
	const verified = roles();
	assert.equal(
		verified.fast.verification.reasoningBasis,
		"provider-response-thinking-absent",
	);
	assert.equal(
		verified.reason.verification.reasoningBasis,
		"provider-response-thinking-closed",
	);
	const stale = verifyRoleCapabilities({
		declared: {
			fast: { profile: profile("fast") },
			reason: { profile: profile("reason") },
		},
		observed: {
			...observed,
			fast: { ...observed.fast, verifiedAt: "2020-01-01T00:00:00.000Z" },
			reason: { ...observed.reason, verifiedAt: "2020-01-01T00:00:00.000Z" },
		},
	});
	assert.throws(
		() =>
			createModelRuntime({
				specs: [spec()],
				roles: stale,
				provider: fakeProvider(async () => '{"decision":"ALLOW"}'),
			}),
		/capability verification is stale/i,
	);
});

test("MOD-P1-04 provider failure immediately changes fresh role and runtime health", async () => {
	const control = spec();
	const runtime = createModelRuntime({
		specs: [control],
		roles: roles(),
		provider: fakeProvider(async () => {
			throw new Error("provider unavailable");
		}),
	});
	assert.equal(
		(await runtime.infer(request(control.specRef))).error?.code,
		"PROVIDER_ERROR",
	);
	assert.deepEqual(runtime.getRuntimeStatus(), {
		...runtime.getRuntimeStatus(),
		runtime: "DEGRADED",
		fast: "UNAVAILABLE",
		reason: "READY",
		lastErrorCode: "PROVIDER_ERROR",
	});
});

test("MOD-P1-02 verified READY expires dynamically in a long-running runtime", async () => {
	const control = spec();
	let currentTime = Date.now();
	let calls = 0;
	const runtime = createModelRuntime({
		specs: [control],
		roles: roles(undefined, new Date(currentTime).toISOString()),
		provider: fakeProvider(async () => {
			calls += 1;
			return '{"decision":"ALLOW"}';
		}),
		now: () => currentTime,
		capabilityVerificationMaxAgeMs: 100,
	});
	assert.equal(runtime.getRuntimeStatus().runtime, "READY");
	currentTime += 101;
	assert.deepEqual(runtime.getRuntimeStatus(), {
		runtime: "UNAVAILABLE",
		lane: "IDLE",
		fast: "UNAVAILABLE",
		reason: "UNAVAILABLE",
		businessQueueDepth: 0,
		backgroundQueueDepth: 0,
	});
	assert.equal(
		(await runtime.infer(request(control.specRef))).error?.code,
		"MODEL_UNAVAILABLE",
	);
	assert.equal(calls, 0);
});

test("MOD-CF-01 stale and transiently unavailable roles recover only through fresh verification", async () => {
	const control = spec();
	let currentTime = Date.now();
	let providerCalls = 0;
	let refreshes = 0;
	const runtime = createModelRuntime({
		specs: [control],
		roles: roles(undefined, new Date(currentTime).toISOString()),
		provider: fakeProvider(async () => {
			providerCalls += 1;
			if (providerCalls === 2) throw new Error("transient provider failure");
			return '{"decision":"ALLOW"}';
		}),
		now: () => currentTime,
		capabilityVerificationMaxAgeMs: 100,
		refreshRoles: async () => {
			refreshes += 1;
			return roles(undefined, new Date(currentTime).toISOString());
		},
	});
	currentTime += 101;
	assert.equal(
		(await runtime.infer(request(control.specRef))).status,
		"SUCCEEDED",
	);
	assert.equal(refreshes, 1);
	assert.equal(
		(await runtime.infer(request(control.specRef))).error?.code,
		"PROVIDER_ERROR",
	);
	assert.equal(runtime.getRuntimeStatus().fast, "UNAVAILABLE");
	assert.equal(
		(await runtime.infer(request(control.specRef))).status,
		"SUCCEEDED",
	);
	assert.equal(refreshes, 2);
});

test("MOD-CF-02/03 provider binding and protected canonical fields cannot be overridden", async () => {
	assert.throws(
		() =>
			createModelRuntime({
				specs: [spec()],
				roles: roles({ fast: { modelRef: "wrong-model" } }),
				provider: fakeProvider(async () => '{"decision":"ALLOW"}'),
			}),
		/model binding/i,
	);
	const bodies: Array<Record<string, unknown>> = [];
	const provider = createOpenAICompatibleProvider({
		baseUrl: "https://provider.example/v1/",
		models: { fast: "test-fast", reason: "test-reason" },
		roleBody: {
			fast: {
				model: "attacker-model",
				messages: [{ role: "user", content: "override" }],
				max_tokens: 999_999,
				response_format: { type: "text" },
				temperature: 0,
			},
		},
		fetch: async (_input, init) => {
			bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
			return Response.json({
				choices: [{ message: { content: '{"decision":"ALLOW"}' } }],
			});
		},
	});
	for (const structuredOutput of ["native", "prompted"] as const) {
		await provider.infer(
			{
				role: "fast",
				structuredOutput,
				request: request(spec().specRef),
				spec: spec(),
				prompt: "canonical",
				repair: false,
			},
			new AbortController().signal,
		);
	}
	assert.equal(bodies[0]?.model, "test-fast");
	assert.equal(bodies[0]?.max_tokens, 16);
	assert.equal(bodies[0]?.temperature, 0);
	assert.deepEqual(bodies[0]?.response_format, { type: "json_object" });
	assert.equal("response_format" in (bodies[1] ?? {}), false);
	assert.match(
		JSON.stringify(bodies[1]?.messages),
		/no native structured-output/,
	);
});

test("MOD-CF-04 declared model and limits remain unavailable without matching observed facts", () => {
	const verified = verifyRoleCapabilities({
		declared: {
			fast: { profile: profile("fast") },
			reason: { profile: profile("reason") },
		},
		observed: {
			fast: {
				...observed.fast,
				modelRef: "different-model",
			},
			reason: {
				...observed.reason,
				contextWindow: profile("reason").contextWindow - 1,
				maxOutputTokens: profile("reason").maxOutputTokens - 1,
			},
		},
	});
	assert.equal(verified.fast.state, "UNAVAILABLE");
	assert.equal(verified.reason.state, "UNAVAILABLE");
});

test("MOD-CF-01/04 READY can be derived by real provider probes plus explicit capability facts", async () => {
	const control = spec();
	let calls = 0;
	const provider = fakeProvider(async ({ role }) => {
		calls += 1;
		return {
			content: '{"decision":"ALLOW"}',
			thinkingStatus: role === "fast" ? "absent" : "closed",
		};
	});
	const declared = {
		fast: {
			profile: {
				...profile("fast"),
				inputModalities: ["text"] as Array<"text" | "image">,
			},
		},
		reason: {
			profile: {
				...profile("reason"),
				inputModalities: ["text"] as Array<"text" | "image">,
			},
		},
	};
	const probeRequest = request(control.specRef);
	const probes = {
		fast: {
			request: probeRequest,
			spec: control,
			prompt: renderPrompt(control, probeRequest.payload),
		},
		reason: {
			request: { ...probeRequest, mode: "reason" as const },
			spec: control,
			prompt: renderPrompt(control, probeRequest.payload),
		},
	};
	const facts = {
		fast: {
			contextWindow: 32_000,
			maxOutputTokens: 4_096,
			basis: "provider-config" as const,
		},
		reason: {
			contextWindow: 32_000,
			maxOutputTokens: 4_096,
			basis: "provider-protocol" as const,
		},
	};
	const verified = await verifyProviderCapabilities({
		declared,
		provider,
		probes,
		capabilityFacts: facts,
	});
	assert.equal(calls, 2);
	assert.equal(verified.fast.state, "READY");
	assert.equal(verified.reason.state, "READY");
});

test("MOD-P1-05 structured disk logs are sanitized and contain bounded machine facts", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-model-logs-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const control = spec({
		id: "hardening.logged-image",
		requiredModalities: ["text", "image"],
	});
	const runtime = createModelRuntime({
		specs: [control],
		roles: roles(),
		provider: fakeProvider(async () => ({
			content: '{"decision":"ALLOW"}',
			providerRequestRef: "provider-safe-ref",
			finishReason: "stop",
			thinkingStatus: "absent",
		})),
		logger: createFileModelRuntimeLogger({ proflowRoot: root }),
	});
	const secretPayload = "PROMPT_SECRET_MUST_NOT_BE_LOGGED";
	const result = await runtime.infer(
		request(control.specRef, { value: secretPayload, images: true }),
	);
	assert.equal(result.status, "SUCCEEDED");
	const rejectedSecret = "PREQUEUE_SECRET_MUST_NOT_BE_LOGGED";
	assert.equal(
		(
			await runtime.infer({
				...request(control.specRef, { images: true }),
				payload: { wrong: rejectedSecret },
			})
		).error?.code,
		"INVALID_REQUEST",
	);
	const log = await readFile(join(root, "logs/model/inference.jsonl"), "utf8");
	assert.doesNotMatch(log, new RegExp(secretPayload));
	assert.doesNotMatch(log, new RegExp(rejectedSecret));
	assert.doesNotMatch(log, /YWJj/);
	assert.match(log, /provider-safe-ref/);
	assert.match(log, /correlation:test/);
	assert.match(log, /PRE_QUEUE_REJECTION/);
	const entry = JSON.parse(log.trim().split("\n")[0] ?? "{}") as Record<
		string,
		unknown
	>;
	assert.equal(entry.inferenceRef, result.inferenceRef);
	assert.equal(entry.status, "SUCCEEDED");
	assert.equal(entry.imageCount, 1);
});

test("MOD-DECISION-01 duplicate canonical specRef cannot silently overwrite an exact Spec", () => {
	assert.throws(
		() =>
			createModelRuntime({
				specs: [
					spec({ id: "hardening.identity", version: "1.0.0" }),
					spec({ id: "hardening.identity", version: "1.1.0" }),
				],
				roles: roles(),
				provider: fakeProvider(async () => '{"decision":"ALLOW"}'),
			}),
		/duplicate ReasoningSpec identity/i,
	);
});
