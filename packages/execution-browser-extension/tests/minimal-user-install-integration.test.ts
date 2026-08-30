import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { writeModuleSharedFacts } from "@tomflow/proflow-module-contract";
import {
	browserExtensionLoadDir,
	pairBrowserExtensionSetup,
} from "../deployment/adapter.ts";
import {
	type BrowserExtensionDesktop,
	type BrowserExtensionPair,
	runInteractiveBrowserExtensionSetup,
} from "../src/install-workflow.ts";

const extensionId = "f".repeat(32);
const extensionInstanceId = "extension:minimal-user-install-integration";

async function prepareWorkspace() {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-browser-install-"),
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
	return workspaceRoot;
}

async function callExtension(
	endpoint: string,
	token: string,
	path: string,
	init: RequestInit,
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

function realPairWithSimulatedChrome(): BrowserExtensionPair {
	return (context, options) =>
		pairBrowserExtensionSetup(context, {
			...(options.timeoutMs === undefined
				? {}
				: { timeoutMs: options.timeoutMs }),
			async onWaiting(input) {
				await options.onWaiting?.(input);
				const runtime = JSON.parse(
					await readFile(join(input.loadDir, "runtime-config.json"), "utf8"),
				) as { proflowRuntimeBridge: { token: string } };
				const hello = await callExtension(
					input.endpoint,
					runtime.proflowRuntimeBridge.token,
					"/v1/session/hello",
					{
						method: "POST",
						body: JSON.stringify({ extensionId, extensionInstanceId }),
					},
				);
				assert.equal(hello.status, 200);

				const heartbeat = await callExtension(
					input.endpoint,
					runtime.proflowRuntimeBridge.token,
					`/v1/session/heartbeat?extensionInstanceId=${encodeURIComponent(extensionInstanceId)}`,
					{ method: "POST", body: "{}" },
				);
				assert.equal(heartbeat.status, 200);
			},
		});
}

function fakeDesktop(events: string[]): BrowserExtensionDesktop {
	return {
		copyText(value) {
			events.push(`copy:${value}`);
		},
		openExtensionsPage() {
			events.push("open:chrome://extensions");
		},
		showInstruction() {
			events.push("instruction");
		},
	};
}

async function reconnectInstalledExtension(workspaceRoot: string) {
	const runtime = JSON.parse(
		await readFile(
			join(browserExtensionLoadDir(workspaceRoot), "runtime-config.json"),
			"utf8",
		),
	) as {
		proflowRuntimeBridge: { endpoint: string; token: string };
	};
	for (let attempt = 0; attempt < 40; attempt += 1) {
		try {
			const hello = await callExtension(
				runtime.proflowRuntimeBridge.endpoint,
				runtime.proflowRuntimeBridge.token,
				"/v1/session/hello",
				{
					method: "POST",
					body: JSON.stringify({ extensionId, extensionInstanceId }),
				},
			);
			if (!hello.ok) throw new Error("HELLO_REJECTED");
			const heartbeat = await callExtension(
				runtime.proflowRuntimeBridge.endpoint,
				runtime.proflowRuntimeBridge.token,
				`/v1/session/heartbeat?extensionInstanceId=${encodeURIComponent(extensionInstanceId)}`,
				{ method: "POST", body: "{}" },
			);
			if (!heartbeat.ok) throw new Error("HEARTBEAT_REJECTED");
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	}
	throw new Error("SIMULATED_INSTALLED_EXTENSION_DID_NOT_RECONNECT");
}

test("minimal install journey reaches READY and repeated setup does not ask the user again", async () => {
	const workspaceRoot = await prepareWorkspace();
	const events: string[] = [];
	try {
		const pair = realPairWithSimulatedChrome();
		const first = await runInteractiveBrowserExtensionSetup({
			workspaceRoot,
			desktop: fakeDesktop(events),
			pair,
			timeoutMs: 2_000,
		});
		assert.deepEqual(first, { extensionId, extensionInstanceId });
		assert.deepEqual(events, [
			`copy:${browserExtensionLoadDir(workspaceRoot)}`,
			"instruction",
		]);

		const reconnect = reconnectInstalledExtension(workspaceRoot);
		const second = await runInteractiveBrowserExtensionSetup({
			workspaceRoot,
			desktop: fakeDesktop(events),
			timeoutMs: 1_000,
		});
		await reconnect;
		assert.deepEqual(second, { extensionId, extensionInstanceId });
		assert.equal(events.length, 2);
	} finally {
		await rm(workspaceRoot, { recursive: true, force: true });
	}
});

test("stale READY evidence does not suppress the human reinstall path", async () => {
	const workspaceRoot = await prepareWorkspace();
	const events: string[] = [];
	try {
		await runInteractiveBrowserExtensionSetup({
			workspaceRoot,
			desktop: fakeDesktop(events),
			pair: realPairWithSimulatedChrome(),
			timeoutMs: 1_000,
		});
		assert.equal(events.length, 2);

		await assert.rejects(
			() =>
				runInteractiveBrowserExtensionSetup({
					workspaceRoot,
					desktop: fakeDesktop(events),
					timeoutMs: 100,
				}),
			/PAIRING_TIMEOUT/,
		);
		assert.equal(events.length, 4);
	} finally {
		await rm(workspaceRoot, { recursive: true, force: true });
	}
});

test("pairing timeout preserves prepared files but never writes fake READY evidence", async () => {
	const workspaceRoot = await prepareWorkspace();
	const events: string[] = [];
	try {
		await assert.rejects(
			() =>
				runInteractiveBrowserExtensionSetup({
					workspaceRoot,
					desktop: fakeDesktop(events),
					timeoutMs: 50,
				}),
			/PAIRING_TIMEOUT/,
		);
		assert.deepEqual(events, [
			`copy:${browserExtensionLoadDir(workspaceRoot)}`,
			"instruction",
		]);
		await access(
			join(browserExtensionLoadDir(workspaceRoot), "runtime-config.json"),
		);
		await assert.rejects(
			access(
				join(
					workspaceRoot,
					".proflow/runtime/modules/execution-browser-extension/setup.json",
				),
			),
		);
		await assert.rejects(
			access(
				join(
					workspaceRoot,
					".proflow/runtime/modules/execution-browser-extension/verification.json",
				),
			),
		);
	} finally {
		await rm(workspaceRoot, { recursive: true, force: true });
	}
});
