import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyMigrations } from "@tomflow/proflow-task-migration-runner";
import { SqliteTaskStore, taskMigrations } from "../src/index.ts";

test("Real3 F12 SQLite filters and pages Task IDs at the store boundary", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-task-page-"));
	const databasePath = join(root, "tasks.sqlite");
	assert.equal(
		applyMigrations({ databasePath, migrations: taskMigrations }).ok,
		true,
	);
	const store = new SqliteTaskStore({ databasePath });
	try {
		store.transaction((repositories) => {
			for (let index = 1; index <= 102; index += 1)
				repositories.tasks.insert({
					taskId: `task:${String(index).padStart(3, "0")}`,
					taskGroupId: null,
					sequenceNo: null,
					title: "page",
					objective: "page",
					status: index === 102 ? "SUCCEEDED" : "PENDING",
					version: 1,
					planVersion: 1,
					currentNodeId: null,
					createdByRef: "actor:test",
					createdAt: "2026-09-10T00:00:00.000Z",
					startedAt: null,
					completedAt: null,
					updatedAt: "2026-09-10T00:00:00.000Z",
				});
		});
		const first = store.listReconciliationTaskIds({
			statuses: ["PENDING"],
			limit: 100,
		});
		assert.equal(first.taskIds.length, 100);
		assert.equal(first.nextAfterTaskId, "task:100");
		const second = store.listReconciliationTaskIds({
			statuses: ["PENDING"],
			afterTaskId: "task:100",
			limit: 100,
		});
		assert.deepEqual(second, { taskIds: ["task:101"] });
		assert.deepEqual(
			store.listReconciliationTaskIds({
				statuses: ["PENDING"],
				afterTaskId: "task:999",
				limit: 100,
			}),
			{ taskIds: [] },
		);
		assert.deepEqual(
			store.listReconciliationTaskIds({ statuses: [], limit: 100 }),
			{ taskIds: [] },
		);
		assert.throws(
			() =>
				store.listReconciliationTaskIds({
					statuses: ["PENDING"],
					limit: Number.NaN,
				}),
			/finite/,
		);
	} finally {
		store.close();
		await rm(root, { recursive: true, force: true });
	}
});
