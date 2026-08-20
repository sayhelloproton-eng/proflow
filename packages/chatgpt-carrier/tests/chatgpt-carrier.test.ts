import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseModuleDescriptor } from "@tomflow/proflow-module-contract";
import { behaviorAdapter } from "../deployment/adapter.ts";
import { descriptor } from "../deployment/descriptor.ts";

const verified = () => ({
	reachable: "VERIFIED" as const,
	actionsEnabled: "VERIFIED" as const,
	openApiInstalled: "VERIFIED" as const,
	actionAuthValid: "VERIFIED" as const,
	fileBridge: "VERIFIED" as const,
	codeInterpreter: "VERIFIED" as const,
	webSearch: "VERIFIED" as const,
	appsDisabledWhenRequired: "VERIFIED" as const,
});

async function workspace(
	context: { after(fn: () => unknown): void },
	prefix: string,
) {
	const root = await mkdtemp(join(tmpdir(), prefix));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

test("parseModuleDescriptor accepts the chatgpt-carrier descriptor without legacy lifecycle/verification fields", () => {
	const parsed = parseModuleDescriptor(descriptor);
	assert.equal(parsed.moduleRef, "chatgpt-carrier");
	assert.equal(parsed.kind, "external-resource");
	assert.deepEqual(parsed.provides, []);
	assert.deepEqual(parsed.documentation, {
		docs: "DOCS.md",
		setup: "SETUP.md",
	});
	assert.equal("lifecycle" in parsed, false);
	assert.equal("verification" in parsed, false);
});

test("unconfigured carrier status is ACTION_REQUIRED truth and setup owns the human step", async (context) => {
	const workspaceRoot = await workspace(
		context,
		"proflow-chatgpt-carrier-unconfigured-",
	);
	const commandContext = { workspaceRoot };
	const status = await behaviorAdapter.status(commandContext);
	assert.deepEqual(status.result.data, {
		setupStatus: "ACTION_REQUIRED",
		runtimeStatus: "STOPPED",
	});
	assert.equal(status.externalAvailabilityClaim, "UNKNOWN");
	const setup = await behaviorAdapter.setup(commandContext);
	assert.equal(setup.result.status, "ACTION_REQUIRED");
	assert.equal(
		setup.result.actionRequired?.action,
		"materialize-custom-gpt-carrier",
	);
});

test("external-resource adapter exposes the fixed seven-command management surface", () => {
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

test("reachability alone never makes incomplete Action/auth verification READY", async (context) => {
	const workspaceRoot = await workspace(
		context,
		"proflow-chatgpt-carrier-incomplete-",
	);
	const setup = await behaviorAdapter.setup({
		workspaceRoot,
		input: {
			carrierUrl: "https://chatgpt.com/g/g-carrier-test",
			verification: {
				...verified(),
				actionAuthValid: "UNVERIFIED",
			},
		},
	});
	assert.equal(setup.result.status, "ACTION_REQUIRED");
	assert.equal(setup.result.actionRequired?.action, "verify-carrier");
});

test("production status accepts protected 401/403 only with healthy Web verification evidence", async (context) => {
	const workspaceRoot = await workspace(
		context,
		"proflow-chatgpt-carrier-status-",
	);
	const originalFetch = globalThis.fetch;
	try {
		globalThis.fetch = async () => new Response(null, { status: 403 });
		const setup = await behaviorAdapter.setup({
			workspaceRoot,
			input: {
				carrierUrl: "https://chatgpt.com/g/g-carrier-test",
				verification: verified(),
			},
		});
		assert.equal(setup.result.status, "SUCCEEDED");
		const protectedStatus = await behaviorAdapter.status({ workspaceRoot });
		assert.deepEqual(protectedStatus.result.data, {
			setupStatus: "READY",
			runtimeStatus: "RUNNING",
		});
		assert.equal(protectedStatus.externalAvailabilityClaim, "AVAILABLE");

		globalThis.fetch = async () => new Response(null, { status: 404 });
		const missingStatus = await behaviorAdapter.status({ workspaceRoot });
		assert.deepEqual(missingStatus.result.data, {
			setupStatus: "READY",
			runtimeStatus: "FAILED",
		});
		assert.equal(missingStatus.externalAvailabilityClaim, "UNAVAILABLE");
	} finally {
		globalThis.fetch = originalFetch;
	}
});
