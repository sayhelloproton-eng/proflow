import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseModuleDescriptor } from "@tomflow/proflow-module-contract";
import { behaviorAdapter } from "../deployment/adapter.ts";
import { descriptor } from "../deployment/descriptor.ts";

async function workspace(
	context: { after(fn: () => unknown): void },
	prefix: string,
) {
	const root = await mkdtemp(join(tmpdir(), prefix));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

async function withFetch(
	status: number,
	operation: () => Promise<void>,
): Promise<void> {
	const originalFetch = globalThis.fetch;
	try {
		globalThis.fetch = async () => new Response(null, { status });
		await operation();
	} finally {
		globalThis.fetch = originalFetch;
	}
}

test("descriptor declares only machine-observable ChatGPT Web prerequisites", () => {
	const parsed = parseModuleDescriptor(descriptor);
	assert.equal(parsed.moduleRef, "chatgpt-carrier");
	assert.equal(parsed.kind, "external-resource");
	assert.deepEqual(parsed.provides, []);
	assert.equal(
		parsed.requirements.some((requirement) => requirement.kind === "human"),
		false,
	);
});
test("reachable ChatGPT Web makes status and setup READY without user input", async (context) => {
	const workspaceRoot = await workspace(context, "proflow-chatgpt-auto-ready-");
	await withFetch(403, async () => {
		const status = await behaviorAdapter.status({ workspaceRoot });
		assert.deepEqual(status.result.data, {
			setupStatus: "READY",
			runtimeStatus: "RUNNING",
		});
		assert.equal(status.externalAvailabilityClaim, "AVAILABLE");
		const setup = await behaviorAdapter.setup({ workspaceRoot });
		assert.equal(setup.result.status, "SUCCEEDED");
		assert.deepEqual(setup.result.data, {
			setupStatus: "READY",
			runtimeStatus: "RUNNING",
		});
	});
});

test("unreachable ChatGPT Web remains ACTION_REQUIRED instead of fake READY", async (context) => {
	const workspaceRoot = await workspace(context, "proflow-chatgpt-auto-down-");
	await withFetch(503, async () => {
		const status = await behaviorAdapter.status({ workspaceRoot });
		assert.equal(status.result.status, "ACTION_REQUIRED");
		assert.equal(status.result.data?.setupStatus, "ACTION_REQUIRED");
		assert.equal(status.result.data?.runtimeStatus, "FAILED");
		assert.equal(
			status.result.data?.issues?.[0]?.code,
			"CHATGPT_WEB_UNAVAILABLE",
		);
		assert.equal(status.externalAvailabilityClaim, "UNAVAILABLE");
	});
});
test("setup never writes a second carrier URL or capability verification store", async (context) => {
	const workspaceRoot = await workspace(context, "proflow-chatgpt-no-mirror-");
	await withFetch(200, async () => {
		assert.equal(
			(await behaviorAdapter.setup({ workspaceRoot })).result.status,
			"SUCCEEDED",
		);
	});
	for (const file of ["setup.json", "verification.json"]) {
		await assert.rejects(
			access(
				join(
					workspaceRoot,
					".proflow",
					"runtime",
					"external-resources",
					"chatgpt-carrier",
					file,
				),
			),
		);
	}
});

test("external-resource adapter keeps the fixed seven-command management surface", () => {
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
