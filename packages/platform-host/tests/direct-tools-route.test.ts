import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAgentGatewayProcess } from "@tomflow/proflow-agent-gateway/process";
import { createLocalToolBridgeServer } from "@tomflow/proflow-execution-browser-extension/local-tool-bridge";

import { createPlatformHost, parsePlatformHostConfig } from "../src/index.ts";

const packages = {
	product: "@tomflow/proflow-agent-product",
	dev: "@tomflow/proflow-agent-controller-dev",
	test: "@tomflow/proflow-agent-test-ops",
} as const;
const roles = { product: "g-product", dev: "g-dev", test: "g-test" } as const;
const extensionId = "a".repeat(32);
const hostToken = `host-token-${"h".repeat(40)}`;
const extensionToken = `extension-token-${"e".repeat(40)}`;
const generation = "generation-direct-tools";

async function extensionRequest(
	endpoint: string,
	path: string,
	init: RequestInit = {},
) {
	return fetch(new URL(path, endpoint), {
		...init,
		headers: {
			authorization: `Bearer ${extensionToken}`,
			origin: `chrome-extension://${extensionId}`,
			"content-type": "application/json",
			...(init.headers ?? {}),
		},
	});
}

async function establishConsumer(endpoint: string) {
	const hello = await extensionRequest(
		endpoint,
		"/v1/local-tools/session/hello",
		{
			method: "POST",
			body: JSON.stringify({
				extensionId,
				extensionInstanceId: "instance-1",
				moduleVersion: "0.1.0",
			}),
		},
	);
	assert.equal(hello.status, 200);
	const empty = await extensionRequest(
		endpoint,
		"/v1/local-tools/commands/next?extensionInstanceId=instance-1",
	);
	assert.equal(empty.status, 204);
}

async function consumeOne(endpoint: string) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const next = await extensionRequest(
			endpoint,
			"/v1/local-tools/commands/next?extensionInstanceId=instance-1",
		);
		if (next.status === 204) {
			await new Promise((resolve) => setTimeout(resolve, 10));
			continue;
		}
		assert.equal(next.status, 200);
		const command = (await next.json()) as Record<string, unknown>;
		const executed = await extensionRequest(
			endpoint,
			"/v1/local-tools/commands/execute?extensionInstanceId=instance-1",
			{
				method: "POST",
				body: JSON.stringify({
					commandId: command.commandId,
					generation: command.generation,
					commandDigest: command.commandDigest,
				}),
			},
		);
		assert.equal(executed.status, 202);
		return command;
	}
	assert.fail("local tool command was not delivered to Extension consumer");
}

async function callGateway(
	endpoint: string,
	token: string,
	operationId: string,
	body: unknown,
) {
	const response = await fetch(new URL(`/actions/${operationId}`, endpoint), {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify(body),
	});
	return { response, body: (await response.json()) as Record<string, unknown> };
}

async function callHost(
	endpoint: string,
	authenticatedRoleRef: string,
	operationId: string,
	input: unknown,
) {
	const response = await fetch(new URL(`/actions/${operationId}`, endpoint), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			authenticatedRoleRef,
			input,
			deadlineAt: new Date(Date.now() + 30_000).toISOString(),
		}),
	});
	return { response, body: (await response.json()) as Record<string, unknown> };
}

test("CP-HOST-DIRECT-TOOLS-01 GPT localDev crosses the Extension Local Tool Effect Gate without Execution identity", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-host-direct-tools-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const workspaceRoot = join(root, "workspace");
	const stateRoot = join(workspaceRoot, ".proflow");
	await writeFile(join(root, "placeholder"), "x");
	const seen: Array<Record<string, unknown>> = [];
	const bridge = await createLocalToolBridgeServer({
		hostToken,
		extensionToken,
		extensionId,
		generation,
		workspaceRoot,
		execute: async (command) => {
			seen.push(command as unknown as Record<string, unknown>);
			return { files: [{ path: "/virtual/package.json", content: "{}" }] };
		},
	});
	context.after(() => bridge.close());
	await establishConsumer(bridge.endpoint);
	const host = createPlatformHost({
		config: parsePlatformHostConfig({
			stateRoot,
			workspaceRoot,
			host: "127.0.0.1",
			port: 0,
			roles: [
				{
					agentPackageRef: packages.product,
					registeredPackageVersion: "0.1.0",
					roleRef: roles.product,
					carrierUrl: `https://chatgpt.com/g/${roles.product}`,
				},
				{
					agentPackageRef: packages.dev,
					registeredPackageVersion: "0.1.0",
					roleRef: roles.dev,
					carrierUrl: `https://chatgpt.com/g/${roles.dev}`,
				},
				{
					agentPackageRef: packages.test,
					registeredPackageVersion: "0.1.0",
					roleRef: roles.test,
					carrierUrl: `https://chatgpt.com/g/${roles.test}`,
				},
			],
		}),
		resolveLocalToolConnection: async () => ({
			endpoint: bridge.endpoint,
			credential: hostToken,
		}),
	});
	context.after(() => host.stop());
	const hostAddress = await host.start();
	const hostEndpoint = `http://${hostAddress.host}:${hostAddress.port}`;
	const hostPending = callHost(hostEndpoint, roles.dev, "localDev", {
		operation: "read",
		input: { path: "package.json" },
	});
	const hostCommand = await consumeOne(bridge.endpoint);
	const hostResult = await hostPending;
	assert.equal(
		hostResult.response.status,
		200,
		`Host Direct Tool failed: ${JSON.stringify(hostResult.body)}`,
	);
	assert.equal(hostCommand.tool, "localDev");
	assert.equal(hostCommand.operation, "read");

	// Reproduce the exact Gateway-process downstream envelope before testing
	// public ingress. This pins failures to the process wrapper vs Host boundary.
	const wrappedPending = fetch(new URL("/actions/localDev", hostEndpoint), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			authenticatedRoleRef: roles.dev,
			input: { operation: "read", input: { path: "package.json" } },
			deadlineAt: new Date(Date.now() + 30_000).toISOString(),
		}),
	});
	const wrappedCommand = await consumeOne(bridge.endpoint);
	const wrappedResponse = await wrappedPending;
	const wrappedBody = (await wrappedResponse.json()) as Record<string, unknown>;
	assert.equal(
		wrappedResponse.status,
		200,
		`Gateway-shaped Host envelope failed: ${JSON.stringify(wrappedBody)}`,
	);
	assert.equal(wrappedCommand.operation, "read");

	const credentialFile = join(root, "gateway-roles.json");
	const devToken = "dev-gateway-credential-long-enough";
	const testToken = "test-gateway-credential-long-enough";
	await writeFile(
		credentialFile,
		JSON.stringify({ [roles.dev]: devToken, [roles.test]: testToken }),
		{ mode: 0o600 },
	);
	const gateway = await createAgentGatewayProcess({
		config: {
			host: "127.0.0.1",
			port: 0,
			publicBaseUrl: "https://gateway.example.test",
			downstreamBaseUrl: `http://${hostAddress.host}:${hostAddress.port}`,
			credentialFile,
		},
	});
	context.after(() => gateway.stop());
	const gatewayAddress = await gateway.start();
	const endpoint = `http://${gatewayAddress.host}:${gatewayAddress.port}`;

	const pending = callGateway(endpoint, devToken, "localDev", {
		operation: "read",
		input: { path: "package.json" },
	});
	const first = await Promise.race([
		pending.then((result) => ({ kind: "response" as const, result })),
		consumeOne(bridge.endpoint).then((command) => ({
			kind: "command" as const,
			command,
		})),
	]);
	if (first.kind === "response")
		assert.fail(
			`Gateway returned before Extension Effect Gate: ${first.result.response.status} ${JSON.stringify(first.result.body)}`,
		);
	const command = first.command;
	const result = await pending;
	assert.equal(result.response.status, 200);
	assert.deepEqual(result.body, {
		files: [{ path: "/virtual/package.json", content: "{}" }],
	});
	assert.equal(command.authenticatedRoleRef, roles.dev);
	assert.equal(command.workspaceRoot, workspaceRoot);
	assert.equal(command.tool, "localDev");
	assert.equal(command.operation, "read");
	for (const forbidden of [
		"taskId",
		"nodeId",
		"runNo",
		"workerRef",
		"executionRef",
	])
		assert.equal(Object.hasOwn(command, forbidden), false, forbidden);
	assert.equal(seen.length, 3);

	const denied = await callGateway(endpoint, testToken, "localDev", {
		operation: "mutate",
		input: { action: "write", path: "x", content: "y" },
	});
	assert.equal(denied.response.status, 403);
	const injected = await callGateway(endpoint, devToken, "localDev", {
		operation: "read",
		input: { path: "package.json", nested: { taskId: "forged" } },
	});
	assert.equal(injected.response.status, 400);
});
