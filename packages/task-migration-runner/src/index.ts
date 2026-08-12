import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
	type TaskMigration,
	taskMigrations,
} from "@tomflow/proflow-task-store-sqlite/migrations";

export interface MigrationInput {
	databasePath: string;
	migrations: readonly TaskMigration[];
}

export interface MigrationResult {
	contract: "task-migration";
	contractVersion: "1.0.0";
	ok: boolean;
	applied: number[];
	pending: number[];
	error?: {
		code: "MIGRATION_FAILED" | "MIGRATION_VERIFY_FAILED";
		message: string;
	};
}

export interface MigrationStatus {
	contract: "task-migration";
	contractVersion: "1.0.0";
	appliedVersions: number[];
	pendingVersions: number[];
}

export function discoverMigrations(
	migrations: readonly TaskMigration[],
): TaskMigration[] {
	const sorted = [...migrations].sort(
		(left, right) => left.version - right.version,
	);
	const versions = new Set<number>();
	for (const migration of sorted) {
		if (!Number.isSafeInteger(migration.version) || migration.version < 1)
			throw new TypeError("migration version must be a positive integer");
		if (!/^[a-z][a-z0-9_]*$/.test(migration.name))
			throw new TypeError("migration name must be stable snake_case");
		if (versions.has(migration.version))
			throw new TypeError(`duplicate migration version ${migration.version}`);
		versions.add(migration.version);
	}
	return sorted;
}

function openDatabase(databasePath: string): DatabaseSync {
	if (databasePath !== ":memory:")
		mkdirSync(dirname(databasePath), { recursive: true });
	const database = new DatabaseSync(databasePath);
	database.exec(
		"PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2500;",
	);
	database.exec(
		"CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
	);
	return database;
}

function appliedVersions(database: DatabaseSync): number[] {
	return (
		database
			.prepare("SELECT version FROM schema_migrations ORDER BY version")
			.all() as Array<{ version: number }>
	).map((row) => row.version);
}

export function getMigrationStatus(input: MigrationInput): MigrationStatus {
	const migrations = discoverMigrations(input.migrations);
	const database = openDatabase(input.databasePath);
	try {
		const applied = appliedVersions(database);
		const appliedSet = new Set(applied);
		return {
			contract: "task-migration",
			contractVersion: "1.0.0",
			appliedVersions: applied,
			pendingVersions: migrations
				.filter((item) => !appliedSet.has(item.version))
				.map((item) => item.version),
		};
	} finally {
		database.close();
	}
}

export function applyMigrations(input: MigrationInput): MigrationResult {
	const migrations = discoverMigrations(input.migrations);
	const database = openDatabase(input.databasePath);
	const appliedNow: number[] = [];
	try {
		const alreadyApplied = new Set(appliedVersions(database));
		for (const migration of migrations) {
			if (alreadyApplied.has(migration.version)) continue;
			database.exec("BEGIN IMMEDIATE");
			try {
				database.exec(migration.sql);
				database
					.prepare(
						"INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
					)
					.run(migration.version, migration.name, new Date().toISOString());
				database.exec("COMMIT");
				appliedNow.push(migration.version);
				alreadyApplied.add(migration.version);
			} catch (error) {
				database.exec("ROLLBACK");
				return {
					contract: "task-migration",
					contractVersion: "1.0.0",
					ok: false,
					applied: appliedNow,
					pending: migrations
						.filter((item) => !alreadyApplied.has(item.version))
						.map((item) => item.version),
					error: {
						code: "MIGRATION_FAILED",
						message:
							error instanceof Error ? error.message : "migration failed",
					},
				};
			}
		}
		return {
			contract: "task-migration",
			contractVersion: "1.0.0",
			ok: true,
			applied: appliedNow,
			pending: [],
		};
	} finally {
		database.close();
	}
}

export function verifyMigrations(input: MigrationInput): MigrationResult {
	const status = getMigrationStatus(input);
	const database = openDatabase(input.databasePath);
	try {
		const integrity = database.prepare("PRAGMA integrity_check").get() as
			| { integrity_check?: string }
			| undefined;
		const ok =
			status.pendingVersions.length === 0 &&
			integrity?.integrity_check === "ok";
		return {
			contract: "task-migration",
			contractVersion: "1.0.0",
			ok,
			applied: status.appliedVersions,
			pending: status.pendingVersions,
			...(ok
				? {}
				: {
						error: {
							code: "MIGRATION_VERIFY_FAILED" as const,
							message: "migration state or SQLite integrity does not match",
						},
					}),
		};
	} finally {
		database.close();
	}
}

export async function runCli(args: string[]): Promise<string> {
	const command =
		args.find((item) => ["apply", "status", "verify"].includes(item)) ??
		"status";
	const databaseIndex = args.indexOf("--database");
	const databasePath =
		databaseIndex >= 0 ? (args[databaseIndex + 1] ?? ":memory:") : ":memory:";
	let success = true;
	let message = "migration status is readable";
	if (command === "apply") {
		const result = applyMigrations({
			databasePath,
			migrations: taskMigrations,
		});
		success = result.ok;
		message = result.ok
			? "migrations applied"
			: (result.error?.message ?? "migration failed");
	} else if (command === "verify") {
		const result = verifyMigrations({
			databasePath,
			migrations: taskMigrations,
		});
		success = result.ok;
		message = result.ok
			? "migrations verified"
			: (result.error?.message ?? "migration verify failed");
	} else {
		getMigrationStatus({ databasePath, migrations: taskMigrations });
	}
	return JSON.stringify({
		contract: "deployment.result.v1",
		ok: success,
		status: success ? "SUCCEEDED" : "FAILED",
		moduleRef: "task-migration-runner",
		moduleVersion: "0.1.0",
		checks: [
			{ id: "migration-state", status: success ? "PASS" : "FAIL", message },
		],
		...(success
			? {}
			: { error: { code: "COMMAND_FAILED", message, retryable: false } }),
	});
}
