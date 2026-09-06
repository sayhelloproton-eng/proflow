import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAgentGatewayProcess } from "../src/process.ts";

test("CP-AGT-GW-14/RF-AGT-GW-14 formal agent-gateway process authenticates downstream transport, routes, reports readiness, drains and restarts", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-gateway-process-"));
	const credentialFile = join(root, "credentials.json");
	await writeFile(
		credentialFile,
		JSON.stringify({ "role:product": "credential-long-enough-value" }),
		{ mode: 0o600 },
	);
	const downstreamCredentialFile = join(root, "downstream.token");
	const downstreamCredential = "downstream-transport-credential-value";
	await writeFile(downstreamCredentialFile, `${downstreamCredential}\n`, {
		mode: 0o600,
	});
	const downstream = createServer(async (request, response) => {
		assert.equal(
			request.headers.authorization,
			`Bearer ${downstreamCredential}`,
		);
		response.setHeader("content-type", "application/json");
		if (request.url === "/ready") return response.end('{"status":"READY"}');
		const chunks: Buffer[] = [];
		for await (const chunk of request)
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		response.end(
			JSON.stringify({
				path: request.url,
				body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
			}),
		);
	});
	await new Promise<void>((resolveListen) =>
		downstream.listen(0, "127.0.0.1", resolveListen),
	);
	const address = downstream.address();
	if (!address || typeof address === "string")
		assert.fail("missing downstream");
	const logs: Record<string, unknown>[] = [];
	const gateway = await createAgentGatewayProcess({
		config: {
			host: "127.0.0.1",
			port: 0,
			publicBaseUrl: "https://gateway.example",
			downstreamBaseUrl: `http://127.0.0.1:${address.port}`,
			credentialFile,
			downstreamCredentialFile,
		},
		log: (entry) => logs.push(entry),
	});
	try {
		const first = await gateway.start();
		assert.equal((await gateway.readiness()).status, "READY");
		const result = (await fetch(
			`http://${first.host}:${first.port}/actions/getTask`,
			{
				method: "POST",
				headers: {
					authorization: "Bearer credential-long-enough-value",
					"content-type": "application/json",
				},
				body: JSON.stringify({ taskId: "task:1", roleRef: "spoof" }),
			},
		).then((response) => response.json())) as {
			body: { authenticatedRoleRef: string; input: unknown };
		};
		assert.equal(result.body.authenticatedRoleRef, "role:product");
		assert.deepEqual(result.body.input, { taskId: "task:1" });
		const second = await gateway.restart();
		assert.equal(
			(await fetch(`http://${second.host}:${second.port}/ready`)).status,
			200,
		);
		await gateway.stop();
		assert.equal(gateway.status().process, "STOPPED");
		assert.deepEqual(
			logs.map((entry) => entry.event),
			[
				"SERVICE_STARTED",
				"SERVICE_STOPPED",
				"SERVICE_STARTED",
				"SERVICE_STOPPED",
			],
		);
	} finally {
		await gateway.stop();
		downstream.close();
	}
});

test("B2-GW-02 running gateway consumes current credential authority and fails closed on malformed store", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-gateway-rotate-"));
	const credentialFile = join(root, "credentials.json");
	const oldKey = "old-credential-value-long";
	const newKey = "new-credential-value-long";
	await writeFile(credentialFile, JSON.stringify({ "role:product": oldKey }), {
		mode: 0o600,
	});
	const downstreamCredentialFile = join(root, "downstream.token");
	const downstreamCredential = "downstream-transport-credential-value";
	await writeFile(downstreamCredentialFile, `${downstreamCredential}\n`, {
		mode: 0o600,
	});
	const downstream = createServer(async (request, response) => {
		assert.equal(
			request.headers.authorization,
			`Bearer ${downstreamCredential}`,
		);
		response.setHeader("content-type", "application/json");
		if (request.url === "/ready") return response.end('{"status":"READY"}');
		const chunks: Buffer[] = [];
		for await (const chunk of request)
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		response.end(
			JSON.stringify({
				body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
			}),
		);
	});
	await new Promise<void>((resolveListen) =>
		downstream.listen(0, "127.0.0.1", resolveListen),
	);
	const address = downstream.address();
	if (!address || typeof address === "string")
		assert.fail("missing downstream");
	const logs: Record<string, unknown>[] = [];
	const gateway = await createAgentGatewayProcess({
		config: {
			host: "127.0.0.1",
			port: 0,
			publicBaseUrl: "https://gateway.example",
			downstreamBaseUrl: `http://127.0.0.1:${address.port}`,
			credentialFile,
			downstreamCredentialFile,
		},
		log: (entry) => logs.push(entry),
	});
	const auth = (baseUrl: string, credential: string) =>
		fetch(`${baseUrl}/actions/getTask`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${credential}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ taskId: "task:1" }),
		});
	try {
		const { host, port } = await gateway.start();
		const baseUrl = `http://${host}:${port}`;
		const roleOf = (response: Response) =>
			response.json() as Promise<{
				body: { authenticatedRoleRef: string };
			}>;

		assert.equal((await auth(baseUrl, oldKey)).status, 200);
		assert.equal(
			(await roleOf(await auth(baseUrl, oldKey))).body.authenticatedRoleRef,
			"role:product",
		);

		await writeFile(
			credentialFile,
			JSON.stringify({ "role:product": newKey }),
			{ mode: 0o600 },
		);

		assert.equal((await auth(baseUrl, newKey)).status, 200);
		assert.equal(
			(await roleOf(await auth(baseUrl, newKey))).body.authenticatedRoleRef,
			"role:product",
		);
		assert.equal((await auth(baseUrl, oldKey)).status, 401);

		await writeFile(credentialFile, "{ not-valid json", { mode: 0o600 });
		assert.equal((await auth(baseUrl, newKey)).status, 401);
		assert.equal((await auth(baseUrl, oldKey)).status, 401);

		await writeFile(
			credentialFile,
			JSON.stringify({ "role:product": newKey }),
			{ mode: 0o600 },
		);
		assert.equal((await auth(baseUrl, newKey)).status, 200);
		assert.equal((await auth(baseUrl, oldKey)).status, 401);

		assert.ok(
			!logs.some(
				(entry) =>
					JSON.stringify(entry).includes(oldKey) ||
					JSON.stringify(entry).includes(newKey),
			),
		);
	} finally {
		await gateway.stop();
		downstream.close();
	}
});

test("RF-AGT-GW-14 downstream transport credential rejects group/world-readable files", async (t) => {
	if (process.platform === "win32") return t.skip("POSIX mode proof");
	const root = await mkdtemp(
		join(tmpdir(), "proflow-agent-gateway-permissions-"),
	);
	t.after(() => rm(root, { recursive: true, force: true }));
	const credentialFile = join(root, "credentials.json");
	const downstreamCredentialFile = join(root, "downstream.token");
	await writeFile(
		credentialFile,
		JSON.stringify({ "role:product": "credential-long-enough-value" }),
		{ mode: 0o600 },
	);
	await writeFile(
		downstreamCredentialFile,
		"downstream-transport-credential-value\n",
		{ mode: 0o600 },
	);
	await chmod(downstreamCredentialFile, 0o644);
	await assert.rejects(
		() =>
			createAgentGatewayProcess({
				config: {
					host: "127.0.0.1",
					port: 0,
					publicBaseUrl: "https://gateway.example.test",
					downstreamBaseUrl: "http://127.0.0.1:47830",
					credentialFile,
					downstreamCredentialFile,
				},
			}),
		/DOWNSTREAM_TRANSPORT_CREDENTIAL_PERMISSIONS_INVALID/,
	);
});

test("B1-GW-01 downstream typed errors are bounded, safe, and preserve actionable owner codes", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-gateway-errors-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const credentialFile = join(root, "credentials.json");
	await writeFile(
		credentialFile,
		JSON.stringify({ "g-dev": "gateway-role-credential-long-enough" }),
		{ mode: 0o600 },
	);
	const downstream = createServer((request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.url === "/ready") return response.end('{"status":"READY"}');
		if (request.url === "/actions/invalid") {
			response.statusCode = 400;
			return response.end(
				JSON.stringify({ error: "INVALID_REQUEST", stack: "SECRET_STACK" }),
			);
		}
		if (request.url === "/actions/admission") {
			response.statusCode = 403;
			return response.end(
				JSON.stringify({
					error: "TASK_ROLE_BINDING_REQUIRED",
					credential: "SECRET_TOKEN",
				}),
			);
		}
		if (request.url === "/actions/failure") {
			response.statusCode = 500;
			return response.end(
				JSON.stringify({
					error: "SQLITE_PASSWORD_secret",
					stack: "SECRET_STACK",
				}),
			);
		}
		response.statusCode = 418;
		return response.end("not-json SECRET_TOKEN");
	});
	await new Promise<void>((resolve) =>
		downstream.listen(0, "127.0.0.1", resolve),
	);
	context.after(
		() => new Promise<void>((resolve) => downstream.close(() => resolve())),
	);
	const address = downstream.address();
	if (!address || typeof address === "string")
		assert.fail("missing downstream");
	const gateway = await createAgentGatewayProcess({
		config: {
			host: "127.0.0.1",
			port: 0,
			publicBaseUrl: "https://gateway.example.test",
			downstreamBaseUrl: `http://127.0.0.1:${address.port}`,
			credentialFile,
		},
	});
	context.after(() => gateway.stop());
	const started = await gateway.start();
	const call = async (operation: string) => {
		const response = await fetch(
			`http://${started.host}:${started.port}/actions/${operation}`,
			{
				method: "POST",
				headers: {
					authorization: "Bearer gateway-role-credential-long-enough",
					"content-type": "application/json",
				},
				body: "{}",
			},
		);
		return { status: response.status, text: await response.text() };
	};
	const invalid = await call("invalid");
	assert.equal(invalid.status, 400);
	assert.deepEqual(JSON.parse(invalid.text), { error: "INVALID_REQUEST" });
	const admission = await call("admission");
	assert.equal(admission.status, 403);
	assert.deepEqual(JSON.parse(admission.text), {
		error: "TASK_ROLE_BINDING_REQUIRED",
	});
	const failure = await call("failure");
	assert.equal(failure.status, 500);
	assert.deepEqual(JSON.parse(failure.text), {
		error: "OWNER_SERVICE_UNAVAILABLE",
	});
	const malformed = await call("malformed");
	assert.equal(malformed.status, 418);
	assert.deepEqual(JSON.parse(malformed.text), {
		error: "DOWNSTREAM_UNAVAILABLE",
	});
	for (const result of [invalid, admission, failure, malformed]) {
		assert.doesNotMatch(result.text, /SECRET|STACK|TOKEN|PASSWORD/i);
		assert.ok(result.text.length < 256);
	}
});
