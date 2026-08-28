import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	readModuleSharedFacts,
	writeModuleSharedFacts,
} from "@tomflow/proflow-module-contract";
import { createModelRuntimeBehaviorAdapter } from "../deployment/adapter.ts";
import {
	createOpenAIModelDeploymentProbe,
	decideRoleMapping,
	type ModelDeploymentEvidence,
	verifyAndMapInventory,
} from "../deployment/role-mapper.ts";

const evidence = (
	modelRef: string,
	reasoning: "thinking" | "no-thinking",
	overrides: Partial<ModelDeploymentEvidence> = {},
): ModelDeploymentEvidence => ({
	modelRef,
	text: true,
	vision: reasoning === "no-thinking",
	structuredOutput: "native",
	reasoning,
	contextWindow: 16_384,
	maxOutputTokens: 2_048,
	verifiedAt: "2026-08-25T00:00:00.000Z",
	...overrides,
});

async function workspace(context: { after(fn: () => unknown): void }) {
	const root = await mkdtemp(join(tmpdir(), "proflow-model-deployment-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

async function providerFacts(
	workspaceRoot: string,
	models: readonly string[] = ["fast", "reason"],
) {
	await writeModuleSharedFacts({ workspaceRoot }, "model-provider-api", {
		providerBaseUrl: "http://phone.local:4400/v1",
		protocol: "openai-compatible",
		models: models.map((id) => ({ id })),
		inventoryObservedAt: "2026-08-25T00:00:00.000Z",
	});
}

test("missing Provider keeps Model Runtime blocked without turning setup into a machine failure", async (context) => {
	const workspaceRoot = await workspace(context);
	const adapter = createModelRuntimeBehaviorAdapter();
	await adapter.install({ workspaceRoot });
	const before = await adapter.status({ workspaceRoot });
	assert.equal(before.result.data.setupStatus, "BLOCKED");
	const setup = await adapter.setup({ workspaceRoot });
	assert.equal(setup.result.status, "SUCCEEDED");
	assert.equal("data" in setup.result, true);
	if (!("data" in setup.result))
		assert.fail("setup result must expose waitingFor");
	assert.deepEqual(setup.result.data, { waitingFor: ["model-provider-api"] });
	const after = await adapter.status({ workspaceRoot });
	assert.equal(after.result.data.setupStatus, "BLOCKED");
});

test("unique evidence-qualified FAST and REASON candidates map automatically", () => {
	const result = decideRoleMapping([
		evidence("provider/fast-model", "no-thinking"),
		evidence("provider/reason-model", "thinking"),
	]);
	assert.equal(result.status, "READY");
	if (result.status !== "READY") return;
	assert.deepEqual(result.mapping, {
		fast: "provider/fast-model",
		reason: "provider/reason-model",
	});
	assert.equal(result.profiles.fast.inputModalities.includes("image"), true);
	assert.deepEqual(result.profiles.reason.reasoningModes, ["thinking"]);
});

test("multiple equally qualified FAST candidates remain ambiguous instead of choosing list order", () => {
	const result = decideRoleMapping([
		evidence("provider/alpha", "no-thinking"),
		evidence("provider/beta", "no-thinking"),
		evidence("provider/reason", "thinking"),
	]);
	assert.equal(result.status, "AMBIGUOUS");
	if (result.status !== "AMBIGUOUS") return;
	assert.equal(result.role, "fast");
	assert.deepEqual(result.candidates, ["provider/alpha", "provider/beta"]);
});

test("model ID is only a ranking signal after real capability evidence qualifies candidates", () => {
	const result = decideRoleMapping([
		evidence("provider/no-think", "thinking", { vision: true }),
		evidence("provider/default", "no-thinking"),
		evidence("provider/reason", "thinking"),
	]);
	assert.equal(result.status, "READY");
	if (result.status !== "READY") return;
	assert.equal(result.mapping.fast, "provider/default");
});

test("missing REASON and invalid Vision fail closed", () => {
	assert.deepEqual(
		decideRoleMapping([evidence("provider/fast", "no-thinking")]),
		{
			status: "MISSING_ROLE",
			role: "reason",
			candidates: [],
		},
	);
	assert.deepEqual(
		decideRoleMapping([
			evidence("provider/not-vision", "no-thinking", { vision: false }),
			evidence("provider/reason", "thinking"),
		]),
		{
			status: "MISSING_ROLE",
			role: "fast",
			candidates: [],
		},
	);
});

test("a still-valid previous mapping is reused idempotently across inventory ordering changes", () => {
	const input = [
		evidence("provider/fast-a", "no-thinking"),
		evidence("provider/fast-b", "no-thinking"),
		evidence("provider/reason", "thinking"),
	];
	const result = decideRoleMapping(input.reverse(), {
		fast: "provider/fast-b",
		reason: "provider/reason",
	});
	assert.equal(result.status, "READY");
	if (result.status !== "READY") return;
	assert.equal(result.mapping.fast, "provider/fast-b");
});

test("an irreducible single-role human choice only selects an already evidence-qualified candidate", () => {
	const input = [
		evidence("provider/fast-a", "no-thinking"),
		evidence("provider/fast-b", "no-thinking"),
		evidence("provider/reason", "thinking"),
	];
	const selected = decideRoleMapping(input, { fast: "provider/fast-b" });
	assert.equal(selected.status, "READY");
	if (selected.status !== "READY") return;
	assert.equal(selected.mapping.fast, "provider/fast-b");
	const invalid = decideRoleMapping(input, { fast: "provider/not-qualified" });
	assert.equal(invalid.status, "AMBIGUOUS");
});

test("inventory verification is sequential, bounded, and applies the configured inter-case cooldown", async () => {
	let active = 0;
	let maxActive = 0;
	const calls: string[] = [];
	const sleeps: number[] = [];
	const result = await verifyAndMapInventory({
		models: [{ id: "fast" }, { id: "reason" }],
		probe: async (model) => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			calls.push(model.id);
			active -= 1;
			return evidence(
				model.id,
				model.id === "fast" ? "no-thinking" : "thinking",
			);
		},
		cooldownMs: 5_000,
		sleep: async (milliseconds) => {
			sleeps.push(milliseconds);
		},
	});
	assert.equal(result.status, "READY");
	assert.equal(maxActive, 1);
	assert.deepEqual(calls, ["fast", "reason"]);
	assert.deepEqual(sleeps, [5_000]);
});

test("real deployment probe derives structured, reasoning, context and Vision evidence from bounded API calls", async () => {
	const bodies: Array<Record<string, unknown>> = [];
	const sleeps: number[] = [];
	const probe = createOpenAIModelDeploymentProbe({
		baseUrl: "http://phone.local:4400/v1",
		fetch: async (_input, init) => {
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			bodies.push(body);
			return Response.json({
				id: `request-${bodies.length}`,
				choices: [
					{
						message: {
							content: '{"probe":"PASS"}',
						},
					},
				],
			});
		},
		sleep: async (milliseconds) => {
			sleeps.push(milliseconds);
		},
		cooldownMs: 5_000,
		now: () => "2026-08-25T00:00:00.000Z",
	});
	const result = await probe({ id: "provider/fast" });
	assert.equal(result.reasoning, "no-thinking");
	assert.equal(result.structuredOutput, "native");
	assert.equal(result.vision, true);
	assert.equal(result.contextWindow, 16_384);
	assert.equal(result.maxOutputTokens, 2_048);
	assert.equal(bodies.length, 2);
	assert.equal(String(JSON.stringify(bodies[0])).length >= 16_384, true);
	assert.match(JSON.stringify(bodies[1]), /image_url/);
	assert.deepEqual(sleeps, [5_000]);
});

test("real deployment probe recognizes closed thinking evidence and does not require Vision for REASON", async () => {
	let calls = 0;
	const probe = createOpenAIModelDeploymentProbe({
		baseUrl: "http://phone.local:4400/v1",
		fetch: async () => {
			calls += 1;
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
		cooldownMs: 0,
	});
	const result = await probe({ id: "provider/reason" });
	assert.equal(result.reasoning, "thinking");
	assert.equal(result.vision, false);
	assert.equal(calls, 1);
});

test("deployment probe rejects invalid JSON/protocol and never includes credential in errors", async () => {
	const secret = "DEPLOYMENT_SECRET_MUST_NOT_LEAK";
	const probe = createOpenAIModelDeploymentProbe({
		baseUrl: "http://phone.local:4400/v1",
		credential: secret,
		fetch: async (_input, init) => {
			assert.match(JSON.stringify(init?.headers), /authorization/i);
			return Response.json({ choices: [{ message: { content: "not-json" } }] });
		},
	});
	await assert.rejects(probe({ id: "provider/invalid" }), (error: unknown) => {
		assert.doesNotMatch(String(error), new RegExp(secret));
		return /structured capability probe failed/.test(String(error));
	});
});

test("deployment setup automatically persists role evidence and publishes local runtime facts", async (context) => {
	const workspaceRoot = await workspace(context);
	await providerFacts(workspaceRoot);
	let mappings = 0;
	const adapter = createModelRuntimeBehaviorAdapter({
		mapInventory: async () => {
			mappings += 1;
			return decideRoleMapping([
				evidence("fast", "no-thinking"),
				evidence("reason", "thinking"),
			]);
		},
		observeInventory: async () => ["fast", "reason"],
	});
	assert.equal(
		(
			await adapter.setup({
				workspaceRoot,
				input: { fastModel: "fast", reasonModel: "reason" },
			})
		).result.status,
		"SUCCEEDED",
	);
	assert.equal(
		(await adapter.setup({ workspaceRoot })).result.status,
		"SUCCEEDED",
	);
	assert.equal(
		mappings,
		1,
		"unchanged validated inventory should reuse mapping",
	);
	assert.deepEqual((await adapter.status({ workspaceRoot })).result.data, {
		setupStatus: "READY",
		runtimeStatus: "STOPPED",
	});
	const facts = await readModuleSharedFacts({ workspaceRoot }, "model-runtime");
	assert.match(String(facts?.endpoint), /^http:\/\/127\.0\.0\.1:/);
	assert.match(String(facts?.transportCredentialFile), /transport\.token$/);
	assert.deepEqual(facts?.roleMapping, { fast: "fast", reason: "reason" });
});

test("ambiguous mapping requests only irreducible model choice while missing role fails closed", async (context) => {
	const ambiguousRoot = await workspace(context);
	await providerFacts(ambiguousRoot, ["fast-a", "fast-b", "reason"]);
	const ambiguous = createModelRuntimeBehaviorAdapter({
		mapInventory: async ({ previous }) =>
			decideRoleMapping(
				[
					evidence("fast-a", "no-thinking"),
					evidence("fast-b", "no-thinking"),
					evidence("reason", "thinking"),
				],
				previous,
			),
	});
	const choice = await ambiguous.setup({ workspaceRoot: ambiguousRoot });
	assert.equal(choice.result.status, "ACTION_REQUIRED");
	assert.equal(choice.result.actionRequired?.action, "select-model-roles");
	assert.equal(
		(
			await ambiguous.setup({
				workspaceRoot: ambiguousRoot,
				input: { fastModel: "fast-b", reasonModel: "reason" },
			})
		).result.status,
		"SUCCEEDED",
	);

	const missingRoot = await workspace(context);
	await providerFacts(missingRoot, ["fast"]);
	const missing = createModelRuntimeBehaviorAdapter({
		mapInventory: async () => ({
			status: "MISSING_ROLE",
			role: "reason",
			candidates: [],
		}),
	});
	const failure = await missing.setup({
		workspaceRoot: missingRoot,
		input: { fastModel: "fast", reasonModel: "fast" },
	});
	assert.equal(failure.result.status, "FAILED");
	assert.match(failure.result.error?.message ?? "", /REASON/);
});

test("provider inventory drift makes an existing mapping stale until automatic remap", async (context) => {
	const workspaceRoot = await workspace(context);
	await providerFacts(workspaceRoot);
	let observed = ["fast", "reason"];
	let mappingCalls = 0;
	const adapter = createModelRuntimeBehaviorAdapter({
		mapInventory: async ({ models }) => {
			mappingCalls += 1;
			return decideRoleMapping(
				models.map((model) =>
					evidence(
						model.id,
						model.id.includes("fast") ? "no-thinking" : "thinking",
					),
				),
			);
		},
		observeInventory: async () => observed,
	});
	assert.equal(
		(
			await adapter.setup({
				workspaceRoot,
				input: { fastModel: "fast", reasonModel: "reason" },
			})
		).result.status,
		"SUCCEEDED",
	);
	observed = ["fast-new", "reason-new"];
	const stale = await adapter.status({ workspaceRoot });
	assert.equal(stale.result.data.setupStatus, "BLOCKED");
	assert.equal(stale.result.data.issues?.[0]?.code, "MODEL_MAPPING_STALE");
	await providerFacts(workspaceRoot, observed);
	assert.equal(
		(
			await adapter.setup({
				workspaceRoot,
				input: { fastModel: "fast-new", reasonModel: "reason-new" },
			})
		).result.status,
		"SUCCEEDED",
	);
	assert.equal(mappingCalls, 2);
});

test("wall-clock age alone does not invalidate unchanged capability mapping", async (context) => {
	const workspaceRoot = await workspace(context);
	await providerFacts(workspaceRoot);
	let now = "2026-08-25T00:00:00.000Z";
	let calls = 0;
	const adapter = createModelRuntimeBehaviorAdapter({
		now: () => now,
		mapInventory: async () => {
			calls += 1;
			return decideRoleMapping([
				evidence("fast", "no-thinking"),
				evidence("reason", "thinking"),
			]);
		},
		observeInventory: async () => ["fast", "reason"],
	});
	await adapter.setup({
		workspaceRoot,
		input: { fastModel: "fast", reasonModel: "reason" },
	});
	now = "2026-09-25T00:00:00.000Z";
	const status = await adapter.status({ workspaceRoot });
	assert.equal(status.result.data.setupStatus, "READY");
	assert.equal(
		(
			await adapter.setup({
				workspaceRoot,
				input: { fastModel: "fast", reasonModel: "reason" },
			})
		).result.status,
		"SUCCEEDED",
	);
	assert.equal(calls, 1);
});

test("deployment start runs the real local runtime and publishes an authenticated READY endpoint", async (context) => {
	let fastProbeIncludedImage = false;
	const provider = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request)
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
			model: string;
			messages: unknown;
		};
		if (
			body.model === "fast" &&
			JSON.stringify(body.messages).includes("image_url")
		)
			fastProbeIncludedImage = true;
		const content = JSON.stringify({
			decision: "HEALTHY",
			confidence: 1,
			reasonCode: "ALL_CHECKS_PASS",
			rationale: "all checks pass",
		});
		response.setHeader("content-type", "application/json");
		response.end(
			JSON.stringify({
				choices: [
					{
						message: {
							content:
								body.model === "reason"
									? `<think>bounded</think>${content}`
									: content,
						},
					},
				],
			}),
		);
	});
	await new Promise<void>((resolveListen) =>
		provider.listen(0, "127.0.0.1", resolveListen),
	);
	context.after(() => provider.close());
	const address = provider.address();
	if (!address || typeof address === "string")
		assert.fail("provider missing port");
	const workspaceRoot = await workspace(context);
	await writeModuleSharedFacts({ workspaceRoot }, "model-provider-api", {
		providerBaseUrl: `http://127.0.0.1:${address.port}/v1`,
		models: [{ id: "fast" }, { id: "reason" }],
	});
	const adapter = createModelRuntimeBehaviorAdapter({
		mapInventory: async () =>
			decideRoleMapping([
				evidence("fast", "no-thinking"),
				evidence("reason", "thinking"),
			]),
		observeInventory: async () => ["fast", "reason"],
	});
	assert.equal(
		(
			await adapter.setup({
				workspaceRoot,
				input: { fastModel: "fast", reasonModel: "reason" },
			})
		).result.status,
		"SUCCEEDED",
	);
	assert.equal(
		(await adapter.start({ workspaceRoot })).result.status,
		"SUCCEEDED",
	);
	assert.equal(fastProbeIncludedImage, true);
	const facts = await readModuleSharedFacts({ workspaceRoot }, "model-runtime");
	const token = (
		await readFile(String(facts?.transportCredentialFile), "utf8")
	).trim();
	assert.equal(
		(
			await fetch(`${String(facts?.endpoint)}/ready`, {
				headers: { authorization: `Bearer ${token}` },
			})
		).status,
		200,
	);
	assert.equal(
		(await adapter.status({ workspaceRoot })).result.data.runtimeStatus,
		"RUNNING",
	);
	assert.equal(
		(await adapter.stop({ workspaceRoot })).result.status,
		"SUCCEEDED",
	);
	assert.equal(
		(await adapter.status({ workspaceRoot })).result.data.runtimeStatus,
		"STOPPED",
	);
});

test("provider offline after READY is explicit and never reuses a fake runtime READY", async (context) => {
	const workspaceRoot = await workspace(context);
	await providerFacts(workspaceRoot);
	let online = true;
	const adapter = createModelRuntimeBehaviorAdapter({
		mapInventory: async () =>
			decideRoleMapping([
				evidence("fast", "no-thinking"),
				evidence("reason", "thinking"),
			]),
		observeInventory: async () => {
			if (!online) throw new Error("offline");
			return ["fast", "reason"];
		},
	});
	await adapter.setup({
		workspaceRoot,
		input: { fastModel: "fast", reasonModel: "reason" },
	});
	online = false;
	const status = await adapter.status({ workspaceRoot });
	assert.equal(status.result.data.setupStatus, "READY");
	assert.equal(status.result.data.runtimeStatus, "STOPPED");
	assert.equal(status.result.data.issues?.[0]?.code, "PROVIDER_UNAVAILABLE");
});
