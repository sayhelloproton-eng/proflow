import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAgentGatewayProcess } from "../src/process.ts";

test("formal agent-gateway process loads credentials, routes, reports readiness, drains and restarts", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-gateway-process-"));
	const credentialFile = join(root, "credentials.json");
	await writeFile(
		credentialFile,
		JSON.stringify({ "role:product": "credential-long-enough-value" }),
		{ mode: 0o600 },
	);
	const downstream = createServer(async (request, response) => {
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
