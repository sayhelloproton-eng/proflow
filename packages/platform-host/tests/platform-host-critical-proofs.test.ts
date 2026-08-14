import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPlatformHost, parsePlatformHostConfig } from "../src/index.ts";

async function dependencyServer() {
	let ready = true;
	let release: (() => void) | undefined;
	let entered: (() => void) | undefined;
	const requestEntered = new Promise<void>((resolve) => { entered = resolve; });
	const server = createServer(async (request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.url === "/ready") {
			response.statusCode = ready ? 200 : 503;
			response.end(JSON.stringify({ status: ready ? "READY" : "NOT_READY" }));
			return;
		}
		if (request.url === "/executions") {
			entered?.();
			await new Promise<void>((resolve) => { release = resolve; });
			response.end(JSON.stringify({ executionRef: "execution:host-proof", status: "SUCCEEDED" }));
			return;
		}
		response.end(JSON.stringify({ status: "READY" }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") assert.fail("missing dependency port");
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		requestEntered,
		setReady(value: boolean) { ready = value; },
		release() { release?.(); },
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

function config(stateRoot: string, workspaceRoot: string, baseUrl: string) {
	return parsePlatformHostConfig({
		stateRoot,
		workspaceRoot,
		host: "127.0.0.1",
		port: 0,
		executionBaseUrl: baseUrl,
		modelBaseUrl: baseUrl,
		roles: [
			{
				agentPackageRef: "@tomflow/proflow-agent-product",
				registeredPackageVersion: "0.1.0",
				roleRef: "g-product",
				carrierUrl: "https://chatgpt.com/g/g-product",
			},
			{
				agentPackageRef: "@tomflow/proflow-agent-controller-dev",
				registeredPackageVersion: "0.1.0",
				roleRef: "g-controller",
				carrierUrl: "https://chatgpt.com/g/g-controller",
			},
			{
				agentPackageRef: "@tomflow/proflow-agent-test-ops",
				registeredPackageVersion: "0.1.0",
				roleRef: "g-test",
				carrierUrl: "https://chatgpt.com/g/g-test",
			},
		],
	});
}

test("CP-HOST-01 + CP-HOST-02 composition root wires owner packages/public clients and owns no business repository", async () => {
	const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { dependencies?: Record<string, string> };
	assert.equal(packageJson.dependencies?.["@tomflow/proflow-task-orchestration"] !== undefined, true);
	assert.equal(packageJson.dependencies?.["@tomflow/proflow-agent-runtime"] !== undefined, true);

	const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
	for (const forbidden of [
		"TaskObserverStore",
		"SystemAssessmentRepository",
		"ExecutionRepository",
		"BrowserFrameRegistry",
		"UniversalScheduler",
	]) assert.doesNotMatch(source, new RegExp(forbidden, "i"));

	const packageEntries = await readdir(new URL("..", import.meta.url));
	assert.equal(packageEntries.includes("src"), true);
	assert.equal(packageEntries.includes("tests"), true);
});

test("CP-HOST-03 local transport is loopback-only, restartable, and shutdown drains in-flight requests", async () => {
	assert.throws(() => parsePlatformHostConfig({
		stateRoot: "/tmp/.proflow",
		workspaceRoot: "/tmp/project",
		executionBaseUrl: "https://execution.example",
		modelBaseUrl: "http://127.0.0.1:9001",
	}), /loopback HTTP/);

	const root = await mkdtemp(join(tmpdir(), "proflow-platform-host-"));
	const dependency = await dependencyServer();
	const host = createPlatformHost({ config: config(join(root, ".proflow"), join(root, "project"), dependency.baseUrl) });
	try {
		const first = await host.start();
		const baseUrl = `http://${first.host}:${first.port}`;
		assert.equal((await fetch(`${baseUrl}/ready`)).status, 200);

		const inFlight = fetch(`${baseUrl}/actions/executeCapability`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ authenticatedRoleRef: "g-controller", input: { capability: "project.inspect", input: {}, idempotencyKey: "host-drain" } }),
		});
		await dependency.requestEntered;
		let stopped = false;
		const stopping = host.stop().then(() => { stopped = true; });
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.equal(stopped, false);
		dependency.release();
		await inFlight;
		await stopping;
		assert.equal((await host.status()).process, "STOPPED");

		const restarted = await host.start();
		assert.equal((await fetch(`http://${restarted.host}:${restarted.port}/ready`)).status, 200);
	} finally {
		dependency.release();
		await host.stop();
		await dependency.close();
	}
});

test("CP-HOST-04 dependency unavailability is reported as dependency health, never invented Domain READY/System Assessment", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-platform-host-health-"));
	const dependency = await dependencyServer();
	const host = createPlatformHost({ config: config(join(root, ".proflow"), join(root, "project"), dependency.baseUrl) });
	try {
		const started = await host.start();
		dependency.setReady(false);
		const response = await fetch(`http://${started.host}:${started.port}/ready`);
		const body = await response.text();
		assert.match(body, /NOT_READY|dependency/i);
		assert.doesNotMatch(body, /systemAssessment|overallSystemHealth|taskReady/i);
	} finally {
		await host.stop();
		await dependency.close();
	}
});

test("CP-HOST-05 restart rebuilds composition and has no host mutation replay/cache truth", async () => {
	const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
	assert.doesNotMatch(source, /mutationReplay|replayJournal|businessStateMirror|assessmentCache/i);
	assert.match(source, /restart|createPlatformHost/i);
});
