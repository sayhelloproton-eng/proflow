import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseModuleDescriptor } from "@tomflow/proflow-module-contract";
import { behaviorAdapter } from "../deployment/adapter.ts";
import { descriptor } from "../deployment/descriptor.ts";
import {
	createDevTunnelRuntime,
	probeTlsProtocol,
	readResponseChars,
	verifyPublicIngress,
} from "../src/resource-adapter.ts";

const loggedInRunner = async () => ({
	exitCode: 0,
	stdout: "user@example.com",
	stderr: "",
});

test("dev-tunnel descriptor parses with public-ingress ownership and no legacy lifecycle metadata", () => {
	const parsed = parseModuleDescriptor(descriptor);
	assert.equal(parsed.moduleRef, "dev-tunnel");
	assert.equal(parsed.kind, "external-resource");
	assert.equal(parsed.packageName, "@tomflow/proflow-dev-tunnel");
	assert.equal(parsed.provides[0]?.contractRef, "public-ingress");
	assert.deepEqual(parsed.requires, []);
	assert.equal("lifecycle" in parsed, false);
	assert.equal("verification" in parsed, false);
});

test("default behaviorAdapter reports setup truth without fabricating a tunnel", async (context) => {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-dev-tunnel-status-"),
	);
	context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
	const status = await behaviorAdapter.status({ workspaceRoot });
	assert.equal(status.result.status, "SUCCEEDED");
	assert.deepEqual(status.result.data, {
		setupStatus: "ACTION_REQUIRED",
		runtimeStatus: "STOPPED",
	});
});

test("dev-tunnel exposes the fixed seven-command management surface", () => {
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

test("missing file relay and 429/5xx proof are FAIL, never SKIP/WARN", async () => {
	const verification = await verifyPublicIngress("https://127.0.0.1:1");
	assert.equal(verification.ok, false);
	assert.equal(
		verification.checks.find((c) => c.id === "file-relay-reachable")?.status,
		"FAIL",
	);
	assert.equal(
		verification.checks.find((c) => c.id === "real-status-429")?.status,
		"FAIL",
	);
	assert.equal(
		verification.checks.find((c) => c.id === "real-status-5xx")?.status,
		"FAIL",
	);
});

test("start cannot SUCCEED without a configured tunnelId", async () => {
	const runtime = createDevTunnelRuntime({ runCommand: loggedInRunner });
	await assert.rejects(() => runtime.start(), /tunnelId/);
});

test("status reports UNKNOWN (not STOPPED) when no child is owned", async () => {
	const runtime = createDevTunnelRuntime({
		runCommand: loggedInRunner,
		tunnelId: "tunnel-123",
	});
	const observation = await runtime.status();
	assert.equal(observation.state, "UNKNOWN");
});

test("persistent runtime detaches and survives across adapter instances", async () => {
	if (process.platform === "win32") return;
	const dir = await mkdtemp(join(tmpdir(), "proflow-dev-tunnel-process-"));
	try {
		const command = join(dir, "devtunnel-fixture");
		const stateFile = join(dir, "state", "process.json");
		await writeFile(
			command,
			"#!/bin/sh\ntrap 'exit 0' TERM INT\nwhile :; do sleep 1; done\n",
		);
		await chmod(command, 0o755);
		const options = {
			command,
			tunnelId: "tunnel-persistent-123",
			publicBaseUrl: "https://tunnel.example.com/",
			runCommand: loggedInRunner,
			processStateFile: stateFile,
		};
		const first = createDevTunnelRuntime(options);
		assert.equal((await first.start()).state, "RUNNING");
		const record = JSON.parse(await readFile(stateFile, "utf8")) as {
			pid: number;
		};
		assert.ok(record.pid > 0);

		const second = createDevTunnelRuntime(options);
		assert.equal((await second.status()).state, "RUNNING");
		assert.equal((await second.stop()).state, "STOPPED");
		const stoppedAgain = createDevTunnelRuntime(options);
		assert.equal((await stoppedAgain.stop()).state, "STOPPED");
		assert.equal((await stoppedAgain.status()).state, "UNKNOWN");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("immediate spawn error does not report RUNNING", async () => {
	const runtime = createDevTunnelRuntime({
		command: "definitely-nonexistent-devtunnel-binary",
		runCommand: loggedInRunner,
		tunnelId: "tunnel-123",
	});
	await assert.rejects(() => runtime.start(), /failed to start/);
});

test("TLS probe times out instead of hanging", async () => {
	const server = createServer(() => {
		// accept but never respond — forces the TLS handshake to hang
	});
	server.listen(0, "127.0.0.1");
	await new Promise<void>((resolve) =>
		server.once("listening", () => resolve()),
	);
	const port = (server.address() as AddressInfo).port;
	const started = Date.now();
	const protocol = await probeTlsProtocol("127.0.0.1", port, 200);
	const elapsed = Date.now() - started;
	server.close();
	assert.equal(protocol, undefined);
	assert.ok(elapsed < 2_000, `TLS probe took ${elapsed}ms`);
});

test("streaming read aborts after the size ceiling", async () => {
	let chunksRead = 0;
	const bigChunk = new Uint8Array(64 * 1024);
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			chunksRead += 1;
			controller.enqueue(bigChunk);
		},
	});
	const response = new Response(stream);
	const chars = await readResponseChars(response, 100_000);
	assert.ok(chars !== undefined && chars >= 100_000);
	assert.ok(chunksRead < 10, `read ${chunksRead} chunks instead of aborting`);
});

test("uninstall is idempotent when no dev-tunnel resource is bound", async (context) => {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-dev-tunnel-uninstall-"),
	);
	context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
	const result = await behaviorAdapter.uninstall({ workspaceRoot });
	assert.equal(result.result.status, "SUCCEEDED");
	assert.equal(result.result.ok, true);
	assert.deepEqual(result.observedEffects, []);
});
