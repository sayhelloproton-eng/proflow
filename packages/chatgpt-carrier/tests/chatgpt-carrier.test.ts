import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseModuleDescriptor } from "@tomflow/proflow-module-contract";
import {
	behaviorAdapter,
	createBehaviorAdapter,
	createProductionBinding,
} from "../deployment/adapter.ts";
import { descriptor } from "../deployment/descriptor.ts";

test("parseModuleDescriptor accepts the chatgpt-carrier descriptor", () => {
	const parsed = parseModuleDescriptor(descriptor);
	assert.equal(parsed.moduleRef, "chatgpt-carrier");
	assert.equal(parsed.kind, "external-resource");
	assert.deepEqual(parsed.provides, []);
	assert.equal(parsed.lifecycle.supported.includes("start"), false);
});

test("adapter reports ACTION_REQUIRED instead of SUCCEEDED without a real carrier", async () => {
	const preflight = await behaviorAdapter.preflight();
	assert.equal(preflight.result.status, "ACTION_REQUIRED");
	assert.equal(preflight.result.ok, false);

	const status = await behaviorAdapter.status();
	assert.equal(status.result.status, "ACTION_REQUIRED");
	assert.equal(status.result.ok, false);
	assert.ok(status.result.actionRequired !== undefined);
	assert.equal(status.readinessClaim, "NOT_READY");
	assert.equal(status.externalAvailabilityClaim, "UNKNOWN");

	const verify = await behaviorAdapter.verify();
	assert.equal(verify.result.status, "ACTION_REQUIRED");
	assert.equal(verify.result.ok, false);
	assert.ok(verify.result.actionRequired !== undefined);
});

test("external-resource adapter exposes no start/stop/restart", () => {
	const primitives = new Set(Object.keys(behaviorAdapter));
	assert.equal(primitives.has("start"), false);
	assert.equal(primitives.has("stop"), false);
	assert.equal(primitives.has("restart"), false);
	assert.deepEqual([...primitives].sort(), [
		"describe",
		"doctor",
		"preflight",
		"status",
		"verify",
	]);
});

test("reachability alone never passes schema/auth checks", async () => {
	const adapter = createBehaviorAdapter({
		observeVerification: async () => ({
			reachable: "VERIFIED",
			actionsEnabled: "UNVERIFIED",
			openApiInstalled: "UNVERIFIED",
			actionAuthValid: "UNVERIFIED",
			fileBridge: "UNVERIFIED",
			codeInterpreter: "UNVERIFIED",
			webSearch: "UNVERIFIED",
			appsDisabledWhenRequired: "UNVERIFIED",
		}),
	});
	const verify = await adapter.verify();
	assert.equal(verify.result.status, "ACTION_REQUIRED");
	const reachableCheck = verify.result.checks?.find(
		(check) => check.id === "carrier-role-reachable",
	);
	const authCheck = verify.result.checks?.find(
		(check) => check.id === "carrier-auth",
	);
	assert.equal(reachableCheck?.status, "PASS");
	assert.notEqual(authCheck?.status, "PASS");
});

test("preflight can SUCCEED when all required checks are VERIFIED", async () => {
	const adapter = createBehaviorAdapter({
		observeVerification: async () => ({
			reachable: "VERIFIED",
			actionsEnabled: "VERIFIED",
			openApiInstalled: "VERIFIED",
			actionAuthValid: "VERIFIED",
			fileBridge: "NOT_REQUIRED",
			codeInterpreter: "NOT_REQUIRED",
			webSearch: "NOT_REQUIRED",
			appsDisabledWhenRequired: "NOT_REQUIRED",
		}),
	});
	const preflight = await adapter.preflight();
	assert.equal(preflight.result.status, "SUCCEEDED");
});

test("preflight returns ACTION_REQUIRED when required checks are UNVERIFIED", async () => {
	const adapter = createBehaviorAdapter({
		observeVerification: async () => ({
			reachable: "VERIFIED",
			actionsEnabled: "UNVERIFIED",
			openApiInstalled: "UNVERIFIED",
			actionAuthValid: "UNVERIFIED",
			fileBridge: "UNVERIFIED",
			codeInterpreter: "UNVERIFIED",
			webSearch: "UNVERIFIED",
			appsDisabledWhenRequired: "UNVERIFIED",
		}),
	});
	const preflight = await adapter.preflight();
	assert.equal(preflight.result.status, "ACTION_REQUIRED");
});

test("reachable-only observation cannot make doctor SUCCEED", async () => {
	const adapter = createBehaviorAdapter({
		observeVerification: async () => ({
			reachable: "VERIFIED",
			actionsEnabled: "UNVERIFIED",
			openApiInstalled: "UNVERIFIED",
			actionAuthValid: "UNVERIFIED",
			fileBridge: "UNVERIFIED",
			codeInterpreter: "UNVERIFIED",
			webSearch: "UNVERIFIED",
			appsDisabledWhenRequired: "UNVERIFIED",
		}),
	});
	const doctor = await adapter.doctor();
	assert.equal(doctor.result.status, "ACTION_REQUIRED");
});

test("doctor can SUCCEED when all required checks are VERIFIED", async () => {
	const adapter = createBehaviorAdapter({
		observeVerification: async () => ({
			reachable: "VERIFIED",
			actionsEnabled: "VERIFIED",
			openApiInstalled: "VERIFIED",
			actionAuthValid: "VERIFIED",
			fileBridge: "NOT_REQUIRED",
			codeInterpreter: "NOT_REQUIRED",
			webSearch: "NOT_REQUIRED",
			appsDisabledWhenRequired: "NOT_REQUIRED",
		}),
	});
	const doctor = await adapter.doctor();
	assert.equal(doctor.result.status, "SUCCEEDED");
});

test("production status accepts protected 401/403 only with healthy Web verification evidence", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-chatgpt-carrier-status-"));
	const carrierUrl = "https://chatgpt.com/";
	const evidenceFile = join(root, "carrier-evidence.json");
	const originalFetch = globalThis.fetch;
	try {
		await writeFile(
			evidenceFile,
			JSON.stringify({
				contract: "proflow.chatgpt-carrier-verification.v1",
				carrierUrl,
				observedAt: "2026-08-19T00:00:00.000Z",
				reachable: "VERIFIED",
				actionsEnabled: "VERIFIED",
				openApiInstalled: "VERIFIED",
				actionAuthValid: "VERIFIED",
				fileBridge: "VERIFIED",
				codeInterpreter: "VERIFIED",
				webSearch: "VERIFIED",
				appsDisabledWhenRequired: "VERIFIED",
			}),
		);
		const binding = createProductionBinding({
			moduleRef: "chatgpt-carrier",
			config: { carrierUrl, verificationEvidenceFile: evidenceFile },
		});
		const status = binding.behaviorAdapter.status as () => Promise<{
			result: { status: string; checks?: { message: string }[] };
		}>;

		globalThis.fetch = async () => new Response(null, { status: 403 });
		const protectedStatus = await status();
		assert.equal(protectedStatus.result.status, "SUCCEEDED");
		assert.match(
			protectedStatus.result.checks?.[0]?.message ?? "",
			/protected.*403/i,
		);

		globalThis.fetch = async () => new Response(null, { status: 404 });
		const missingStatus = await status();
		assert.equal(missingStatus.result.status, "ACTION_REQUIRED");
	} finally {
		globalThis.fetch = originalFetch;
		await rm(root, { recursive: true, force: true });
	}
});
