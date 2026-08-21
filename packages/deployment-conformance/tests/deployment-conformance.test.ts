import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type TestContext, test } from "node:test";
import { promisify } from "node:util";

import {
	type ModuleDescriptor,
	type ModuleOperationResult,
	standardModuleManagementCommands,
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

const execFileAsync = promisify(execFile);
const tsc = resolve(
	import.meta.dirname,
	"../../../node_modules/typescript/bin/tsc",
);

const repositoryRoot = resolve(import.meta.dirname, "../../..");

async function generatedRoot(prefix: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), prefix));
	await symlink(
		join(repositoryRoot, "node_modules"),
		join(root, "node_modules"),
		"dir",
	);
	return root;
}

function result(
	moduleRef: string,
	moduleVersion: string,
	data?: unknown,
): ModuleOperationResult<unknown> {
	return {
		contract: "deployment.result.v1",
		ok: true,
		status: "SUCCEEDED",
		moduleRef,
		moduleVersion,
		...(data === undefined ? {} : { data }),
		checks: [{ id: "contract-check", status: "PASS", message: "observed" }],
	};
}

function adapterFor(descriptor: ModuleDescriptor): BehaviorAdapter {
	const adapter: BehaviorAdapter = {};
	for (const command of standardModuleManagementCommands) {
		adapter[command] = (): BehaviorObservation => ({
			result: result(
				descriptor.moduleRef,
				descriptor.moduleVersion,
				command === "status"
					? { setupStatus: "READY", runtimeStatus: "NOT_APPLICABLE" }
					: undefined,
			),
			observedEffects: [],
			...(command === "status" && descriptor.kind === "external-resource"
				? {
						externalAvailabilityClaim: "UNKNOWN" as const,
						externalAvailabilityEvidence: "fake" as const,
					}
				: {}),
		});
	}
	return adapter;
}

async function generatedExternal(context: TestContext) {
	const root = await generatedRoot("proflow-conformance-");
	context.after(() => rm(root, { recursive: true, force: true }));
	const generated = await materializeModule({
		targetDirectory: root,
		moduleRef: "fixture-external-resource",
		packageName: "@tomflow/proflow-fixture-external-resource",
		kind: "external-resource",
		domain: "deployment-governance",
		summary: "Generated test fixture",
	});
	await execFileAsync(process.execPath, [
		tsc,
		"-p",
		join(generated.packageDirectory, "tsconfig.build.json"),
	]);
	return generated;
}

async function generatedCli(context: TestContext) {
	const root = await generatedRoot("proflow-conformance-cli-");
	context.after(() => rm(root, { recursive: true, force: true }));
	const generated = await materializeModule({
		targetDirectory: root,
		moduleRef: "fixture-cli",
		packageName: "@tomflow/proflow-fixture-cli",
		kind: "cli",
		domain: "deployment-governance",
		summary: "Generated CLI test fixture",
	});
	await execFileAsync(process.execPath, [
		tsc,
		"-p",
		join(generated.packageDirectory, "tsconfig.build.json"),
	]);
	return generated;
}

test("CP-DPL-CONF-01 C1 rejects missing, version, config, lifecycle, and verification defects", async (context) => {
	const generated = await generatedExternal(context);
	assert.equal(runStaticConformance(generated.descriptor).status, "PASS");
	const broken: unknown[] = [
		{ ...generated.descriptor, moduleRef: undefined },
		{ ...generated.descriptor, moduleVersion: "not-semver" },
		{ ...generated.descriptor, platformCompatibility: "latest" },
		{
			...generated.descriptor,
			provides: [
				{ contractRef: "fixture.public", version: "1.0.0" },
				{ contractRef: "fixture.public", version: "1.0.0" },
			],
		},
		{
			...generated.descriptor,
			provides: [{ contractRef: "fixture.public", version: "1.0.0" }],
			requires: [
				{ contractRef: "fixture.public", versionRange: ">=1.0.0 <2.0.0" },
			],
		},
		{
			...generated.descriptor,
			requires: [{ contractRef: "fixture.public", versionRange: "compatible" }],
		},
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
		{
			...generated.descriptor,
			kind: "service",
			lifecycle: { supported: ["status", "verify"] },
		},
		{ ...generated.descriptor, verification: { checks: [] } },
	];
	for (const fixture of broken)
		assert.equal(runStaticConformance(fixture).status, "FAIL");
});

test("CP-DPL-CONF-02 + CP-DPL-CONF-05 + RF-DPL-CONF-05 C2 inspects package form and generated truth", async (context) => {
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
	let result = await runPackageConformance(
		generated.packageDirectory,
		generated.descriptor,
	);
	assert.ok(
		result.issues.some((issue) => issue.code === "PACKAGE_VERSION_MISMATCH"),
	);
	await writeFile(
		packagePath,
		`${JSON.stringify({ ...original, exports: { ".": "./src/missing.ts" } }, null, 2)}\n`,
	);
	result = await runPackageConformance(
		generated.packageDirectory,
		generated.descriptor,
	);
	assert.ok(
		result.issues.some((issue) => issue.code === "PACKAGE_ENTRY_INVALID"),
	);
	await writeFile(
		packagePath,
		`${JSON.stringify({ ...original, config: { apiToken: "plaintext" } }, null, 2)}\n`,
	);
	result = await runPackageConformance(
		generated.packageDirectory,
		generated.descriptor,
	);
	assert.ok(
		result.issues.some((issue) => issue.code === "PACKAGE_SECRET_LEAK"),
	);

	await writeFile(packagePath, `${JSON.stringify(original, null, 2)}\n`);
	const conformancePath = join(generated.packageDirectory, "conformance.json");
	const conformance = JSON.parse(
		await readFile(conformancePath, "utf8"),
	) as Record<string, unknown>;
	await writeFile(
		conformancePath,
		`${JSON.stringify({ ...conformance, generatedArtifact: { source: "unknown" } }, null, 2)}\n`,
	);
	result = await runPackageConformance(
		generated.packageDirectory,
		generated.descriptor,
	);
	assert.ok(
		result.issues.some(
			(issue) => issue.code === "GENERATED_TRUTH_SOURCE_INVALID",
		),
	);

	await writeFile(conformancePath, `${JSON.stringify(conformance, null, 2)}\n`);
	const setupPath = join(generated.packageDirectory, "SETUP.md");
	const setupOriginal = await readFile(setupPath, "utf8");
	await writeFile(
		setupPath,
		"# Setup\n\nPlease configure this module and retry.\n\nCompletion: setupStatus=READY\n",
	);
	result = await runPackageConformance(
		generated.packageDirectory,
		generated.descriptor,
	);
	assert.ok(
		result.issues.some((issue) => issue.code === "SETUP_GUIDE_NOT_EXECUTABLE"),
	);
	await writeFile(setupPath, setupOriginal);
});

test("C2 accepts a typed runCli outcome and rejects non-object output", async (context) => {
	const generated = await generatedCli(context);
	const cliPath = join(generated.packageDirectory, "dist/src/cli.js");
	await writeFile(
		cliPath,
		'export async function runCli() { return { command: "help", status: "SUCCEEDED", data: { usage: "fixture" } }; }\n',
	);
	let result = await runPackageConformance(
		generated.packageDirectory,
		generated.descriptor,
	);
	assert.equal(result.status, "PASS");

	await writeFile(cliPath, "export async function runCli() { return []; }\n");
	result = await runPackageConformance(
		generated.packageDirectory,
		generated.descriptor,
	);
	assert.ok(
		result.issues.some((issue) => issue.code === "MACHINE_RESULT_INVALID"),
	);
});

test("CP-DPL-CONF-03 C3 rejects side effects and fake external availability without invoking undeclared lifecycle", async (context) => {
	const generated = await generatedExternal(context);
	let undeclaredCalls = 0;
	const legal = adapterFor(generated.descriptor) as BehaviorAdapter & {
		verify?: () => BehaviorObservation;
	};
	legal.verify = () => {
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
		readinessClaim: "READY",
		readinessEvidence: "fake",
	});
	assert.equal(
		(await runBehaviorConformance(generated.descriptor, fakeReady)).status,
		"FAIL",
	);

	const mutatingInstall = adapterFor(generated.descriptor);
	mutatingInstall.install = () => ({
		result: result(
			generated.descriptor.moduleRef,
			generated.descriptor.moduleVersion,
		),
		observedEffects: ["wrote config"],
	});
	assert.equal(
		(await runBehaviorConformance(generated.descriptor, mutatingInstall))
			.status,
		"FAIL",
	);

	const actionRequired = adapterFor(generated.descriptor);
	actionRequired.status = () => ({
		result: result(
			generated.descriptor.moduleRef,
			generated.descriptor.moduleVersion,
			{
				setupStatus: "ACTION_REQUIRED",
				runtimeStatus: "NOT_APPLICABLE",
			},
		),
		observedEffects: [],
		externalAvailabilityClaim: "UNKNOWN",
		externalAvailabilityEvidence: "fake",
	});
	actionRequired.setup = () => ({
		result: {
			contract: "deployment.result.v1",
			ok: false,
			status: "ACTION_REQUIRED",
			moduleRef: generated.descriptor.moduleRef,
			moduleVersion: generated.descriptor.moduleVersion,
			actionRequired: {
				action: "authenticate",
				description: "Authenticate the external resource",
			},
		},
		observedEffects: [],
	});
	assert.equal(
		(await runBehaviorConformance(generated.descriptor, actionRequired)).status,
		"PASS",
	);
	const unrecoverable = adapterFor(generated.descriptor);
	unrecoverable.status = () => ({
		result: {
			contract: "deployment.result.v1",
			ok: false,
			status: "ACTION_REQUIRED",
			moduleRef: generated.descriptor.moduleRef,
			moduleVersion: generated.descriptor.moduleVersion,
		},
		observedEffects: [],
	});
	assert.equal(
		(await runBehaviorConformance(generated.descriptor, unrecoverable)).status,
		"FAIL",
	);
});

test("remediation C3 rejects result identity drift and effects outside the descriptor", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-c3-remediation-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const generated = await materializeModule({
		targetDirectory: root,
		moduleRef: "identity-service",
		packageName: "@tomflow/proflow-identity-service",
		kind: "service",
		domain: "deployment-governance",
		summary: "Generated test fixture",
	});
	const descriptor = generated.descriptor;
	const base = {
		contract: "deployment.result.v1" as const,
		ok: true,
		status: "SUCCEEDED" as const,
		moduleRef: descriptor.moduleRef,
		moduleVersion: descriptor.moduleVersion,
	};
	for (const result of [
		{ ...base, moduleRef: "wrong-module" },
		{ ...base, moduleVersion: "9.9.9" },
	]) {
		const adapter = Object.fromEntries(
			standardModuleManagementCommands.map((primitive) => [
				primitive,
				() => ({ result, observedEffects: [] }),
			]),
		);
		assert.equal(
			(await runBehaviorConformance(descriptor, adapter)).status,
			"FAIL",
		);
	}
	const adapter = Object.fromEntries(
		standardModuleManagementCommands.map((primitive) => [
			primitive,
			() => ({
				result:
					primitive === "status"
						? {
								...base,
								data: { setupStatus: "READY", runtimeStatus: "STOPPED" },
							}
						: base,
				observedEffects: primitive === "start" ? ["undeclared effect"] : [],
			}),
		]),
	);
	assert.equal(
		(await runBehaviorConformance(descriptor, adapter)).status,
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
					redirectUrls: [],
					filename: "input.txt",
					declaredMime: "text/plain",
					detectedMime: "text/plain",
				},
			],
			openAiFileIdRefs: [{ name: "input.txt", id: "file-123" }],
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
				inputFiles: [
					{
						...inputFile,
						redirectUrls: [
							"https://files.example.com/redirect",
							"http://169.254.169.254/metadata",
						],
					},
				],
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
	assert.equal(
		runGptActionsConformance({ operations: "invalid" }).status,
		"FAIL",
	);
	assert.equal(
		runGptActionsConformance({ operations: [], fileBridge: {} }).status,
		"FAIL",
	);
});
