import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	moduleWorkspaceStateDirectory,
	writeModuleSharedFacts,
} from "@tomflow/proflow-module-contract";
import { descriptor } from "../deployment/descriptor.ts";

const extensionId = "d".repeat(32);
const extensionInstanceId = "extension:deployment-pairing";
const moduleVersion = descriptor.moduleVersion;

async function call(
	endpoint: string,
	token: string,
	path: string,
	init: RequestInit = {},
) {
	return fetch(`${endpoint}${path}`, {
		...init,
		headers: {
			authorization: `Bearer ${token}`,
			origin: `chrome-extension://${extensionId}`,
			"content-type": "application/json",
		},
	});
}

test("CP-EXE-BR-16 deployment pairing persists only heartbeat-proven Extension reality", async () => {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-browser-pairing-"),
	);
	const taskTokenFile = join(workspaceRoot, "task.token");
	const approvalTokenFile = join(workspaceRoot, "approval.token");
	await writeFile(taskTokenFile, "t".repeat(40), { mode: 0o600 });
	await writeFile(approvalTokenFile, "a".repeat(40), { mode: 0o600 });
	await writeModuleSharedFacts({ workspaceRoot }, "platform-host", {
		endpoint: "http://127.0.0.1:43199",
		taskApplicationTokenFile: taskTokenFile,
		approvalApplicationTokenFile: approvalTokenFile,
	});

	try {
		const adapter = (await import("../deployment/adapter.ts")) as Record<
			string,
			unknown
		>;
		const pair = adapter.pairBrowserExtensionSetup;
		assert.equal(typeof pair, "function");
		if (typeof pair !== "function") return;

		const paired = await (
			pair as (
				context: { workspaceRoot: string },
				options: {
					timeoutMs: number;
					onWaiting(input: {
						loadDir: string;
						endpoint: string;
					}): Promise<void>;
				},
			) => Promise<{
				extensionId: string;
				extensionInstanceId: string;
				moduleVersion: string;
			}>
		)(
			{ workspaceRoot },
			{
				timeoutMs: 10_000,
				async onWaiting({ loadDir, endpoint }) {
					const runtime = JSON.parse(
						await readFile(join(loadDir, "runtime-config.json"), "utf8"),
					) as { proflowRuntimeBridge: { token: string; endpoint: string } };
					assert.equal(runtime.proflowRuntimeBridge.endpoint, endpoint);
					const hello = await call(
						endpoint,
						runtime.proflowRuntimeBridge.token,
						"/v1/session/hello",
						{
							method: "POST",
							body: JSON.stringify({
								extensionId,
								extensionInstanceId,
								moduleVersion,
							}),
						},
					);
					assert.equal(hello.status, 200);

					const heartbeat = await call(
						endpoint,
						runtime.proflowRuntimeBridge.token,
						`/v1/session/heartbeat?extensionInstanceId=${encodeURIComponent(extensionInstanceId)}`,
						{ method: "POST", body: "{}" },
					);
					assert.equal(heartbeat.status, 200);
				},
			},
		);
		assert.deepEqual(paired, {
			extensionId,
			extensionInstanceId,
			moduleVersion,
		});

		const stateRoot = moduleWorkspaceStateDirectory(
			{ workspaceRoot },
			"execution-browser-extension",
		);
		const setup = JSON.parse(
			await readFile(join(stateRoot, "setup.json"), "utf8"),
		);
		const evidence = JSON.parse(
			await readFile(join(stateRoot, "verification.json"), "utf8"),
		);
		assert.equal(setup.extensionId, extensionId);
		assert.equal(evidence.extensionId, extensionId);
		assert.equal(evidence.extensionInstanceId, extensionInstanceId);
		assert.equal(evidence.moduleVersion, moduleVersion);
		assert.equal(evidence.evidenceSource, "PAIRING_HEARTBEAT");

		const executor = JSON.parse(
			await readFile(join(stateRoot, "browser-executor.json"), "utf8"),
		);
		assert.deepEqual(Object.keys(executor).sort(), ["endpoint", "tokenFile"]);
		assert.match(executor.endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
		assert.equal(typeof executor.tokenFile, "string");
		assert.equal("bridge" in executor, false);
	} finally {
		await rm(workspaceRoot, { recursive: true, force: true });
	}
});

test("CP-EXE-BR-16 Platform setup surface removes manual Extension ID and fake RUNNING evidence", async () => {
	const setupDoc = await readFile(
		new URL("../SETUP.md", import.meta.url),
		"utf8",
	);
	const adapter = await readFile(
		new URL("../deployment/adapter.ts", import.meta.url),
		"utf8",
	);
	assert.match(setupDoc, /platform setup/);
	assert.doesNotMatch(setupDoc, /--module/);
	assert.match(setupDoc, /Verify: `platform status`/);
	assert.doesNotMatch(
		setupDoc,
		/Extension ID|--extension-id|proflow-execution-browser-extension/,
	);
	assert.doesNotMatch(adapter, /supplied\.serviceWorker|copy its extensionId/);
});
