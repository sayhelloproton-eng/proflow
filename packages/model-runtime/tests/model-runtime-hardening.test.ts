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
	verifyRoleCapabilities,
} from "../src/index.ts";
import { fakeProvider } from "./fixtures.ts";

const profile = (role: "fast" | "reason") => ({
	modelRef: `hardening-${role}`,
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
		text: true,
		image: true,
		structuredOutput: true,
		reasoning: "no-thinking" as const,
		reasoningBasis: "provider-response-thinking-absent" as const,
		verifiedAt: new Date().toISOString(),
	},
	reason: {
		text: true,
		image: true,
		structuredOutput: true,
		reasoning: "thinking" as const,
		reasoningBasis: "provider-response-thinking-closed" as const,
		verifiedAt: new Date().toISOString(),
	},
};

function roles(overrides?: {
	fast?: Partial<ReturnType<typeof profile>>;
	reason?: Partial<ReturnType<typeof profile>>;
}) {
	return verifyRoleCapabilities({
		declared: {
			fast: { profile: { ...profile("fast"), ...overrides?.fast } },
			reason: { profile: { ...profile("reason"), ...overrides?.reason } },
		},
		observed,
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
	const log = await readFile(join(root, "logs/model/inference.jsonl"), "utf8");
	assert.doesNotMatch(log, new RegExp(secretPayload));
	assert.doesNotMatch(log, /YWJj/);
	assert.match(log, /provider-safe-ref/);
	assert.match(log, /correlation:test/);
	const entry = JSON.parse(log.trim()) as Record<string, unknown>;
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
