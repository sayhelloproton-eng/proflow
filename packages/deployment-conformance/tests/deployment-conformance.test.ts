import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";

import type {
	ModuleDescriptor,
	ModuleOperationResult,
} from "@tomflow/proflow-module-contract";
import { materializeModule } from "@tomflow/proflow-module-template";
import {
	type BehaviorAdapter,
	type BehaviorObservation,
	type GptActionsConformanceInput,
	runBehaviorConformance,
	runGptActionsConformance,
	runPackageConformance,
	runStaticConformance,
} from "../src/index.ts";

function result(
	moduleRef: string,
	moduleVersion: string,
): ModuleOperationResult<unknown> {
	return {
		contract: "deployment.result.v1",
		ok: true,
		status: "SUCCEEDED",
		moduleRef,
		moduleVersion,
		checks: [{ id: "contract-check", status: "PASS", message: "observed" }],
	};
}

function adapterFor(descriptor: ModuleDescriptor): BehaviorAdapter {
	const adapter: BehaviorAdapter = {};
	for (const primitive of descriptor.lifecycle.supported) {
		adapter[primitive] = (): BehaviorObservation => ({
			result: result(descriptor.moduleRef, descriptor.moduleVersion),
			observedEffects: [],
			...(primitive === "status" && descriptor.kind === "external-resource"
				? {
						externalAvailabilityClaim: "UNKNOWN",
						externalAvailabilityEvidence: "fake",
					}
				: {}),
		});
	}
	return adapter;
}

async function generatedExternal(context: TestContext) {
	const root = await mkdtemp(join(tmpdir(), "proflow-conformance-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	return materializeModule({
		targetDirectory: root,
		moduleRef: "fixture-external-resource",
		packageName: "@tomflow/fixture-external-resource",
		kind: "external-resource",
	});
}

test("CP-DPL-CONF-01 C1 rejects missing, version, config, lifecycle, and verification defects", async (context) => {
	const generated = await generatedExternal(context);
	assert.equal(runStaticConformance(generated.descriptor).status, "PASS");
	const broken: unknown[] = [
		{ ...generated.descriptor, moduleRef: undefined },
		{ ...generated.descriptor, moduleVersion: "not-semver" },
		{
			...generated.descriptor,
			configSlots: [
				{
					key: "secret",
					type: "secretRef",
					required: true,
					description: "secret",
					sensitive: false,
				},
			],
		},
		{
			...generated.descriptor,
			kind: "library",
			lifecycle: { supported: ["describe", "start"] },
		},
		{ ...generated.descriptor, verification: { checks: [] } },
	];
	for (const fixture of broken)
		assert.equal(runStaticConformance(fixture).status, "FAIL");
});

test("CP-DPL-CONF-02 C2 inspects real package metadata, exports, entry, and version", async (context) => {
	const generated = await generatedExternal(context);
	assert.equal(
		(
			await runPackageConformance(
				generated.packageDirectory,
				generated.descriptor,
			)
		).status,
		"PASS",
	);
	const packagePath = join(generated.packageDirectory, "package.json");
	const original = JSON.parse(await readFile(packagePath, "utf8")) as Record<
		string,
		unknown
	>;
	await writeFile(
		packagePath,
		`${JSON.stringify({ ...original, version: "9.9.9" }, null, 2)}\n`,
	);
	assert.equal(
		(
			await runPackageConformance(
				generated.packageDirectory,
				generated.descriptor,
			)
		).status,
		"FAIL",
	);
	await writeFile(
		packagePath,
		`${JSON.stringify({ ...original, exports: { ".": "./src/missing.ts" } }, null, 2)}\n`,
	);
	assert.equal(
		(
			await runPackageConformance(
				generated.packageDirectory,
				generated.descriptor,
			)
		).status,
		"FAIL",
	);
});

test("CP-DPL-CONF-03 C3 rejects side effects and fake external availability without invoking undeclared lifecycle", async (context) => {
	const generated = await generatedExternal(context);
	let undeclaredCalls = 0;
	const legal = adapterFor(generated.descriptor);
	legal.start = () => {
		undeclaredCalls += 1;
		return {
			result: result(
				generated.descriptor.moduleRef,
				generated.descriptor.moduleVersion,
			),
			observedEffects: [],
		};
	};
	assert.equal(
		(await runBehaviorConformance(generated.descriptor, legal)).status,
		"PASS",
	);
	assert.equal(undeclaredCalls, 0);

	const fakeReady = adapterFor(generated.descriptor);
	fakeReady.status = () => ({
		result: result(
			generated.descriptor.moduleRef,
			generated.descriptor.moduleVersion,
		),
		observedEffects: [],
		externalAvailabilityClaim: "AVAILABLE",
		externalAvailabilityEvidence: "fake",
	});
	assert.equal(
		(await runBehaviorConformance(generated.descriptor, fakeReady)).status,
		"FAIL",
	);

	const mutatingDoctor = adapterFor(generated.descriptor);
	mutatingDoctor.doctor = () => ({
		result: result(
			generated.descriptor.moduleRef,
			generated.descriptor.moduleVersion,
		),
		observedEffects: ["wrote config"],
	});
	assert.equal(
		(await runBehaviorConformance(generated.descriptor, mutatingDoctor)).status,
		"FAIL",
	);
});

function validGptProfile(): GptActionsConformanceInput {
	return {
		usesActions: true,
		usesAppsAsP0: false,
		operations: [
			{
				operationId: "worker_create_task",
				role: "worker",
				consequential: true,
				customHeaders: [],
				summary: "Create task",
				description: "Create a bounded task through the owning API",
				parameters: [{ name: "input", description: "Validated task input" }],
				acceptsOpenAiFileIdRefs: true,
				responseSupportsOpenAiFileResponse: true,
			},
		],
		fileBridge: {
			maxInputFiles: 10,
			maxInputFileBytes: 10_000_000,
			maxAggregateInputBytes: 50_000_000,
			inputFetchTimeoutMs: 15_000,
			relayTtlMs: 300_000,
			maxBlockingMs: 45_000,
			requestSerializedCharacters: 99_999,
			responseSerializedCharacters: 99_999,
			inlineResponseSerializedCharacters: 100_000,
			responseMode: "relay",
			inputFiles: [
				{
					size: 1_000,
					url: "https://files.example.com/input.txt",
					filename: "input.txt",
					declaredMime: "text/plain",
					detectedMime: "text/plain",
				},
			],
			responseFiles: [{ size: 1_000, mimeType: "text/plain" }],
			downloadLinkPersisted: false,
			preservesHttpErrorStatus: true,
			blindReplayAfterEffect: false,
			relay: {
				methods: ["GET"],
				opaqueToken: true,
				scope: "artifact",
				ttlMs: 300_000,
				contentType: "text/plain",
				contentDisposition: "attachment; filename=output.txt",
			},
			typedErrors: [
				"OPENAI_FILE_INVALID",
				"OPENAI_FILE_COUNT_EXCEEDED",
				"OPENAI_FILE_SIZE_EXCEEDED",
				"OPENAI_FILE_AGGREGATE_SIZE_EXCEEDED",
				"OPENAI_FILE_LOCATOR_EXPIRED",
				"OPENAI_FILE_FETCH_TIMEOUT",
				"OPENAI_FILE_FETCH_FAILED",
				"OPENAI_FILE_MIME_MISMATCH",
				"OPENAI_FILE_UNSUPPORTED_MEDIA",
				"OPENAI_ACTION_REQUEST_BUDGET_EXCEEDED",
				"OPENAI_ACTION_RESPONSE_BUDGET_EXCEEDED",
				"OPENAI_RELAY_EXPIRED",
				"OPENAI_RELAY_SCOPE_INVALID",
			],
		},
	};
}

test("CP-DPL-CONF-04 enforces GPT Actions and File Bridge frozen limits", () => {
	const valid = validGptProfile();
	assert.equal(runGptActionsConformance(valid).status, "PASS");
	const operation = valid.operations[0];
	const inputFile = valid.fileBridge.inputFiles[0];
	assert.ok(operation);
	assert.ok(inputFile);
	const {
		consequential: omittedConsequential,
		...operationWithoutConsequential
	} = operation;
	void omittedConsequential;
	const broken: GptActionsConformanceInput[] = [
		{ ...valid, operations: [operationWithoutConsequential] },
		{ ...valid, usesAppsAsP0: true },
		{ ...valid, fileBridge: { ...valid.fileBridge, maxBlockingMs: 45_001 } },
		{
			...valid,
			fileBridge: { ...valid.fileBridge, requestSerializedCharacters: 100_000 },
		},
		{ ...valid, fileBridge: { ...valid.fileBridge, responseMode: "inline" } },
		{ ...valid, fileBridge: { ...valid.fileBridge, maxInputFiles: 11 } },
		{
			...valid,
			fileBridge: { ...valid.fileBridge, maxInputFileBytes: 10_000_001 },
		},
		{
			...valid,
			fileBridge: { ...valid.fileBridge, maxAggregateInputBytes: 50_000_001 },
		},
		{
			...valid,
			fileBridge: { ...valid.fileBridge, inputFetchTimeoutMs: 15_001 },
		},
		{ ...valid, fileBridge: { ...valid.fileBridge, relayTtlMs: 300_001 } },
		{
			...valid,
			fileBridge: {
				...valid.fileBridge,
				inputFiles: [{ ...inputFile, url: "http://127.0.0.1/secret" }],
			},
		},
		{
			...valid,
			fileBridge: {
				...valid.fileBridge,
				responseFiles: [{ size: 1_000, mimeType: "image/png" }],
			},
		},
		{
			...valid,
			fileBridge: {
				...valid.fileBridge,
				relay: { ...valid.fileBridge.relay, contentType: "" },
			},
		},
		{
			...valid,
			fileBridge: {
				...valid.fileBridge,
				relay: { ...valid.fileBridge.relay, opaqueToken: false },
			},
		},
		{
			...valid,
			fileBridge: {
				...valid.fileBridge,
				relay: { ...valid.fileBridge.relay, scope: "global" },
			},
		},
		{
			...valid,
			fileBridge: {
				...valid.fileBridge,
				typedErrors: valid.fileBridge.typedErrors.slice(1),
			},
		},
	];
	for (const fixture of broken)
		assert.equal(runGptActionsConformance(fixture).status, "FAIL");
});
