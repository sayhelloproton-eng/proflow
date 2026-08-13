import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
	applyMigrations,
	verifyMigrations,
} from "@tomflow/proflow-task-migration-runner";
import { SqliteTaskStore, taskMigrations } from "../src/index.ts";

const execFileAsync = promisify(execFile);

async function databaseFixture(context: {
	after: (fn: () => unknown) => void;
}) {
	const root = await mkdtemp(join(tmpdir(), "proflow-task-store-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const databasePath = join(root, "task.sqlite");
	assert.equal(
		applyMigrations({ databasePath, migrations: taskMigrations }).ok,
		true,
	);
	return { root, databasePath };
}

test("CP-TASK-STORE-01 fresh real SQLite has the frozen tables, constraints, and indexes", async (context) => {
	const { databasePath } = await databaseFixture(context);
	const store = new SqliteTaskStore({ databasePath });
	context.after(() => store.close());
	const schema = store.inspectSchema();
	assert.deepEqual(schema.tables, [
		"idempotency_records",
		"node_execution_history",
		"nodes",
		"schema_migrations",
		"task_documents",
		"task_events",
		"task_groups",
		"task_messages",
		"task_role_bindings",
		"tasks",
	]);
	assert.equal(
		schema.foreignKeys.task_role_bindings?.includes("tasks.task_id"),
		true,
	);
	assert.equal(schema.indexes.includes("idx_nodes_task_sequence"), true);
	assert.equal(schema.indexes.includes("idx_events_task"), true);
	assert.deepEqual(schema.columns.task_documents, [
		"task_id",
		"document_type",
		"source_node_id",
		"file_path",
		"content_hash",
		"updated_by_ref",
		"updated_at",
	]);
	const ddl = taskMigrations.map((item) => item.sql).join("\n");
	assert.match(ddl, /CHECK \(max_active_tasks = 1\)/);
	assert.match(ddl, /UNIQUE\(task_id, sequence_no\)/);
});

test("CP-TASK-STORE-02 transaction rollback and optimistic conflict leave no partial facts", async (context) => {
	const { databasePath } = await databaseFixture(context);
	const store = new SqliteTaskStore({ databasePath });
	context.after(() => store.close());
	assert.throws(() =>
		store.transaction((tx) => {
			tx.taskGroups.insert({
				taskGroupId: "tg-rollback",
				title: "Rollback",
				objective: null,
				status: "READY",
				maxActiveTasks: 1,
				version: 1,
				createdByRef: "actor:test",
				createdAt: "2026-08-13T00:00:00.000Z",
				updatedAt: "2026-08-13T00:00:00.000Z",
			});
			throw new Error("injected");
		}),
	);
	assert.equal(
		store.read((tx) => tx.taskGroups.get("tg-rollback")),
		undefined,
	);
	const baseline = {
		taskGroupId: "tg-version",
		title: "Version",
		objective: null,
		status: "READY" as const,
		maxActiveTasks: 1 as const,
		version: 1,
		createdByRef: "actor:test",
		createdAt: "2026-08-13T00:00:00.000Z",
		updatedAt: "2026-08-13T00:00:00.000Z",
	};
	store.transaction((tx) => tx.taskGroups.insert(baseline));
	store.transaction((tx) =>
		tx.taskGroups.update({ ...baseline, title: "Committed", version: 2 }),
	);
	assert.throws(() =>
		store.transaction((tx) =>
			tx.taskGroups.update({ ...baseline, title: "Stale", version: 2 }),
		),
	);
	assert.equal(
		store.read((tx) => tx.taskGroups.get(baseline.taskGroupId))?.title,
		"Committed",
	);
});

test("CP-TASK-STORE-03 public repository ports do not expose SQL rows or DatabaseSync", async (context) => {
	const { databasePath } = await databaseFixture(context);
	const store = new SqliteTaskStore({ databasePath });
	context.after(() => store.close());
	assert.deepEqual(Object.keys(store).sort(), []);
	const publicMethods = Object.getOwnPropertyNames(
		Object.getPrototypeOf(store),
	);
	assert.equal(publicMethods.includes("prepare"), false);
	assert.equal(publicMethods.includes("exec"), false);
	assert.equal(publicMethods.includes("database"), false);
});

test("CP-TASK-STORE-04 WAL, busy timeout, constraints, integrity, close and reopen are real", async (context) => {
	const { databasePath } = await databaseFixture(context);
	let store = new SqliteTaskStore({ databasePath, busyTimeoutMs: 2_500 });
	assert.equal(store.diagnostics().journalMode, "wal");
	assert.equal(store.diagnostics().busyTimeoutMs, 2_500);
	assert.equal(store.diagnostics().integrity, "ok");
	store.close();
	store = new SqliteTaskStore({ databasePath, busyTimeoutMs: 2_500 });
	context.after(() => store.close());
	assert.equal(store.diagnostics().integrity, "ok");
	assert.equal(
		verifyMigrations({ databasePath, migrations: taskMigrations }).ok,
		true,
	);
});

test("CP-TASK-STORE-05 same/same idempotency replays and concurrent same/different is unique", async (context) => {
	const { databasePath } = await databaseFixture(context);
	const first = new SqliteTaskStore({ databasePath, busyTimeoutMs: 2_500 });
	const second = new SqliteTaskStore({ databasePath, busyTimeoutMs: 2_500 });
	context.after(() => first.close());
	context.after(() => second.close());
	const record = {
		idempotencyKey: "idem:one",
		operation: "createTaskGroup",
		requestHash: "sha256:one",
		responseJson: '{"ok":true}',
		createdAt: "2026-08-13T00:00:00.000Z",
	};
	first.transaction((tx) => tx.idempotency.insert(record));
	assert.deepEqual(
		second.read((tx) => tx.idempotency.get("idem:one")),
		record,
	);
	assert.throws(() =>
		second.transaction((tx) => tx.idempotency.insert(record)),
	);
	assert.equal(first.inspectCounts().idempotency_records, 1);
});

test("remediation T04 abnormal exit reopens and real concurrent writers preserve one idempotency fact", async (context) => {
	const { databasePath } = await databaseFixture(context);
	const storeUrl = new URL("../src/index.ts", import.meta.url).href;
	const crashScript = `
		import { SqliteTaskStore } from ${JSON.stringify(storeUrl)};
		const store = new SqliteTaskStore({ databasePath: process.argv[1] });
		store.transaction((tx) => tx.idempotency.insert({ idempotencyKey: "crash", operation: "test", requestHash: "hash", responseJson: "{}", createdAt: "now" }));
		process.exit(0);
	`;
	await execFileAsync(process.execPath, [
		"--input-type=module",
		"-e",
		crashScript,
		databasePath,
	]);
	const reopened = new SqliteTaskStore({ databasePath });
	assert.equal(
		reopened.read((tx) => tx.idempotency.get("crash"))?.requestHash,
		"hash",
	);
	reopened.close();

	const writerScript = `
		import { SqliteTaskStore } from ${JSON.stringify(storeUrl)};
		let store;
		try {
			store = new SqliteTaskStore({ databasePath: process.argv[1], busyTimeoutMs: 2500 });
			store.transaction((tx) => tx.idempotency.insert({ idempotencyKey: "concurrent", operation: "test", requestHash: process.argv[2], responseJson: "{}", createdAt: "now" }));
			store.close();
			process.stdout.write("committed");
		} catch (error) {
			store?.close();
			process.stdout.write("rejected");
		}
	`;
	const results = await Promise.all([
		execFileAsync(process.execPath, [
			"--input-type=module",
			"-e",
			writerScript,
			databasePath,
			"left",
		]),
		execFileAsync(process.execPath, [
			"--input-type=module",
			"-e",
			writerScript,
			databasePath,
			"right",
		]),
	]);
	assert.deepEqual(results.map((result) => result.stdout).sort(), [
		"committed",
		"rejected",
	]);
	const final = new SqliteTaskStore({ databasePath });
	assert.equal(final.inspectCounts().idempotency_records, 2);
	final.close();
});
