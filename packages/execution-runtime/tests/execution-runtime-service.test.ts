import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { descriptor as executionRuntimeDescriptor } from "../deployment/descriptor.ts";

import {
	createExecutionRuntimeProcess,
	parseExecutionRuntimeProcessConfig,
} from "../src/service.ts";

const exec = promisify(execFile);

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "proflow-execution-service-"));
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({ name: "fixture" }),
	);
	await writeFile(join(root, "value.txt"), "real-service");
	await exec("git", ["init", "-q"], { cwd: root });
	return {
		root,
		config: {
			databasePath: join(root, ".proflow", "execution.sqlite"),
			projectRoot: root,
			artifactRoot: join(root, ".proflow", "artifacts"),
			host: "127.0.0.1",
			port: 0,
			exactNetworkTargets: [],
		},
	};
}

test("formal execution-runtime process starts, routes, drains, reopens and stops", async () => {
	const { config } = await fixture();
	const logs: Record<string, unknown>[] = [];
	const service = await createExecutionRuntimeProcess({
		config,
		log: (entry) => logs.push(entry),
	});
	const first = await service.start();
	assert.equal(service.status().readiness, "READY");
	assert.equal(
		(await fetch(`http://${first.host}:${first.port}/ready`)).status,
		200,
	);
	const created = (await fetch(
		`http://${first.host}:${first.port}/executions`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				contract: "execution",
				contractVersion: "1.0.0",
				callerRef: "caller:service",
				idempotencyKey: "read-once",
				projectRoot: config.projectRoot,
				capability: "file.read",
				input: { path: "value.txt" },
			}),
		},
	).then((response) => response.json())) as {
		executionRef: string;
		status: string;
	};
	assert.equal(created.status, "SUCCEEDED");
	const second = await service.restart();
	const reopened = (await fetch(
		`http://${second.host}:${second.port}/executions/${encodeURIComponent(created.executionRef)}`,
		{ headers: { "x-proflow-caller-ref": "caller:service" } },
	).then((response) => response.json())) as { status: string };
	assert.equal(reopened.status, "SUCCEEDED");
	await service.stop();
	assert.equal(service.status().process, "STOPPED");
	assert.deepEqual(
		logs.map((entry) => entry.event),
		[
			"SERVICE_STARTED",
			"SERVICE_STOPPED",
			"SERVICE_STARTED",
			"SERVICE_STOPPED",
		],
	);
});

test("PRESMOKE-B4-RUNTIME-01 configured identity and transport dependencies participate in readiness", async () => {
	const { config } = await fixture();
	const required = {
		...config,
		transportCredentialFile: "/tmp/execution-transport.token",
		identity: {
			endpoint: "http://127.0.0.1:47830",
			tokenFile: "/tmp/execution-identity.token",
		},
	};
	const service = await createExecutionRuntimeProcess({ config: required });
	try {
		await service.start();
		assert.equal(service.status().readiness, "NOT_READY");
		assert.equal(service.status().identity, "UNAVAILABLE");
		assert.equal(service.status().transportAuth, "UNAVAILABLE");
	} finally {
		await service.stop();
	}
});

test("CP-EXE-RT-14 specialised Context Pack/Patch APIs return durable executionRef and reuse idempotent Execution truth", async () => {
	const { config } = await fixture();
	const service = await createExecutionRuntimeProcess({ config });
	const address = await service.start();
	try {
		const base = `http://${address.host}:${address.port}`;
		const contextBody = {
			contract: "execution.context-pack-materialization",
			contractVersion: "1.0.0",
			callerRef: "caller:artifact",
			idempotencyKey: "context:1",
			taskId: "task:1",
			nodeId: "node:1",
			entries: [
				{ path: "value.txt", mimeType: "text/plain", content: "alpha" },
			],
		};
		const first = (await fetch(`${base}/artifacts/context-pack`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(contextBody),
		}).then((response) => response.json())) as {
			executionRef: string;
			artifact: { artifactRef: string; kind: string };
		};
		const second = (await fetch(`${base}/artifacts/context-pack`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(contextBody),
		}).then((response) => response.json())) as {
			executionRef: string;
			artifact: { artifactRef: string; kind: string };
		};
		assert.equal(first.executionRef, second.executionRef);
		assert.equal(first.artifact.artifactRef, second.artifact.artifactRef);
		assert.equal(first.artifact.kind, "context-pack");

		const patch = (await fetch(`${base}/artifacts/patch-proposal`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				contract: "execution.patch-proposal-materialization",
				contractVersion: "1.0.0",
				callerRef: "caller:artifact",
				idempotencyKey: "patch-proposal:1",
				taskId: "task:1",
				nodeId: "node:1",
				proposal: {
					diff: "--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-real-service\n+changed\n",
					baseHash: "sha256:base",
					baseRef: "snapshot:1",
				},
			}),
		}).then((response) => response.json())) as {
			executionRef: string;
			artifact: { kind: string; metadata?: Record<string, unknown> };
		};
		assert.ok(patch.executionRef);
		assert.equal(patch.artifact.kind, "patch-proposal");
		assert.equal(patch.artifact.metadata?.baseRef, "snapshot:1");
	} finally {
		await service.stop();
	}
});

test("PRESMOKE-B4-RUNTIME-02 formal readiness can require the Model Decision port without faking Batch 5 wiring", async () => {
	const { config } = await fixture();
	const missing = await createExecutionRuntimeProcess({
		config,
		requireModelDecision: true,
	});
	await missing.start();
	assert.equal(missing.status().modelDecision, "UNAVAILABLE");
	assert.equal(missing.status().readiness, "NOT_READY");
	await missing.stop();

	const wired = await createExecutionRuntimeProcess({
		config,
		requireModelDecision: true,
		modelDecision: {
			async decide() {
				return { decision: "ALLOW", decisionPath: "fast" };
			},
		},
	});
	await wired.start();
	assert.equal(wired.status().modelDecision, "READY");
	assert.equal(wired.status().readiness, "READY");
	await wired.stop();
});

test("CP-EXE-RT-20 shipped execution-runtime descriptor and binary require the formal Browser/security/model composition", async () => {
	const requiredSlots = new Map(
		executionRuntimeDescriptor.configSlots.map(
			(slot) => [slot.key, slot] as const,
		),
	);
	const requiredKeys = [
		"databasePath",
		"projectRoot",
		"artifactRoot",
		"browserExecutorConfigPath",
		"transportCredentialFile",
		"identity.endpoint",
		"identity.tokenFile",
		"modelDecision.endpoint",
		"modelDecision.credentialFile",
	] as const;
	const sensitiveKeys = [
		"transportCredentialFile",
		"identity.tokenFile",
		"modelDecision.credentialFile",
	] as const;
	for (const key of requiredKeys)
		assert.equal(
			requiredSlots.get(key)?.required,
			true,
			`${key} must be a required Deployment config slot`,
		);
	for (const key of sensitiveKeys) {
		const slot = requiredSlots.get(key);
		assert.ok(slot, `${key} must exist`);
		assert.equal(
			"sensitive" in slot ? slot.sensitive : false,
			true,
			`${key} must be marked sensitive`,
		);
	}
	const { root, config } = await fixture();
	const configPath = join(root, "execution-runtime-missing-browser.json");
	await writeFile(
		configPath,
		JSON.stringify({
			...config,
			transportCredentialFile: "/tmp/proflow-test-execution-transport.token",
			identity: {
				endpoint: "http://127.0.0.1:47830",
				tokenFile: "/tmp/proflow-test-execution-identity.token",
			},
		}),
	);
	await assert.rejects(
		exec(process.execPath, [
			fileURLToPath(new URL("../dist/src/cli.js", import.meta.url)),
			"start",
			configPath,
		]),
		/formal execution-runtime requires browserExecutorConfigPath/,
	);
});

test("PRESMOKE-B5-RUNTIME-04 modelDecision readiness reflects the consumer-specific dependency probe", async () => {
	const { config } = await fixture();
	let modelReady = false;
	const process = await createExecutionRuntimeProcess({
		config,
		requireModelDecision: true,
		modelDecision: {
			async decide() {
				return { decision: "ALLOW", decisionPath: "fast" };
			},
		},
		modelDecisionReadiness: () => modelReady,
	});
	await process.start();
	assert.equal(process.status().modelDecision, "UNAVAILABLE");
	assert.equal(process.status().readiness, "NOT_READY");
	modelReady = true;
	assert.equal(process.status().modelDecision, "READY");
	assert.equal(process.status().readiness, "READY");
	await process.stop();
});

test("PRESMOKE-B5-RUNTIME-05 modelDecision config is loopback-only", () => {
	assert.throws(
		() =>
			parseExecutionRuntimeProcessConfig({
				databasePath: "/tmp/a.db",
				projectRoot: "/tmp",
				artifactRoot: "/tmp/a",
				host: "127.0.0.1",
				port: 0,
				exactNetworkTargets: [],
				modelDecision: { endpoint: "https://example.com" },
			}),
		/loopback HTTP root/,
	);
});
