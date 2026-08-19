import assert from "node:assert/strict";
import { test } from "node:test";
import { createReasoningSpec } from "@tomflow/proflow-model-contracts";
import { z } from "zod";
import { createBehaviorAdapter } from "../deployment/adapter.ts";
import { createModelRuntime, renderPrompt } from "../src/index.ts";
import { createOpenAICompatibleProvider } from "../src/provider.ts";
import { createModelRuntimeService } from "../src/service.ts";
import { fakeProvider, verifiedTestRoles } from "./fixtures.ts";

const spec = createReasoningSpec({
	id: "test.engineering",
	version: "1.0.0",
	purpose: "exercise production runtime boundaries",
	allowedModes: ["fast", "reason"],
	requiredModalities: ["text"],
	inputSchema: z.object({ value: z.string() }).strict(),
	outputSchema: z.object({ decision: z.literal("ALLOW") }).strict(),
	instruction: "Return ALLOW.",
	maxContextBytes: 64,
	maxOutputTokens: 32,
	repair: "none",
});

const request = {
	contractVersion: "1.0.0" as const,
	specRef: spec.specRef,
	mode: "fast" as const,
	priority: "business" as const,
	trace: { callerRef: "test:engineering" },
	payload: { value: "ok" },
};

test("runtime returns typed failures for boundary, capability, size, and invalid output", async () => {
	const unavailableRoles = verifiedTestRoles({
		fastObserved: { structuredOutput: "unsupported" },
	});
	const unavailable = createModelRuntime({
		specs: [spec],
		roles: unavailableRoles,
		provider: fakeProvider(async () => '{"decision":"ALLOW"}'),
	});
	assert.equal(
		(await unavailable.infer(request)).error?.code,
		"MODEL_UNAVAILABLE",
	);
	assert.equal(
		(await unavailable.infer({ ...request, payload: { wrong: true } })).error
			?.code,
		"INVALID_REQUEST",
	);
	assert.equal(
		(
			await unavailable.infer({
				...request,
				payload: { value: "x".repeat(100) },
			})
		).error?.code,
		"CONTEXT_TOO_LARGE",
	);

	const invalidOutput = createModelRuntime({
		specs: [spec],
		roles: verifiedTestRoles(),
		provider: fakeProvider(async () => "not-json"),
	});
	assert.equal(
		(await invalidOutput.infer(request)).error?.code,
		"INVALID_OUTPUT",
	);

	const noVisionRoles = verifiedTestRoles({
		fastProfile: { inputModalities: ["text"] },
	});
	const noVision = createModelRuntime({
		specs: [spec],
		roles: noVisionRoles,
		provider: fakeProvider(async () => '{"decision":"ALLOW"}'),
	});
	assert.equal(
		(
			await noVision.infer({
				...request,
				images: [{ mimeType: "image/png", data: "aGVsbG8=" }],
			})
		).error?.code,
		"CAPABILITY_UNSUPPORTED",
	);
});

test("transport retry occurs once only when provider proves the request never started", async () => {
	let safeAttempts = 0;
	const safeRetry = createModelRuntime({
		specs: [spec],
		roles: verifiedTestRoles(),
		provider: fakeProvider(async () => {
			safeAttempts += 1;
			if (safeAttempts === 1) {
				throw Object.assign(new Error("connect failed before write"), {
					notStarted: true,
				});
			}
			return '{"decision":"ALLOW"}';
		}),
	});
	assert.equal((await safeRetry.infer(request)).status, "SUCCEEDED");
	assert.equal(safeAttempts, 2);

	let ambiguousAttempts = 0;
	const noUnsafeRetry = createModelRuntime({
		specs: [spec],
		roles: verifiedTestRoles(),
		provider: fakeProvider(async () => {
			ambiguousAttempts += 1;
			throw new Error("connection ended after unknown provider progress");
		}),
	});
	const failed = await noUnsafeRetry.infer(request);
	assert.equal(failed.error?.code, "PROVIDER_ERROR");
	assert.equal(ambiguousAttempts, 1);
	assert.equal(typeof failed.metrics.inferenceLatencyMs, "number");
});

test("OpenAI-compatible adapter sends role mapping, structured output, and every image", async () => {
	let captured: Record<string, unknown> | undefined;
	let authorization: string | null = null;
	const provider = createOpenAICompatibleProvider({
		baseUrl: "https://provider.example/v1/",
		apiKey: "runtime-test-value",
		models: { fast: "fast-model", reason: "reason-model" },
		roleBody: { reason: { enable_thinking: true } },
		fetch: async (_input, init) => {
			captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
			authorization = new Headers(init?.headers).get("authorization");
			return Response.json({
				id: "provider-request",
				choices: [{ message: { content: '{"decision":"ALLOW"}' } }],
			});
		},
	});
	const result = await provider.infer(
		{
			role: "reason",
			structuredOutput: "native",
			request: {
				...request,
				mode: "reason",
				images: [
					{ mimeType: "image/png", data: "YWJj" },
					{ mimeType: "image/jpeg", data: "ZGVm" },
				],
			},
			spec,
			prompt: "controlled prompt",
			repair: false,
		},
		new AbortController().signal,
	);
	assert.equal(result.content, '{"decision":"ALLOW"}');
	assert.equal(captured?.model, "reason-model");
	assert.deepEqual(captured?.response_format, { type: "json_object" });
	assert.equal(captured?.enable_thinking, true);
	const messages = captured?.messages as Array<{ content: unknown }>;
	assert.match(String(messages[0]?.content), /OUTPUT_SCHEMA=/);
	assert.match(String(messages[0]?.content), /ALLOW/);
	const content = messages[1]?.content as unknown[];
	assert.equal(
		content.filter((part) => (part as { type?: string }).type === "image_url")
			.length,
		2,
	);
	assert.equal(authorization, "Bearer runtime-test-value");
});

test("rendered provider prompt deterministically binds Spec instruction and typed input", () => {
	const first = renderPrompt(spec, { value: "ok" });
	const second = renderPrompt(spec, { value: "ok" });
	assert.equal(first, second);
	assert.match(first, /test.engineering.v1/);
	assert.match(first, /Return ALLOW/);
	assert.match(first, /"value":"ok"/);
});

test("HTTP service owns real start/status/infer/stop lifecycle", async () => {
	const runtime = createModelRuntime({
		specs: [spec],
		roles: verifiedTestRoles(),
		provider: fakeProvider(async () => '{"decision":"ALLOW"}'),
	});
	const service = createModelRuntimeService({ runtime });
	assert.equal(service.status(), "STOPPED");
	const address = await service.start();
	assert.equal(service.status(), "RUNNING");
	const status = (await fetch(
		`http://${address.host}:${address.port}/status`,
	).then((response) => response.json())) as { runtime: string };
	assert.equal(status.runtime, "READY");
	const inference = (await fetch(
		`http://${address.host}:${address.port}/infer`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(request),
		},
	).then((response) => response.json())) as { status: string };
	assert.equal(inference.status, "SUCCEEDED");
	await service.stop();
	assert.equal(service.status(), "STOPPED");
});

test("REAL1 /ready and /status refresh stale model capabilities in the same request", async () => {
	let runtimeState: "READY" | "UNAVAILABLE" = "UNAVAILABLE";
	let refreshCount = 0;
	const runtime = {
		async infer(): Promise<never> {
			throw new Error("inference is not part of this readiness proof");
		},
		getRuntimeStatus() {
			return {
				runtime: runtimeState,
				lane: "IDLE" as const,
				fast:
					runtimeState === "READY"
						? ("READY" as const)
						: ("UNAVAILABLE" as const),
				reason:
					runtimeState === "READY"
						? ("READY" as const)
						: ("UNAVAILABLE" as const),
				businessQueueDepth: 0,
				backgroundQueueDepth: 0,
			};
		},
		async refreshCapabilities() {
			refreshCount += 1;
			runtimeState = "READY";
		},
	};
	const service = createModelRuntimeService({ runtime });
	const address = await service.start();
	try {
		const ready = await fetch(`http://${address.host}:${address.port}/ready`);
		assert.equal(ready.status, 200);
		assert.equal(refreshCount, 1);
		const readyBody = (await ready.json()) as {
			status: string;
			dependency: { runtime: string; fast: string; reason: string };
		};
		assert.equal(readyBody.status, "READY");
		assert.equal(readyBody.dependency.runtime, "READY");
		assert.equal(readyBody.dependency.fast, "READY");
		assert.equal(readyBody.dependency.reason, "READY");

		runtimeState = "UNAVAILABLE";
		const status = (await fetch(
			`http://${address.host}:${address.port}/status`,
		).then((response) => response.json())) as { runtime: string };
		assert.equal(status.runtime, "READY");
		assert.equal(refreshCount, 2);
	} finally {
		await service.stop();
	}
});

test("deployment adapter drives real service start/restart/status/stop lifecycle", async () => {
	const runtime = createModelRuntime({
		specs: [spec],
		roles: verifiedTestRoles(),
		provider: fakeProvider(async () => '{"decision":"ALLOW"}'),
	});
	const service = createModelRuntimeService({ runtime });
	const adapter = createBehaviorAdapter({
		service,
		verifyProvider: async () => ({
			ok: true,
			message: "test provider capability probe passed",
		}),
	});
	const started = await adapter.start();
	assert.equal(started.result.status, "SUCCEEDED");
	assert.deepEqual(started.observedEffects, [
		"Runs the Model Runtime HTTP service process",
	]);
	assert.equal(adapter.status().result.status, "SUCCEEDED");
	assert.equal((await adapter.verify()).result.status, "SUCCEEDED");
	const restarted = await adapter.restart();
	assert.equal(restarted.result.status, "SUCCEEDED");
	assert.equal(service.status(), "RUNNING");
	const stopped = await adapter.stop();
	assert.equal(stopped.result.status, "SUCCEEDED");
	assert.equal(service.status(), "STOPPED");
});

test("MOD-P1-06 HTTP client abort and deployment restart cancel queued/running work without late success", async (context) => {
	const releases: Array<() => void> = [];
	const runtime = createModelRuntime({
		specs: [spec],
		roles: verifiedTestRoles(),
		provider: fakeProvider(
			() =>
				new Promise<string>((resolve) => {
					releases.push(() => resolve('{"decision":"ALLOW"}'));
				}),
		),
	});
	const service = createModelRuntimeService({ runtime });
	let serviceRunning = false;
	const adapter = createBehaviorAdapter({
		service,
		verifyProvider: async () => ({ ok: true, message: "verified" }),
	});
	const started = await service.start();
	serviceRunning = true;
	const stopService = async () => {
		if (serviceRunning) {
			await service.stop();
			serviceRunning = false;
		}
	};
	context.after(stopService);
	const endpoint = `http://${started.host}:${started.port}/infer`;
	const running = fetch(endpoint, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			...request,
			trace: { callerRef: "restart:running" },
		}),
	}).then((response) => response.json()) as Promise<{
		status: string;
		error?: { code: string };
	}>;
	await new Promise<void>((resolve) => setImmediate(resolve));
	const queued = fetch(endpoint, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			...request,
			trace: { callerRef: "restart:queued" },
		}),
	}).then((response) => response.json()) as Promise<{
		status: string;
		error?: { code: string };
	}>;
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (runtime.getRuntimeStatus().businessQueueDepth === 1) break;
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	assert.equal(runtime.getRuntimeStatus().businessQueueDepth, 1);
	const restarted = await adapter.restart();
	if (!("data" in restarted.result))
		throw new Error("restart did not return a service address");
	const restartedAddress = restarted.result.data as {
		host: string;
		port: number;
	};
	assert.deepEqual(
		(await Promise.all([running, queued])).map((result) => result.error?.code),
		["INFERENCE_FAILED", "INFERENCE_FAILED"],
	);

	const clientAbort = new AbortController();
	const restartedEndpoint = `http://${restartedAddress.host}:${restartedAddress.port}/infer`;
	const aborted = fetch(restartedEndpoint, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			...request,
			trace: { callerRef: "client:aborted" },
		}),
		signal: clientAbort.signal,
	});
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (runtime.getRuntimeStatus().lane === "BUSY") break;
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	assert.equal(runtime.getRuntimeStatus().lane, "BUSY");
	clientAbort.abort();
	await assert.rejects(aborted, /abort/i);
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (runtime.getRuntimeStatus().lastErrorCode === "CANCELLED") break;
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	assert.equal(runtime.getRuntimeStatus().lastErrorCode, "CANCELLED");
	for (const release of releases) release();
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(runtime.getRuntimeStatus().lastSuccessAt, undefined);
	assert.equal(runtime.getRuntimeStatus().lastErrorCode, "CANCELLED");
	await stopService();
});

test("deployment uninstall is idempotent when no Model Runtime service is bound", async () => {
	const result = await createBehaviorAdapter().uninstall();
	assert.equal(result.result.status, "SUCCEEDED");
	assert.equal(result.result.ok, true);
	assert.deepEqual(result.observedEffects, []);
});
