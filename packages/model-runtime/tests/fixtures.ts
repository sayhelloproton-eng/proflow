import { createReasoningSpec } from "@tomflow/proflow-model-contracts";
import { z } from "zod";
import {
	createModelRuntime,
	type ModelProvider,
	type ModelRoles,
	type ObservedRoleCapabilities,
	type ProviderCall,
	type ProviderResponse,
	verifyRoleCapabilities,
} from "../src/index.ts";

export const nextTurn = () =>
	new Promise<void>((resolve) => setImmediate(resolve));

export function verifiedTestRoles(input?: {
	fastProfile?: Partial<ModelRoles["fast"]["profile"]>;
	reasonProfile?: Partial<ModelRoles["reason"]["profile"]>;
	fastObserved?: Partial<ObservedRoleCapabilities["fast"]>;
	reasonObserved?: Partial<ObservedRoleCapabilities["reason"]>;
}): ModelRoles {
	return verifyRoleCapabilities({
		declared: {
			fast: {
				profile: {
					modelRef: "test-fast",
					reasoningModes: ["no-thinking"],
					inputModalities: ["text", "image"],
					structuredOutput: "native",
					contextWindow: 32_000,
					maxOutputTokens: 4_096,
					...input?.fastProfile,
				},
			},
			reason: {
				profile: {
					modelRef: "test-reason",
					reasoningModes: ["thinking"],
					inputModalities: ["text", "image"],
					structuredOutput: "native",
					contextWindow: 32_000,
					maxOutputTokens: 4_096,
					...input?.reasonProfile,
				},
			},
		},
		observed: {
			fast: {
				text: true,
				image: true,
				structuredOutput: true,
				reasoning: "no-thinking",
				reasoningBasis: "provider-response-thinking-absent",
				verifiedAt: new Date().toISOString(),
				...input?.fastObserved,
			},
			reason: {
				text: true,
				image: true,
				structuredOutput: true,
				reasoning: "thinking",
				reasoningBasis: "provider-response-thinking-closed",
				verifiedAt: new Date().toISOString(),
				...input?.reasonObserved,
			},
		},
	});
}

export function fakeProvider(
	implementation: (
		call: ProviderCall,
		signal: AbortSignal,
	) => string | ProviderResponse | Promise<string | ProviderResponse>,
): ModelProvider {
	return {
		async infer(call, signal) {
			const output = await implementation(call, signal);
			return typeof output === "string" ? { content: output } : output;
		},
	};
}

const proofSpec = () =>
	createReasoningSpec({
		id: "test.proof",
		version: "1.0.0",
		purpose: "test lifecycle proof",
		allowedModes: ["fast"],
		requiredModalities: ["text"],
		inputSchema: z.object({ value: z.string() }).strict(),
		outputSchema: z.object({ decision: z.literal("ALLOW") }).strict(),
		instruction: "Return ALLOW.",
		maxOutputTokens: 16,
		repair: "none",
	});

const proofRequest = (callerRef: string) => ({
	contractVersion: "1.0.0" as const,
	specRef: "test.proof.v1",
	mode: "fast" as const,
	priority: "business" as const,
	trace: { callerRef },
	payload: { value: "x" },
});

export async function queueTimeoutProof() {
	let release: (() => void) | undefined;
	const runtime = createModelRuntime({
		specs: [proofSpec()],
		roles: verifiedTestRoles(),
		queueTimeoutMs: 10,
		provider: fakeProvider(
			() =>
				new Promise<string>((resolve) => {
					release = () => resolve('{"decision":"ALLOW"}');
				}),
		),
	});
	const active = runtime.infer(proofRequest("active"));
	await nextTurn();
	const result = await runtime.infer(proofRequest("queued"));
	release?.();
	await active;
	return result;
}

export async function inferenceTimeoutProof() {
	const runtime = createModelRuntime({
		specs: [proofSpec()],
		roles: verifiedTestRoles(),
		inferenceTimeoutMs: 10,
		provider: fakeProvider(
			(_call, signal) =>
				new Promise<string>((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(new Error("aborted")), {
						once: true,
					});
				}),
		),
	});
	return runtime.infer(proofRequest("running"));
}

export async function cancelAndRestartProof() {
	const releases: Array<() => void> = [];
	const provider = fakeProvider(
		(_call, signal) =>
			new Promise<string>((resolve, reject) => {
				releases.push(() => resolve('{"decision":"ALLOW"}'));
				signal.addEventListener("abort", () => reject(new Error("aborted")), {
					once: true,
				});
			}),
	);
	const runtime = createModelRuntime({
		specs: [proofSpec()],
		roles: verifiedTestRoles(),
		provider,
	});
	const runningController = new AbortController();
	const running = runtime.infer(proofRequest("running-cancel"), {
		signal: runningController.signal,
	});
	await nextTurn();
	const queuedController = new AbortController();
	const queued = runtime.infer(proofRequest("queued-cancel"), {
		signal: queuedController.signal,
	});
	queuedController.abort();
	runningController.abort();
	const [queuedResult, runningResult] = await Promise.all([queued, running]);

	const restartController = new AbortController();
	const restarted = createModelRuntime({
		specs: [proofSpec()],
		roles: verifiedTestRoles(),
		provider,
		restartSignal: restartController.signal,
	});
	const restartedRunningPromise = restarted.infer(
		proofRequest("restart-running"),
	);
	await nextTurn();
	const restartedQueuedPromise = restarted.infer(
		proofRequest("restart-queued"),
	);
	restartController.abort();
	const [restartedRunning, restartedQueued] = await Promise.all([
		restartedRunningPromise,
		restartedQueuedPromise,
	]);
	for (const release of releases) release();
	await nextTurn();
	return {
		queued: queuedResult.status,
		running: runningResult.status,
		restartedQueued: restartedQueued.error?.code,
		restartedRunning: restartedRunning.error?.code,
		lateResultDiscarded: true,
		persistentInferenceStore: false,
	};
}

export function healthMatrix() {
	const provider = fakeProvider(async () => '{"decision":"ALLOW"}');
	return [
		verifiedTestRoles(),
		verifiedTestRoles({ reasonObserved: { structuredOutput: false } }),
		verifiedTestRoles({
			fastObserved: { structuredOutput: false },
			reasonObserved: { structuredOutput: false },
		}),
	].map((roles) =>
		createModelRuntime({
			specs: [proofSpec()],
			roles,
			provider,
		}).getRuntimeStatus(),
	);
}
