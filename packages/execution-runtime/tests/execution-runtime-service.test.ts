import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { createExecutionRuntimeProcess } from "../src/service.ts";

const exec = promisify(execFile);

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "proflow-execution-service-"));
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({ name: "fixture" }),
	);
	await writeFile(join(root, "value.txt"), "real-service");
	await exec("git", ["init", "-q"], { cwd: root });
	return {
		root,
		config: {
			databasePath: join(root, ".proflow", "execution.sqlite"),
			projectRoot: root,
			artifactRoot: join(root, ".proflow", "artifacts"),
			host: "127.0.0.1",
			port: 0,
			exactNetworkTargets: [],
		},
	};
}

test("formal execution-runtime process starts, routes, drains, reopens and stops", async () => {
	const { config } = await fixture();
	const logs: Record<string, unknown>[] = [];
	const service = await createExecutionRuntimeProcess({
		config,
		log: (entry) => logs.push(entry),
	});
	const first = await service.start();
	assert.equal(service.status().readiness, "READY");
	assert.equal(
		(await fetch(`http://${first.host}:${first.port}/ready`)).status,
		200,
	);
	const created = (await fetch(
		`http://${first.host}:${first.port}/executions`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				contract: "execution",
				contractVersion: "1.0.0",
				callerRef: "caller:service",
				idempotencyKey: "read-once",
				projectRoot: config.projectRoot,
				capability: "file.read",
				input: { path: "value.txt" },
			}),
		},
	).then((response) => response.json())) as {
		executionRef: string;
		status: string;
	};
	assert.equal(created.status, "SUCCEEDED");
	const second = await service.restart();
	const reopened = (await fetch(
		`http://${second.host}:${second.port}/executions/${encodeURIComponent(created.executionRef)}`,
	).then((response) => response.json())) as { status: string };
	assert.equal(reopened.status, "SUCCEEDED");
	await service.stop();
	assert.equal(service.status().process, "STOPPED");
	assert.deepEqual(
		logs.map((entry) => entry.event),
		[
			"SERVICE_STARTED",
			"SERVICE_STOPPED",
			"SERVICE_STARTED",
			"SERVICE_STOPPED",
		],
	);
});
