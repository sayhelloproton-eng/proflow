import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
		[1, 2, 3],
	);
	assert.throws(() => discoverMigrations([firstMigration, firstMigration]));
});

test("CP-TASK-MIG-02 duplicate apply is prevented and failed migration rolls back and stops", async (context) => {
	const databasePath = await fixture(context);
	const first = applyMigrations({ databasePath, migrations: taskMigrations });
	assert.equal(first.ok, true);
	assert.equal(first.applied.length, 3);
	const replay = applyMigrations({ databasePath, migrations: taskMigrations });
	assert.equal(replay.ok, true);
	assert.deepEqual(replay.applied, []);
	const altered = taskMigrations.map((migration) =>
		migration.version === 1
			? {
					...migration,
					sql: `${migration.sql}\n-- forbidden in-place historical edit`,
				}
			: migration,
	);
	const alteredReplay = applyMigrations({ databasePath, migrations: altered });
	assert.equal(alteredReplay.ok, false);
	assert.match(alteredReplay.error?.message ?? "", /checksum drift/);

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

test("CP-TASK-MIG-03 historical pre-checksum schema upgrades only with explicit legacy role mapping", async (context) => {
	const databasePath = await fixture(context);
	assert.equal(
		applyMigrations({
			databasePath,
			migrations: taskMigrations.filter((migration) => migration.version <= 2),
		}).ok,
		true,
	);
	const database = new DatabaseSync(databasePath);
	database.exec("UPDATE schema_migrations SET checksum=NULL");
	database.exec(
		"ALTER TABLE nodes RENAME COLUMN required_agent_package_ref TO required_role_ref",
	);
	database.exec("PRAGMA foreign_keys=OFF");
	database.exec(
		"ALTER TABLE task_role_bindings RENAME TO task_role_bindings_current",
	);
	database.exec(`
CREATE TABLE task_role_bindings (
  task_id TEXT NOT NULL,
  role_ref TEXT NOT NULL,
  worker_ref TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (task_id, role_ref)
);`);
	database.exec("DROP TABLE task_role_bindings_current");
	database.exec("PRAGMA foreign_keys=ON");
	database
		.prepare(
			"INSERT INTO tasks(task_id,task_group_id,sequence_no,title,objective,status,version,plan_version,current_node_id,created_by_ref,created_at,started_at,completed_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
		)
		.run(
			"legacy-task",
			null,
			null,
			"Legacy",
			"Upgrade",
			"PENDING",
			1,
			1,
			null,
			"legacy",
			"2026-08-12T00:00:00.000Z",
			null,
			null,
			"2026-08-12T00:00:00.000Z",
		);
	database
		.prepare(
			"INSERT INTO nodes(node_id,task_id,sequence_no,title,objective,status,version,run_no,required_role_ref,worker_ref,input_documents_json,output_documents_json,result_summary,error_code,error_message,error_retryable,started_at,completed_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
		)
		.run(
			"legacy-node",
			"legacy-task",
			1,
			"Legacy node",
			"Upgrade",
			"PENDING",
			1,
			1,
			"legacy-dev",
			null,
			"[]",
			"[]",
			null,
			null,
			null,
			null,
			null,
			null,
			"2026-08-12T00:00:00.000Z",
		);
	database
		.prepare(
			"INSERT INTO task_role_bindings(task_id,role_ref,worker_ref,version,created_at,updated_at) VALUES (?,?,?,?,?,?)",
		)
		.run(
			"legacy-task",
			"legacy-dev",
			"c-legacy-dev",
			1,
			"2026-08-12T00:00:00.000Z",
			"2026-08-12T00:00:00.000Z",
		);
	database.close();

	const refused = applyMigrations({ databasePath, migrations: taskMigrations });
	assert.equal(refused.ok, false);
	assert.match(
		refused.error?.message ?? "",
		/LEGACY_TASK_ROLE_MAPPING_REQUIRED/,
	);

	const upgraded = applyMigrations({
		databasePath,
		migrations: taskMigrations,
		context: {
			legacyRoleMap: {
				"legacy-dev": "@tomflow/proflow-agent-controller-dev",
			},
		},
	});
	assert.equal(upgraded.ok, true);
	assert.deepEqual(upgraded.applied, [3]);
	const status = getMigrationStatus({
		databasePath,
		migrations: taskMigrations,
	});
	assert.deepEqual(status.appliedVersions, [1, 2, 3]);
	assert.deepEqual(status.legacyMetadataVersions, [1, 2]);
	assert.deepEqual(status.checksumDrift, []);
	assert.equal(
		verifyMigrations({ databasePath, migrations: taskMigrations }).ok,
		true,
	);
	const upgradedDatabase = new DatabaseSync(databasePath, { readOnly: true });
	const node = upgradedDatabase
		.prepare(
			"SELECT required_agent_package_ref FROM nodes WHERE node_id='legacy-node'",
		)
		.get() as { required_agent_package_ref: string };
	const binding = upgradedDatabase
		.prepare(
			"SELECT agent_package_ref, conversation_locator FROM task_role_bindings WHERE task_id='legacy-task'",
		)
		.get() as {
		agent_package_ref: string;
		conversation_locator: string | null;
	};
	assert.equal(
		node.required_agent_package_ref,
		"@tomflow/proflow-agent-controller-dev",
	);
	assert.equal(
		binding.agent_package_ref,
		"@tomflow/proflow-agent-controller-dev",
	);
	assert.equal(binding.conversation_locator, null);
	upgradedDatabase.close();
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

test("remediation T06 status is non-mutating and verify detects name and schema drift", async (context) => {
	const missingPath = await fixture(context);
	const status = getMigrationStatus({
		databasePath: missingPath,
		migrations: taskMigrations,
	});
	assert.deepEqual(status.appliedVersions, []);
	await assert.rejects(access(missingPath));

	assert.equal(
		applyMigrations({ databasePath: missingPath, migrations: taskMigrations })
			.ok,
		true,
	);
	const database = new DatabaseSync(missingPath);
	database.exec("UPDATE schema_migrations SET name='drifted' WHERE version=1");
	database.exec(
		"UPDATE schema_migrations SET checksum='sha256:drifted' WHERE version=2",
	);
	database.exec("DROP TABLE task_messages");
	database.close();
	const drift = getMigrationStatus({
		databasePath: missingPath,
		migrations: taskMigrations,
	});
	assert.equal(drift.metadataDrift.length, 1);
	assert.equal(drift.checksumDrift.length, 1);
	assert.deepEqual(drift.missingTables, ["task_messages"]);
	assert.equal(
		verifyMigrations({ databasePath: missingPath, migrations: taskMigrations })
			.ok,
		false,
	);
	assert.equal(
		applyMigrations({ databasePath: missingPath, migrations: taskMigrations })
			.ok,
		false,
	);
});
