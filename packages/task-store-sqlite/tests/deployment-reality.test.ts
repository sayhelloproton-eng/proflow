import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { createProductionBinding } from "../deployment/adapter.ts";

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

test("task-store production binding verifies real SQLite integrity and schema", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-task-store-deploy-"));
	const databasePath = join(root, "task.sqlite");
	try {
		const db = new DatabaseSync(databasePath);
		try {
			for (const table of TABLES)
				db.exec(`CREATE TABLE ${table} (id INTEGER);`);
		} finally {
			db.close();
		}
		const binding = createProductionBinding({ config: { databasePath } });
		const verify = (
			binding.behaviorAdapter.verify as () => {
				result: { status: string; checks?: Array<{ status: string }> };
			}
		)();
		assert.equal(verify.result.status, "SUCCEEDED");
		assert.equal(verify.result.checks?.[0]?.status, "PASS");

		const missing = createProductionBinding({
			config: { databasePath: join(root, "missing.sqlite") },
		});
		const missingVerify = (
			missing.behaviorAdapter.verify as () => { result: { status: string } }
		)();
		assert.equal(missingVerify.result.status, "BLOCKED");

		const unconfigured = createProductionBinding({ config: {} });
		const unconfiguredVerify = (
			unconfigured.behaviorAdapter.verify as () => {
				result: { status: string };
			}
		)();
		assert.equal(unconfiguredVerify.result.status, "ACTION_REQUIRED");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
