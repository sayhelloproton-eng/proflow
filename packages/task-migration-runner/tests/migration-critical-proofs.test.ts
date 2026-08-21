import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
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

function normalizeSchemaForSemanticComparison(
	schema: ReturnType<SqliteTaskStore["inspectSchema"]>,
) {
	return {
		...schema,
		columns: {
			...schema.columns,
			schema_migrations: [...(schema.columns.schema_migrations ?? [])].sort(),
		},
	};
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

test("CP-TASK-MIG-03 authentic 2026-08-10 pre-checksum schema upgrades only with explicit legacy identity mapping", async (context) => {
	const databasePath = await fixture(context);
	const historicalSql = await readFile(
		new URL("./fixtures/task-schema-20260810.sql", import.meta.url),
		"utf8",
	);
	const database = new DatabaseSync(databasePath);
	database.exec(historicalSql);
	database
		.prepare(
			"INSERT INTO schema_migrations(version,name,applied_at) VALUES (?,?,?), (?,?,?)",
		)
		.run(
			1,
			"legacy_task_core_pre_checksum",
			"2026-08-10T00:00:00.000Z",
			2,
			"legacy_task_documents_pre_checksum",
			"2026-08-10T00:00:01.000Z",
		);
	database
		.prepare(
			"INSERT INTO task_groups(task_group_id,title,objective,status,max_active_tasks,version,created_by_ref,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
		)
		.run(
			"legacy-group",
			"Legacy group",
			"Preserve historical rows",
			"ACTIVE",
			1,
			1,
			"legacy",
			"2026-08-10T00:00:00.000Z",
			"2026-08-10T00:00:00.000Z",
		);
	database
		.prepare(
			"INSERT INTO tasks(task_id,task_group_id,sequence_no,title,objective,status,version,plan_version,current_node_id,created_by_ref,created_at,started_at,completed_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
		)
		.run(
			"legacy-task",
			"legacy-group",
			1,
			"Legacy",
			"Upgrade",
			"PENDING",
			1,
			1,
			null,
			"legacy",
			"2026-08-10T00:00:00.000Z",
			null,
			null,
			"2026-08-10T00:00:00.000Z",
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
			"c-legacy-dev",
			"[]",
			"[]",
			null,
			null,
			null,
			null,
			null,
			null,
			"2026-08-10T00:00:00.000Z",
		);
	database
		.prepare(
			"INSERT INTO node_execution_history(task_id,node_id,run_no,worker_ref,final_status,result_summary,error_code,error_message,error_retryable,input_documents_json,output_documents_json,started_at,ended_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
		)
		.run(
			"legacy-task",
			"legacy-node",
			1,
			"c-legacy-dev",
			"SUCCEEDED",
			"historical result",
			null,
			null,
			null,
			"[]",
			"[]",
			"2026-08-10T00:00:00.000Z",
			"2026-08-10T00:01:00.000Z",
		);
	database
		.prepare(
			"INSERT INTO task_documents(task_id,document_type,source_node_id,file_path,content_hash,updated_by_ref,updated_at) VALUES (?,?,?,?,?,?,?)",
		)
		.run(
			"legacy-task",
			"REQUIREMENT",
			"legacy-node",
			"docs/legacy-requirement.md",
			"sha256:legacy-document",
			"legacy",
			"2026-08-10T00:02:00.000Z",
		);
	database
		.prepare(
			"INSERT INTO task_messages(message_id,task_id,node_id,message_type,reason_code,message,related_ref,status,created_by_ref,created_at,acknowledged_by_ref,acknowledged_at,resolution) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
		)
		.run(
			"legacy-message",
			"legacy-task",
			"legacy-node",
			"NOTICE",
			"LEGACY",
			"historical message",
			null,
			"PENDING",
			"legacy",
			"2026-08-10T00:03:00.000Z",
			null,
			null,
			null,
		);
	database
		.prepare(
			"INSERT INTO task_events(task_id,node_id,event_type,actor_ref,task_version,node_version,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)",
		)
		.run(
			"legacy-task",
			"legacy-node",
			"LEGACY_EVENT",
			"legacy",
			1,
			1,
			'{"preserved":true}',
			"2026-08-10T00:04:00.000Z",
		);
	database
		.prepare(
			"INSERT INTO idempotency_records(idempotency_key,operation,request_hash,response_json,created_at) VALUES (?,?,?,?,?)",
		)
		.run(
			"legacy-idempotency",
			"legacyOperation",
			"sha256:legacy-request",
			'{"ok":true}',
			"2026-08-10T00:05:00.000Z",
		);
	database.close();

	const refused = applyMigrations({ databasePath, migrations: taskMigrations });
	assert.equal(refused.ok, false);
	assert.match(
		refused.error?.message ?? "",
		/LEGACY_TASK_(ROLE|BINDING)_MAPPING_REQUIRED/,
	);

	const upgraded = applyMigrations({
		databasePath,
		migrations: taskMigrations,
		context: {
			legacyRoleBindings: {
				"@tomflow/proflow-agent-product": {
					agentPackageRef: "@tomflow/proflow-agent-product",
					roleRef: "g-product",
				},
				"legacy-dev": {
					agentPackageRef: "@tomflow/proflow-agent-controller-dev",
					roleRef: "g-controller-dev",
					conversationLocator:
						"https://chatgpt.com/g/g-controller-dev/c/c-legacy-dev",
				},
				"@tomflow/proflow-agent-test-ops": {
					agentPackageRef: "@tomflow/proflow-agent-test-ops",
					roleRef: "g-test",
				},
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
	assert.deepEqual(status.schemaDrift, []);
	assert.equal(
		verifyMigrations({ databasePath, migrations: taskMigrations }).ok,
		true,
	);
	const upgradedDatabase = new DatabaseSync(databasePath, { readOnly: true });
	const nodeInfo = upgradedDatabase
		.prepare("PRAGMA table_info(nodes)")
		.all() as Array<{
		name: string;
		notnull: number;
	}>;
	const bindingInfo = upgradedDatabase
		.prepare("PRAGMA table_info(task_role_bindings)")
		.all() as Array<{ name: string; notnull: number; pk: number }>;
	assert.equal(
		nodeInfo.some((item) => item.name === "required_role_ref"),
		false,
	);
	assert.equal(
		nodeInfo.find((item) => item.name === "required_agent_package_ref")
			?.notnull,
		1,
	);
	assert.deepEqual(
		bindingInfo
			.filter((item) => item.pk > 0)
			.sort((left, right) => left.pk - right.pk)
			.map((item) => item.name),
		["task_id", "agent_package_ref"],
	);
	assert.equal(
		bindingInfo.find((item) => item.name === "agent_package_ref")?.notnull,
		1,
	);
	const node = upgradedDatabase
		.prepare(
			"SELECT required_agent_package_ref FROM nodes WHERE node_id='legacy-node'",
		)
		.get() as { required_agent_package_ref: string };
	const bindings = upgradedDatabase
		.prepare(
			"SELECT agent_package_ref,role_ref,worker_ref,conversation_locator FROM task_role_bindings WHERE task_id='legacy-task' ORDER BY agent_package_ref",
		)
		.all() as Array<{
		agent_package_ref: string;
		role_ref: string;
		worker_ref: string | null;
		conversation_locator: string | null;
	}>;
	assert.equal(
		node.required_agent_package_ref,
		"@tomflow/proflow-agent-controller-dev",
	);
	assert.deepEqual(
		bindings.map((row) => ({ ...row })),
		[
			{
				agent_package_ref: "@tomflow/proflow-agent-controller-dev",
				role_ref: "g-controller-dev",
				worker_ref: "c-legacy-dev",
				conversation_locator:
					"https://chatgpt.com/g/g-controller-dev/c/c-legacy-dev",
			},
			{
				agent_package_ref: "@tomflow/proflow-agent-product",
				role_ref: "g-product",
				worker_ref: null,
				conversation_locator: null,
			},
			{
				agent_package_ref: "@tomflow/proflow-agent-test-ops",
				role_ref: "g-test",
				worker_ref: null,
				conversation_locator: null,
			},
		],
	);
	assert.deepEqual(
		{
			...upgradedDatabase
				.prepare(
					"SELECT task_group_id,title,status,max_active_tasks FROM task_groups WHERE task_group_id='legacy-group'",
				)
				.get(),
		},
		{
			task_group_id: "legacy-group",
			title: "Legacy group",
			status: "ACTIVE",
			max_active_tasks: 1,
		},
	);
	assert.deepEqual(
		{
			...upgradedDatabase
				.prepare(
					"SELECT final_status,result_summary,worker_ref FROM node_execution_history WHERE node_id='legacy-node' AND run_no=1",
				)
				.get(),
		},
		{
			final_status: "SUCCEEDED",
			result_summary: "historical result",
			worker_ref: "c-legacy-dev",
		},
	);
	assert.deepEqual(
		{
			...upgradedDatabase
				.prepare(
					"SELECT document_type,file_path,content_hash,source_node_id FROM task_documents WHERE task_id='legacy-task'",
				)
				.get(),
		},
		{
			document_type: "REQUIREMENT",
			file_path: "docs/legacy-requirement.md",
			content_hash: "sha256:legacy-document",
			source_node_id: "legacy-node",
		},
	);
	assert.equal(
		(
			upgradedDatabase
				.prepare(
					"SELECT message FROM task_messages WHERE message_id='legacy-message'",
				)
				.get() as { message: string }
		).message,
		"historical message",
	);
	assert.equal(
		(
			upgradedDatabase
				.prepare(
					"SELECT payload_json FROM task_events WHERE event_type='LEGACY_EVENT'",
				)
				.get() as { payload_json: string }
		).payload_json,
		'{"preserved":true}',
	);
	assert.equal(
		(
			upgradedDatabase
				.prepare(
					"SELECT operation FROM idempotency_records WHERE idempotency_key='legacy-idempotency'",
				)
				.get() as { operation: string }
		).operation,
		"legacyOperation",
	);
	upgradedDatabase.close();

	// A legacy-upgraded database must converge to the same owner-visible schema
	// as a fresh current installation, not merely report migration v3 as applied.
	// `schema_migrations` physical column ordinal is intentionally excluded: a
	// pre-checksum database appends the nullable checksum column in place so the
	// authoritative migration history is never rewritten just to normalize order.
	// The v3 verifier separately proves NOT NULL / PK / CHECK details.
	const freshCanonicalPath = await fixture(context);
	assert.equal(
		applyMigrations({
			databasePath: freshCanonicalPath,
			migrations: taskMigrations,
		}).ok,
		true,
	);
	const upgradedStore = new SqliteTaskStore({ databasePath });
	const freshCanonicalStore = new SqliteTaskStore({
		databasePath: freshCanonicalPath,
	});
	try {
		assert.deepEqual(
			normalizeSchemaForSemanticComparison(upgradedStore.inspectSchema()),
			normalizeSchemaForSemanticComparison(freshCanonicalStore.inspectSchema()),
		);
	} finally {
		upgradedStore.close();
		freshCanonicalStore.close();
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
	const cli = await runCli(["status", "--database", databasePath]);
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

test("deployment adapter drives real migration status/migrate and exposes migrated reality", async (context) => {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-task-migration-adapter-"),
	);
	context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
	const { behaviorAdapter } = await import("../deployment/adapter.ts");
	const commandContext = { workspaceRoot };

	const before = await behaviorAdapter.status(commandContext);
	assert.deepEqual(before.result.data, {
		setupStatus: "FAILED",
		runtimeStatus: "NOT_APPLICABLE",
	});
	const beforeMigration = await behaviorAdapter.migrationStatus(commandContext);
	assert.equal(beforeMigration.result.data.migrated, false);
	assert.ok(beforeMigration.result.data.pendingVersions.length > 0);

	const migrated = await behaviorAdapter.migrate(commandContext);
	assert.equal(migrated.result.status, "SUCCEEDED");

	const after = await behaviorAdapter.status(commandContext);
	assert.deepEqual(after.result.data, {
		setupStatus: "READY",
		runtimeStatus: "NOT_APPLICABLE",
	});
	const verified = await behaviorAdapter.migrationStatus(commandContext);
	assert.equal(verified.result.data.migrated, true);
	assert.deepEqual(verified.result.data.pendingVersions, []);
	assert.equal(
		(await behaviorAdapter.setup(commandContext)).result.status,
		"SUCCEEDED",
	);
});
