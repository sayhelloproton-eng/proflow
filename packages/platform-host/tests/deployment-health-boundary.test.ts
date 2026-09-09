import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeModuleSharedFacts } from "@tomflow/proflow-module-contract";
import { behaviorAdapter as host } from "../deployment/adapter.ts";
import { behaviorAdapter as execution } from "@tomflow/proflow-execution-runtime/deployment/adapter";
import { behaviorAdapter as gateway } from "@tomflow/proflow-agent-gateway/deployment/adapter";

test("Real3 F13 all three deployment adapters use health liveness beyond the old 500ms budget", async () => {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-health-adapters-"),
	);
	const paths: string[] = [];
	const server = createServer((request, response) => {
		paths.push(request.url ?? "");
		setTimeout(() => {
			response.writeHead(request.url === "/health" ? 200 : 503, {
				"content-type": "application/json",
			});
			response.end(
				JSON.stringify({
					status: request.url === "/health" ? "UP" : "NOT_READY",
				}),
			);
		}, 650);
	});
	try {
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		assert.ok(address && typeof address !== "string");
		const endpoint = `http://127.0.0.1:${address.port}`;
		const context = { workspaceRoot };
		await writeModuleSharedFacts(context, "platform-host", { endpoint });
		await writeModuleSharedFacts(context, "agent-gateway", {
			localBaseUrl: endpoint,
		});
		await writeModuleSharedFacts(context, "execution-runtime", {
			endpoint,
			transportCredentialFile: join(workspaceRoot, "absent.token"),
			databasePath: join(workspaceRoot, "absent.sqlite"),
			projectRoot: workspaceRoot,
			artifactRoot: join(workspaceRoot, "artifacts"),
		});
		const results = await Promise.all([
			host.status(context),
			execution.status(context),
			gateway.status(context),
		]);
		for (const result of results)
			assert.equal(result.result.data.runtimeStatus, "RUNNING");
		assert.deepEqual(paths, ["/health", "/health", "/health"]);
	} finally {
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
		await rm(workspaceRoot, { recursive: true, force: true });
	}
});
