import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	moduleOperationResultSchema,
	parseModuleDescriptor,
	readModuleSharedFacts,
} from "@tomflow/proflow-module-contract";
import {
	behaviorAdapter,
	createProviderBehaviorAdapter,
} from "../deployment/adapter.ts";
import { descriptor } from "../deployment/descriptor.ts";
import type { ProviderProbeResult } from "../src/resource-adapter.ts";

async function workspace(
	context: { after(fn: () => unknown): void },
	prefix: string,
) {
	const root = await mkdtemp(join(tmpdir(), prefix));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

async function snapshotFiles(root: string) {
	const snapshot: Record<string, { content: string; mtimeMs: number }> = {};
	const visit = async (directory: string, prefix = "") => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const relative = prefix ? join(prefix, entry.name) : entry.name;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				await visit(path, relative);
				continue;
			}
			if (!entry.isFile()) continue;
			snapshot[relative] = {
				content: (await readFile(path)).toString("base64"),
				mtimeMs: (await stat(path)).mtimeMs,
			};
		}
	};
	await visit(root);
	return snapshot;
}

const ready = (
	baseUrl: string,
	models = ["fast", "reason"],
): ProviderProbeResult => ({
	status: "READY",
	baseUrl,
	models: models.map((id) => ({ id, object: "model" })),
	reachable: true,
	authenticated: true,
	message: "provider OpenAI-compatible inventory verified",
});

test("descriptor exposes only a generic provider URL and optional credential reference", () => {
	const parsed = parseModuleDescriptor(descriptor);
	assert.equal(parsed.moduleRef, "model-provider-api");
	assert.equal(parsed.kind, "external-resource");
	assert.equal(parsed.provides[0]?.contractRef, "model.provider.api");
	assert.deepEqual(parsed.requires, []);
	assert.equal("lifecycle" in parsed, false);
	const keys = parsed.configSlots.map((slot) => slot.key).sort();
	assert.deepEqual(keys, ["providerBaseUrl", "providerCredentialFile"]);
	assert.doesNotMatch(
		JSON.stringify(parsed),
		/providerIdentity|serviceType|hostname|providerInstance|discovery/i,
	);
});

test("all seven management command results satisfy the structured result contract", async (context) => {
	const workspaceRoot = await workspace(context, "proflow-provider-contract-");
	const adapter = createProviderBehaviorAdapter();
	const observations = [
		await adapter.install({ workspaceRoot }),
		await adapter.uninstall({ workspaceRoot }),
		await adapter.status({ workspaceRoot }),
		await adapter.setup({ workspaceRoot }),
		await adapter.docs({ workspaceRoot }),
		await adapter.start({ workspaceRoot }),
		await adapter.stop({ workspaceRoot }),
	];
	for (const observation of observations)
		assert.equal(
			moduleOperationResultSchema.safeParse(observation.result).success,
			true,
		);
});

test("missing URL is generic endpoint-required and never starts device discovery", async (context) => {
	const workspaceRoot = await workspace(context, "proflow-provider-missing-");
	const adapter = createProviderBehaviorAdapter();
	const status = await adapter.status({ workspaceRoot });
	assert.equal(status.result.data.setupStatus, "ACTION_REQUIRED");
	assert.equal(status.result.data.runtimeStatus, "NOT_APPLICABLE");
	assert.equal(
		status.result.data.issues?.[0]?.code,
		"PROVIDER_ENDPOINT_REQUIRED",
	);
	const setup = await adapter.setup({ workspaceRoot });
	assert.equal(setup.result.status, "ACTION_REQUIRED");
	assert.equal(
		setup.result.actionRequired?.action,
		"provide-provider-endpoint",
	);
	assert.doesNotMatch(
		JSON.stringify(setup),
		/providerIdentity|serviceType|hostname|providerInstance|discover/i,
	);
});

test("generic URL is probed and only validated provider facts are published", async (context) => {
	const workspaceRoot = await workspace(context, "proflow-provider-ready-");
	const adapter = createProviderBehaviorAdapter({
		probe: async ({ baseUrl }) =>
			ready(`${baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "")}/v1`),
	});
	const setup = await adapter.setup({
		workspaceRoot,
		input: { providerBaseUrl: "https://provider.example" },
	});
	assert.equal(setup.result.status, "SUCCEEDED");
	assert.deepEqual((await adapter.status({ workspaceRoot })).result.data, {
		setupStatus: "READY",
		runtimeStatus: "NOT_APPLICABLE",
	});
	const facts = await readModuleSharedFacts(
		{ workspaceRoot },
		"model-provider-api",
	);
	assert.equal(facts?.providerBaseUrl, "https://provider.example/v1");
	assert.deepEqual(facts?.models, [
		{ id: "fast", object: "model" },
		{ id: "reason", object: "model" },
	]);
	assert.equal("providerIdentity" in (facts ?? {}), false);
	assert.equal("providerCredential" in (facts ?? {}), false);
});

test("status re-probes Provider reality without mutating persisted state", async (context) => {
	const workspaceRoot = await workspace(
		context,
		"proflow-provider-status-readonly-",
	);
	let clock = 0;
	const timestamps = [
		"2026-08-28T00:00:00.000Z",
		"2026-08-28T00:00:01.000Z",
		"2026-08-28T00:00:02.000Z",
	];
	const adapter = createProviderBehaviorAdapter({
		now: () => timestamps[Math.min(clock++, timestamps.length - 1)] as string,
		probe: async ({ baseUrl }) =>
			ready(`${baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "")}/v1`),
	});
	assert.equal(
		(
			await adapter.setup({
				workspaceRoot,
				input: { providerBaseUrl: "https://provider.example" },
			})
		).result.status,
		"SUCCEEDED",
	);
	const proflowRoot = join(workspaceRoot, ".proflow");
	const before = await snapshotFiles(proflowRoot);
	for (let index = 0; index < 2; index += 1)
		assert.deepEqual((await adapter.status({ workspaceRoot })).result.data, {
			setupStatus: "READY",
			runtimeStatus: "NOT_APPLICABLE",
		});
	assert.deepEqual(await snapshotFiles(proflowRoot), before);
});

test("saved URL is re-probed and unreachable reality never re-discovers a device", async (context) => {
	const workspaceRoot = await workspace(context, "proflow-provider-reprobe-");
	let reachable = true;
	let probes = 0;
	const adapter = createProviderBehaviorAdapter({
		probe: async ({ baseUrl }) => {
			probes += 1;
			return reachable
				? ready(`${baseUrl.replace(/\/v1$/, "")}/v1`)
				: {
						status: "UNREACHABLE",
						reachable: false,
						authenticated: false,
						message: "provider API request failed",
					};
		},
	});
	await adapter.setup({
		workspaceRoot,
		input: { providerBaseUrl: "https://provider.example" },
	});
	reachable = false;
	const status = await adapter.status({ workspaceRoot });
	assert.equal(status.result.data.setupStatus, "ACTION_REQUIRED");
	assert.equal(status.result.data.issues?.[0]?.code, "PROVIDER_UNREACHABLE");
	assert.equal(probes, 2);
	assert.doesNotMatch(
		JSON.stringify(status),
		/providerIdentity|serviceType|hostname|providerInstance/i,
	);
});

test("credential is stored owner-only and shared facts contain only its file reference", async (context) => {
	const workspaceRoot = await workspace(context, "proflow-provider-secret-");
	const secret = "GENERIC_PROVIDER_SECRET";
	const adapter = createProviderBehaviorAdapter({
		probe: async ({ baseUrl, credential }) => {
			assert.equal(credential, secret);
			return ready(`${baseUrl.replace(/\/$/, "")}/v1`);
		},
	});
	const setup = await adapter.setup({
		workspaceRoot,
		input: {
			providerBaseUrl: "https://provider.example",
			providerCredential: secret,
		},
	});
	assert.equal(setup.result.status, "SUCCEEDED");
	const facts = await readModuleSharedFacts(
		{ workspaceRoot },
		"model-provider-api",
	);
	assert.doesNotMatch(JSON.stringify(facts), new RegExp(secret));
	const path = String(facts?.providerCredentialFile);
	assert.equal((await readFile(path, "utf8")).trim(), secret);
	if (process.platform !== "win32")
		assert.equal((await stat(path)).mode & 0o077, 0);
	if (process.platform !== "win32") {
		await chmod(path, 0o644);
		const hardened = createProviderBehaviorAdapter({
			probe: async ({ baseUrl, credential }) =>
				credential
					? ready(baseUrl)
					: {
							status: "AUTH_REQUIRED",
							reachable: true,
							authenticated: false,
							message: "provider requires authentication",
						},
		});
		const unsafe = await hardened.status({ workspaceRoot });
		assert.equal(unsafe.result.data.setupStatus, "ACTION_REQUIRED");
		assert.equal(
			unsafe.result.data.issues?.[0]?.code,
			"PROVIDER_AUTH_REQUIRED",
		);
		assert.equal(
			(
				await hardened.setup({
					workspaceRoot,
					input: { providerCredential: secret },
				})
			).result.status,
			"SUCCEEDED",
		);
		assert.equal((await stat(path)).mode & 0o077, 0);
	}
});

test("invalid protocol and auth-required endpoint never become fake READY", async (context) => {
	const invalidRoot = await workspace(context, "proflow-provider-invalid-");
	const invalid = createProviderBehaviorAdapter({
		probe: async () => ({
			status: "PROTOCOL_INVALID",
			reachable: true,
			authenticated: false,
			message: "invalid protocol",
		}),
	});
	const invalidSetup = await invalid.setup({
		workspaceRoot: invalidRoot,
		input: { providerBaseUrl: "https://provider.example" },
	});
	assert.equal(invalidSetup.result.status, "FAILED");

	const authRoot = await workspace(context, "proflow-provider-auth-");
	const auth = createProviderBehaviorAdapter({
		probe: async () => ({
			status: "AUTH_REQUIRED",
			reachable: true,
			authenticated: false,
			message: "provider API requires authentication",
		}),
	});
	const result = await auth.setup({
		workspaceRoot: authRoot,
		input: { providerBaseUrl: "https://provider.example" },
	});
	assert.equal(result.result.status, "ACTION_REQUIRED");
	assert.equal(
		result.result.actionRequired?.action,
		"provide-provider-credential",
	);
	assert.doesNotMatch(JSON.stringify(result), /Bearer|token=/i);
});

test("adapter exposes exactly the fixed seven management commands", () => {
	assert.deepEqual(Object.keys(behaviorAdapter).sort(), [
		"docs",
		"install",
		"setup",
		"start",
		"status",
		"stop",
		"uninstall",
	]);
});

test("provider public contract contains no implementation-specific discovery identity", () => {
	assert.doesNotMatch(
		JSON.stringify(descriptor),
		/providerIdentity|serviceType|hostname|providerInstance|discovery/i,
	);
});
