import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { behaviorAdapter, taskDatabasePath } from "../deployment/adapter.ts";

const TABLES = [
	"schema_migrations",
	"task_groups",
	"tasks",
	"nodes",
	"task_role_bindings",
	"node_execution_history",
	"task_documents",
	"task_messages",
	"task_events",
	"idempotency_records",
];

test("task-store Module.status verifies canonical SQLite integrity and schema", async () => {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-task-store-deploy-"),
	);
	const context = { workspaceRoot };
	const databasePath = taskDatabasePath(context);
	try {
		await behaviorAdapter.install(context);
		const incomplete = await behaviorAdapter.status(context);
		assert.equal(incomplete.result.data.setupStatus, "FAILED");

		const db = new DatabaseSync(databasePath);
		try {
			for (const table of TABLES)
				db.exec(`CREATE TABLE ${table} (id INTEGER);`);
		} finally {
			db.close();
		}
		const ready = await behaviorAdapter.status(context);
		assert.deepEqual(ready.result.data, {
			setupStatus: "READY",
			runtimeStatus: "NOT_APPLICABLE",
		});
		assert.equal(
			(await behaviorAdapter.setup(context)).result.status,
			"SUCCEEDED",
		);
	} finally {
		await rm(workspaceRoot, { recursive: true, force: true });
	}
});
