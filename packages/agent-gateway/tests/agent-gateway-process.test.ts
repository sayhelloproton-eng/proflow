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
