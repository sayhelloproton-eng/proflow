import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createServer } from "node:net";
import { test } from "node:test";

import { parseModuleDescriptor } from "@tomflow/proflow-module-contract";
import {
	behaviorAdapter,
	createBehaviorAdapter,
} from "../deployment/adapter.ts";
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

const notLoggedInRunner = async () => ({
	exitCode: 1,
	stdout: "",
	stderr: "not logged in",
});

test("dev-tunnel descriptor parses against moduleDescriptorSchema", () => {
	const parsed = parseModuleDescriptor(descriptor);
	assert.equal(parsed.moduleRef, "dev-tunnel");
	assert.equal(parsed.kind, "external-resource");
	assert.equal(parsed.contractVersion, "1.0.0");
	assert.equal(parsed.packageName, "@tomflow/proflow-dev-tunnel");
	assert.deepEqual(parsed.provides, []);
	assert.deepEqual(parsed.requires, []);
	assert.ok(parsed.lifecycle.supported.includes("start"));
	assert.ok(parsed.lifecycle.supported.includes("stop"));
	assert.ok(parsed.lifecycle.supported.includes("restart"));
});

test("default behaviorAdapter is honest when no tunnel is bound", async () => {
	const status = await behaviorAdapter.status();
	assert.equal(status.result.status, "ACTION_REQUIRED");
	assert.equal(status.result.ok, false);

	const verify = await behaviorAdapter.verify();
	assert.equal(verify.result.status, "ACTION_REQUIRED");

	const start = await behaviorAdapter.start();
	assert.equal(start.result.status, "ACTION_REQUIRED");

	const stop = await behaviorAdapter.stop();
	assert.equal(stop.result.status, "ACTION_REQUIRED");

	const restart = await behaviorAdapter.restart();
	assert.equal(restart.result.status, "ACTION_REQUIRED");
});

test("start/stop/restart are honest when a runtime is bound but not logged in", async () => {
	const runtime = createDevTunnelRuntime({
		publicBaseUrl: "https://tunnel.example.com/",
		runCommand: notLoggedInRunner,
	});
	const adapter = createBehaviorAdapter({ runtime });

	const start = await adapter.start();
	assert.equal(start.result.status, "ACTION_REQUIRED");
	assert.equal(start.result.actionRequired?.action, "complete-tunnel-login");

	const restart = await adapter.restart();
	assert.equal(restart.result.status, "ACTION_REQUIRED");

	const verify = await adapter.verify();
	assert.equal(verify.result.status, "ACTION_REQUIRED");
});

test("every supported lifecycle primitive exposes an adapter function", () => {
	for (const primitive of descriptor.lifecycle.supported) {
		assert.equal(typeof behaviorAdapter[primitive], "function", primitive);
	}
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

test("doctor reads current login/state/publicUrl reality, not just adapter-bound", async () => {
	const runtime = createDevTunnelRuntime({
		runCommand: notLoggedInRunner,
		publicBaseUrl: "https://tunnel.example.com/",
	});
	const adapter = createBehaviorAdapter({ runtime });
	const doctor = await adapter.doctor();
	assert.equal(doctor.result.status, "ACTION_REQUIRED");
	const loginCheck = doctor.result.checks?.find((c) => c.id === "tunnel-login");
	assert.equal(loginCheck?.status, "FAIL");
});

test("stop returns ACTION_REQUIRED when stop state is UNKNOWN", async () => {
	const runtime = createDevTunnelRuntime({
		runCommand: loggedInRunner,
		tunnelId: "tunnel-123",
	});
	const adapter = createBehaviorAdapter({ runtime });
	const stop = await adapter.stop();
	assert.equal(stop.result.status, "ACTION_REQUIRED");
	assert.equal(stop.result.ok, false);
	assert.equal(stop.result.actionRequired?.action, "complete-tunnel-stop");
});

test("restart does not start when stop is UNKNOWN", async () => {
	const runtime = createDevTunnelRuntime({
		runCommand: loggedInRunner,
		tunnelId: "tunnel-123",
	});
	const adapter = createBehaviorAdapter({ runtime });
	const restart = await adapter.restart();
	assert.equal(restart.result.status, "ACTION_REQUIRED");
	assert.equal(restart.result.actionRequired?.action, "complete-tunnel-stop");
});

test("uninstall is idempotent when no dev-tunnel resource is bound", async () => {
	const result = await behaviorAdapter.uninstall();
	assert.equal(result.result.status, "SUCCEEDED");
	assert.equal(result.result.ok, true);
	assert.deepEqual(result.observedEffects, []);
});
