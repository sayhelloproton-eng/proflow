import assert from "node:assert/strict";
import { test } from "node:test";

import {
	moduleOperationResultSchema,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";
import {
	behaviorAdapter,
	createBehaviorAdapter,
} from "../deployment/adapter.ts";
import { descriptor, RESOURCE_IDENTITY } from "../deployment/descriptor.ts";
import { createProviderProbe } from "../src/resource-adapter.ts";

const EXPECTED_LIFECYCLE = [
	"describe",
	"preflight",
	"status",
	"verify",
	"doctor",
] as const;

test("parseModuleDescriptor accepts the frozen external-resource descriptor", () => {
	const parsed = parseModuleDescriptor(descriptor);
	assert.equal(parsed.contract, "module");
	assert.equal(parsed.moduleRef, "model-provider-api");
	assert.equal(parsed.kind, "external-resource");
	assert.equal(parsed.provides[0]?.contractRef, "model.provider.api");
	assert.deepEqual(
		[...parsed.lifecycle.supported].sort(),
		[...EXPECTED_LIFECYCLE].sort(),
	);
	assert.deepEqual(parsed.requires, []);
});

test("resource identity constant matches the frozen registry contract", () => {
	assert.equal(RESOURCE_IDENTITY, "model.provider.api");
});

test("every lifecycle result satisfies the structured result contract", async () => {
	const observations = [
		await behaviorAdapter.describe(),
		await behaviorAdapter.preflight(),
		await behaviorAdapter.status(),
		await behaviorAdapter.verify(),
		await behaviorAdapter.doctor(),
	];
	for (const observation of observations) {
		const parsed = moduleOperationResultSchema.safeParse(observation.result);
		assert.equal(parsed.success, true, "result must match the contract");
		if (parsed.success) {
			assert.equal(parsed.data.moduleRef, descriptor.moduleRef);
			assert.equal(parsed.data.moduleVersion, descriptor.moduleVersion);
		}
	}
});

test("unconfigured adapter reports Module facts while actionable primitives remain blocked", async () => {
	const describe = await behaviorAdapter.describe();
	assert.equal(describe.result.status, "SUCCEEDED");

	const preflight = await behaviorAdapter.preflight();
	assert.equal(preflight.result.status, "ACTION_REQUIRED");

	const status = await behaviorAdapter.status();
	assert.equal(status.result.status, "SUCCEEDED");
	assert.deepEqual(status.result.data, {
		configStatus: "INCOMPLETE",
		missingConfig: ["providerBaseUrl"],
		runtimeStatus: "UNKNOWN",
	});

	const verify = await behaviorAdapter.verify();
	assert.equal(verify.result.status, "ACTION_REQUIRED");

	const doctor = await behaviorAdapter.doctor();
	assert.equal(doctor.result.status, "ACTION_REQUIRED");
});

test("unconfigured verify returns FAIL reachability and auth checks, never a fake pass", async () => {
	const verify = await behaviorAdapter.verify();
	const reachability = verify.result.checks?.find(
		(check) => check.id === "provider-reachability",
	);
	const auth = verify.result.checks?.find(
		(check) => check.id === "provider-auth",
	);
	assert.equal(reachability?.status, "FAIL");
	assert.equal(auth?.status, "FAIL");
	assert.ok(verify.result.actionRequired !== undefined);
});

test("configured adapter delegates capability verification to Model Domain", async () => {
	const configured = createBehaviorAdapter({
		probeProvider: async () => ({
			reachable: true,
			authenticated: true,
			message: "provider API reachable and credential accepted",
		}),
		verifyCapabilities: async () => ({
			ok: true,
			message: "capabilities verified",
		}),
	});
	const verify = await configured.verify();
	assert.equal(verify.result.status, "SUCCEEDED");
	assert.equal(
		verify.result.checks?.some(
			(check) =>
				check.id === "provider-capabilities" && check.status === "PASS",
		),
		true,
	);

	const reachableOnly = createBehaviorAdapter({
		probeProvider: async () => ({
			reachable: true,
			authenticated: true,
			message: "provider API reachable and credential accepted",
		}),
	});
	const verifyWithoutCapabilities = await reachableOnly.verify();
	assert.equal(verifyWithoutCapabilities.result.status, "SUCCEEDED");
	assert.deepEqual(
		verifyWithoutCapabilities.result.checks?.map((check) => check.id),
		["provider-reachability", "provider-auth"],
	);
	assert.deepEqual(verifyWithoutCapabilities.result.data, {
		capabilityVerificationOwner: "model-runtime",
	});
});

test("adapter exposes no start, stop, or restart lifecycle", () => {
	for (const forbidden of ["start", "stop", "restart"]) {
		assert.ok(!(forbidden in behaviorAdapter), `${forbidden} must not exist`);
	}
	assert.deepEqual(
		Object.keys(behaviorAdapter).sort(),
		[...EXPECTED_LIFECYCLE].sort(),
	);
});

test("descriptor declares no process lifecycle primitives", () => {
	const supported = descriptor.lifecycle.supported as readonly string[];
	for (const forbidden of ["start", "stop", "restart"]) {
		assert.ok(
			!supported.includes(forbidden),
			`${forbidden} must not be declared`,
		);
	}
});

test("low-level probe is honest about an unreachable provider", async () => {
	const probe = createProviderProbe({ baseUrl: "http://127.0.0.1:1" });
	const result = await probe();
	assert.equal(result.reachable, false);
	assert.equal(result.authenticated, false);
});

test("providerCredential is optional (unauthenticated providers allowed)", () => {
	const credential = descriptor.configSlots.find(
		(slot) => slot.key === "providerCredential",
	);
	assert.equal(credential?.required, false);
});
