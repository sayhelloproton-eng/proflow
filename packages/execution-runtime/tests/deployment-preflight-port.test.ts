import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { createProductionBinding } from "../deployment/adapter.ts";

function close(server: ReturnType<typeof createServer>) {
	return new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
}

async function occupiedPort() {
	const server = createServer((_request, response) => {
		response.statusCode = 404;
		response.end("occupied");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	return { server, port: address.port };
}

const configuredRuntime = {
	databasePath: "/tmp/proflow-fj07/execution.sqlite",
	projectRoot: "/tmp/proflow-fj07/project",
	artifactRoot: "/tmp/proflow-fj07/artifacts",
	browserExecutorConfigPath: "/tmp/proflow-fj07/browser.json",
	transportCredentialFile: "/tmp/proflow-fj07/transport.token",
	"identity.endpoint": "http://127.0.0.1:43101/",
	"identity.tokenFile": "/tmp/proflow-fj07/identity.token",
	"modelDecision.endpoint": "http://127.0.0.1:43102/",
	"modelDecision.credentialFile": "/tmp/proflow-fj07/model.token",
} as const;

test("FJ-07 preflight reports an occupied Execution Runtime listener before start", async () => {
	const occupied = await occupiedPort();
	try {
		const endpoint = `http://127.0.0.1:${occupied.port}/`;
		const binding = await createProductionBinding({
			moduleRef: "execution-runtime",
			config: { ...configuredRuntime, "identity.endpoint": endpoint },
			configByModuleRef: new Map([
				["platform-host", { executionBaseUrl: endpoint }],
			]),
		});
		assert.ok(binding);
		const adapter = binding.behaviorAdapter as {
			preflight(): Promise<{
				result: {
					status: string;
					actionRequired?: { action: string; description: string };
				};
			}>;
		};
		const blocked = await adapter.preflight();
		assert.equal(blocked.result.status, "ACTION_REQUIRED");
		assert.equal(
			blocked.result.actionRequired?.action,
			"free-execution-runtime-port",
		);
		assert.match(
			blocked.result.actionRequired?.description ?? "",
			new RegExp(String(occupied.port)),
		);
		await close(occupied.server);
		const ready = await adapter.preflight();
		assert.equal(ready.result.status, "SUCCEEDED");
	} finally {
		if (occupied.server.listening) await close(occupied.server);
	}
});

test("production binding preserves Execution Runtime own config truth while Platform Host is unavailable", async () => {
	const unbound = await createProductionBinding({
		moduleRef: "execution-runtime",
		config: configuredRuntime,
		configByModuleRef: new Map(),
	});
	const status = unbound.behaviorAdapter.status;
	assert.equal(typeof status, "function");
	const observed = (status as () => { result: { data: unknown } })();
	assert.deepEqual(observed.result.data, {
		configStatus: "READY",
		runtimeStatus: "UNKNOWN",
	});

	const invalid = await createProductionBinding({
		moduleRef: "execution-runtime",
		config: { ...configuredRuntime, "identity.endpoint": "not-a-url" },
		configByModuleRef: new Map(),
	});
	const invalidStatus = invalid.behaviorAdapter.status;
	assert.equal(typeof invalidStatus, "function");
	const invalidObserved = (
		invalidStatus as () => { result: { data: unknown } }
	)();
	assert.deepEqual(invalidObserved.result.data, {
		configStatus: "INVALID",
		runtimeStatus: "UNKNOWN",
	});
});
