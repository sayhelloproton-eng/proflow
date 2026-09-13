import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAgentGatewayProcess } from "../src/process.ts";

test("Gateway boundary logs do not manufacture UNKNOWN side-effect state", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-gateway-side-effect-log-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const credentialFile = join(root, "credentials.json");
	await writeFile(
		credentialFile,
		JSON.stringify({ "g-dev": "gateway-role-credential-long-enough" }),
		{ mode: 0o600 },
	);
	const downstream = createServer(async (request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.url === "/ready") return response.end('{"status":"READY"}');
		for await (const _chunk of request) {
		}
		response.end(JSON.stringify({ ok: true }));
	});
	await new Promise<void>((resolve) => downstream.listen(0, "127.0.0.1", resolve));
	context.after(() => new Promise<void>((resolve) => downstream.close(() => resolve())));
	const address = downstream.address();
	if (!address || typeof address === "string") assert.fail("missing downstream port");
	const operations: Array<Record<string, unknown>> = [];
	const gateway = await createAgentGatewayProcess({
		config: {
			host: "127.0.0.1",
			port: 0,
			publicBaseUrl: "https://gateway.example.test",
			downstreamBaseUrl: `http://127.0.0.1:${address.port}`,
			credentialFile,
		},
		operationLog: (entry) => operations.push(entry),
	});
	context.after(() => gateway.stop());
	const started = await gateway.start();
	const response = await fetch(`http://${started.host}:${started.port}/actions/localDev`, {
		method: "POST",
		headers: {
			authorization: "Bearer gateway-role-credential-long-enough",
			"content-type": "application/json",
		},
		body: JSON.stringify({ operation: "read_file", input: { path: "README.md" } }),
	});
	assert.equal(response.status, 200);
	await response.json();
	assert.equal(operations.length, 1);
	assert.equal(operations[0]?.status, "SUCCEEDED");
	assert.equal("sideEffectState" in (operations[0] ?? {}), false);
});
