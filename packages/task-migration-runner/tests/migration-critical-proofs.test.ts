import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { SqliteTaskStore } from "@tomflow/proflow-task-store-sqlite";
import { taskMigrations } from "@tomflow/proflow-task-store-sqlite/migrations";
import {
	applyMigrations,
	discoverMigrations,
	getMigrationStatus,
	runCli,
	verifyMigrations,
} from "../src/index.ts";

async function fixture(context: { after: (fn: () => unknown) => void }) {
	const root = await mkdtemp(join(tmpdir(), "proflow-task-migrations-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	return join(root, "task.sqlite");
}

test("CP-TASK-MIG-01 discovery ordering and version metadata are deterministic", () => {
	const firstMigration = taskMigrations[0];
	assert.ok(firstMigration);
	const reversed = [...taskMigrations].reverse();
	assert.deepEqual(discoverMigrations(reversed), discoverMigrations(reversed));
	assert.deepEqual(
		discoverMigrations(reversed).map((item) => item.version),
		[1, 2],
	);
	assert.throws(() => discoverMigrations([firstMigration, firstMigration]));
});

test("CP-TASK-MIG-02 duplicate apply is prevented and failed migration rolls back and stops", async (context) => {
	const databasePath = await fixture(context);
	const first = applyMigrations({ databasePath, migrations: taskMigrations });
	assert.equal(first.ok, true);
	assert.equal(first.applied.length, 2);
	const replay = applyMigrations({ databasePath, migrations: taskMigrations });
	assert.equal(replay.ok, true);
	assert.deepEqual(replay.applied, []);

	const failedPath = await fixture(context);
	const failure = applyMigrations({
		databasePath: failedPath,
		migrations: [
			{
				version: 1,
				name: "good",
				sql: "CREATE TABLE good(id TEXT PRIMARY KEY);",
			},
			{ version: 2, name: "bad", sql: "CREATE TABLE broken(" },
			{ version: 3, name: "never", sql: "CREATE TABLE never(id TEXT);" },
		],
	});
	assert.equal(failure.ok, false);
	const status = getMigrationStatus({
		databasePath: failedPath,
		migrations: [
			{
				version: 1,
				name: "good",
				sql: "CREATE TABLE good(id TEXT PRIMARY KEY);",
			},
			{ version: 2, name: "bad", sql: "CREATE TABLE broken(" },
			{ version: 3, name: "never", sql: "CREATE TABLE never(id TEXT);" },
		],
	});
	assert.deepEqual(status.appliedVersions, [1]);
	assert.deepEqual(status.pendingVersions, [2, 3]);
	const repaired = [
		{
			version: 1,
			name: "good",
			sql: "CREATE TABLE good(id TEXT PRIMARY KEY);",
		},
		{ version: 2, name: "recovered", sql: "CREATE TABLE recovered(id TEXT);" },
		{
			version: 3,
			name: "after_recovery",
			sql: "CREATE TABLE after_recovery(id TEXT);",
		},
	] as const;
	assert.equal(
		applyMigrations({ databasePath: failedPath, migrations: repaired }).ok,
		true,
	);
	assert.equal(
		verifyMigrations({ databasePath: failedPath, migrations: repaired }).ok,
		true,
	);
});

test("CP-TASK-MIG-03 fresh, sequential, and interrupted recovery converge to the same schema", async (context) => {
	const firstMigration = taskMigrations[0];
	assert.ok(firstMigration);
	const freshPath = await fixture(context);
	assert.equal(
		applyMigrations({ databasePath: freshPath, migrations: taskMigrations }).ok,
		true,
	);
	const sequentialPath = await fixture(context);
	assert.equal(
		applyMigrations({
			databasePath: sequentialPath,
			migrations: [firstMigration],
		}).ok,
		true,
	);
	assert.equal(
		applyMigrations({
			databasePath: sequentialPath,
			migrations: taskMigrations,
		}).ok,
		true,
	);
	assert.equal(
		verifyMigrations({ databasePath: freshPath, migrations: taskMigrations })
			.ok,
		true,
	);
	assert.equal(
		verifyMigrations({
			databasePath: sequentialPath,
			migrations: taskMigrations,
		}).ok,
		true,
	);
	assert.deepEqual(
		getMigrationStatus({ databasePath: freshPath, migrations: taskMigrations })
			.appliedVersions,
		getMigrationStatus({
			databasePath: sequentialPath,
			migrations: taskMigrations,
		}).appliedVersions,
	);
	const freshStore = new SqliteTaskStore({ databasePath: freshPath });
	const sequentialStore = new SqliteTaskStore({ databasePath: sequentialPath });
	try {
		assert.deepEqual(
			sequentialStore.inspectSchema(),
			freshStore.inspectSchema(),
		);
	} finally {
		freshStore.close();
		sequentialStore.close();
	}
});

test("CP-TASK-MIG-04 public apply/status/verify and machine CLI expose execution mechanics only", async (context) => {
	const databasePath = await fixture(context);
	assert.equal(
		applyMigrations({ databasePath, migrations: taskMigrations }).contract,
		"task-migration",
	);
	assert.equal(
		getMigrationStatus({ databasePath, migrations: taskMigrations }).contract,
		"task-migration",
	);
	assert.equal(
		verifyMigrations({ databasePath, migrations: taskMigrations }).contract,
		"task-migration",
	);
	const cli = JSON.parse(
		await runCli(["--json", "status", "--database", databasePath]),
	) as { contract: string; status: string };
	assert.equal(cli.contract, "deployment.result.v1");
	assert.equal(cli.status, "SUCCEEDED");
});
