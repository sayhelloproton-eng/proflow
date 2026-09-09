import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { promisify } from "node:util";
import { createFormalExecutionRuntimeLifecycle } from "../src/formal-process.ts";
import {
	createExecutionRuntimeProcess,
	parseExecutionRuntimeProcessConfig,
} from "../src/service.ts";

test("Real3 F09 observer page reaches 101, isolates diagnostic reads and closes each cycle under arrivals", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-observer-page-"));
	await promisify(execFile)("git", ["init", "-q"], { cwd: root });
	await writeFile(join(root, "package.json"), '{"name":"fixture"}');
	await writeFile(join(root, "value.txt"), "page fixture");
	const config = parseExecutionRuntimeProcessConfig({
		databasePath: join(root, ".proflow", "execution.sqlite"),
		projectRoot: root,
		artifactRoot: join(root, ".proflow", "artifacts"),
	});
	const service = await createExecutionRuntimeProcess({ config });
	let database: DatabaseSync | undefined;
	try {
		const address = await service.start();
		const endpoint = `http://${address.host}:${address.port}`;
		const post = async (
			path: string,
			input: unknown,
		): Promise<Record<string, unknown>> => {
			const response = await fetch(`${endpoint}${path}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(input),
			});
			assert.equal(response.status, 200);
			const value: unknown = await response.json();
			assert.ok(
				typeof value === "object" && value !== null && !Array.isArray(value),
			);
			return value as Record<string, unknown>;
		};
		const execution = await post("/executions", {
			contract: "execution",
			contractVersion: "1.0.0",
			callerRef: "caller:pagination",
			idempotencyKey: "read:pagination",
			projectRoot: root,
			capability: "file.read",
			input: { path: "value.txt" },
		});
		assert.equal(execution.status, "SUCCEEDED");
		assert.equal(typeof execution.executionRef, "string");
		database = new DatabaseSync(config.databasePath);
		const insert = database.prepare(
			"INSERT INTO execution_observer_signals(signal_ref,execution_ref,kind,record_json,created_at,acknowledged_at) VALUES (?,?,?,?,?,NULL)",
		);
		const seed = (index: number) => {
			const signalRef = `signal:${String(index).padStart(3, "0")}`;
			const createdAt = "2026-09-10T00:00:00.000Z";
			const record = {
				signalRef,
				kind: "RECOVERY_RESUME",
				executionRef: execution.executionRef,
				taskId: "task:page",
				nodeId: "node:page",
				runNo: 1,
				workerRef: "c-page",
				createdAt,
			};
			insert.run(
				signalRef,
				String(execution.executionRef),
				record.kind,
				JSON.stringify(record),
				createdAt,
			);
		};
		for (let index = 1; index <= 101; index += 1) seed(index);
		const refs = async (consumer?: string) => {
			const body = await post("/observer-signals/list", {
				limit: 100,
				...(consumer ? { consumer } : {}),
			});
			assert.ok(Array.isArray(body.signals));
			return body.signals.map((value: unknown) => {
				assert.ok(typeof value === "object" && value !== null);
				return String(Reflect.get(value, "signalRef"));
			});
		};
		assert.equal((await refs("task-reconciliation")).at(-1), "signal:100");
		seed(102);
		assert.equal(
			(await refs()).length,
			100,
			"diagnostic reads retain ordinary list semantics",
		);
		assert.deepEqual(await refs("task-reconciliation"), ["signal:101"]);
		assert.equal(
			(await refs("task-reconciliation"))[0],
			"signal:001",
			"new arrivals cannot prevent cycle wrap",
		);
		assert.deepEqual(await refs("task-reconciliation"), [
			"signal:101",
			"signal:102",
		]);
		assert.equal(
			database
				.prepare(
					"SELECT COUNT(*) AS count FROM execution_observer_signals WHERE acknowledged_at IS NULL",
				)
				.get()?.count,
			102,
		);
	} finally {
		database?.close();
		await service.stop();
		await rm(root, { recursive: true, force: true });
	}
});

test("Real3 F14 standalone config retains its distinct task application resolver and rejects invalid endpoints", () => {
	const base = {
		databasePath: "/tmp/real3.db",
		projectRoot: "/tmp",
		artifactRoot: "/tmp/artifacts",
	};
	const platformHost = {
		endpoint: "http://127.0.0.1:47830",
		tokenFile: "/tmp/task-application.token",
	};
	const config = parseExecutionRuntimeProcessConfig({
		...base,
		platformHost,
		identity: {
			endpoint: platformHost.endpoint,
			tokenFile: "/tmp/execution-identity.token",
		},
	});
	assert.deepEqual(config.platformHost, platformHost);
	assert.notEqual(config.platformHost?.tokenFile, config.identity?.tokenFile);
	for (const endpoint of [
		"https://example.com",
		"http://127.0.0.1:47830/private",
		"http://user:pass@127.0.0.1:47830",
	])
		assert.throws(
			() =>
				parseExecutionRuntimeProcessConfig({
					...base,
					platformHost: { ...platformHost, endpoint },
				}),
			/loopback HTTP root/,
		);
	assert.throws(
		() =>
			parseExecutionRuntimeProcessConfig({
				...base,
				platformHost: { ...platformHost, tokenFile: "relative.token" },
			}),
		/absolute/,
	);
	const formalConfig = {
		...config,
		transportCredentialFile: "/tmp/transport.token",
		browserExecutorConfigPath: "/tmp/browser.json",
	};
	assert.doesNotThrow(() =>
		createFormalExecutionRuntimeLifecycle({ config: formalConfig }),
	);
	const { platformHost: _platformHost, ...missingHost } = formalConfig;
	assert.throws(
		() => createFormalExecutionRuntimeLifecycle({ config: missingHost }),
		/requires platformHost or resolveDependencies/,
	);
	assert.doesNotThrow(() =>
		createFormalExecutionRuntimeLifecycle({
			config: missingHost,
			resolveDependencies: async () => ({ platformHost }),
		}),
	);
});
