import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
	type TaskMigration,
	type TaskMigrationContext,
	taskMigrations,
} from "@tomflow/proflow-task-store-sqlite/migrations";
import { descriptor as moduleDescriptor } from "../deployment/descriptor.ts";

export interface MigrationInput {
	databasePath: string;
	migrations: readonly TaskMigration[];
	context?: TaskMigrationContext;
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
	metadataDrift: Array<{
		version: number;
		expectedName: string;
		actualName: string;
	}>;
	checksumDrift: Array<{
		version: number;
		expectedChecksum: string;
		actualChecksum: string;
	}>;
	legacyMetadataVersions: number[];
	missingTables: string[];
	schemaDrift: string[];
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
		if (migration.apply !== undefined && !migration.identity)
			throw new TypeError(
				`custom migration ${migration.version} requires a stable identity`,
			);
		if (migration.coversLegacyVersions !== undefined) {
			if (migration.apply === undefined)
				throw new TypeError(
					`migration ${migration.version} cannot cover legacy versions without an owner compatibility apply`,
				);
			if (
				migration.coversLegacyVersions.some(
					(version) =>
						!Number.isInteger(version) ||
						version < 1 ||
						version >= migration.version,
				)
			)
				throw new TypeError(
					`migration ${migration.version} has an invalid legacy coverage declaration`,
				);
		}
		versions.add(migration.version);
	}
	return sorted;
}

function migrationChecksum(migration: TaskMigration): string {
	const semanticIdentity = `${migration.identity ?? "sql"}\0${migration.sql}`;
	return `sha256:${createHash("sha256")
		.update(`${migration.version}\0${migration.name}\0${semanticIdentity}`)
		.digest("hex")}`;
}

function migrationMetadataColumns(database: DatabaseSync): Set<string> {
	return new Set(
		(
			database.prepare("PRAGMA table_info(schema_migrations)").all() as Array<{
				name: string;
			}>
		).map((row) => row.name),
	);
}

function openDatabase(databasePath: string): DatabaseSync {
	if (databasePath !== ":memory:")
		mkdirSync(dirname(databasePath), { recursive: true });
	const database = new DatabaseSync(databasePath);
	database.exec(
		"PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2500;",
	);
	database.exec(
		"CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT, applied_at TEXT NOT NULL);",
	);
	const columns = migrationMetadataColumns(database);
	if (!columns.has("checksum")) {
		// Preserve historical migration metadata in place. SQLite appends the
		// nullable checksum column to pre-checksum installations; physical column
		// ordinal is not part of the migration contract and must not be normalized
		// with a non-transactional rename/create/copy/drop sequence. This keeps a
		// crash from stranding authoritative migration history in a side table.
		database.exec("ALTER TABLE schema_migrations ADD COLUMN checksum TEXT");
	}
	return database;
}

function appliedVersions(database: DatabaseSync): number[] {
	return (
		database
			.prepare("SELECT version FROM schema_migrations ORDER BY version")
			.all() as Array<{ version: number }>
	).map((row) => row.version);
}

function expectedTableNames(migrations: readonly TaskMigration[]): string[] {
	return [
		...new Set(
			migrations.flatMap((migration) =>
				[
					...migration.sql.matchAll(
						/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi,
					),
				].map((match) => match[1] ?? ""),
			),
		),
	].filter(Boolean);
}

function inspectionStatus(
	database: DatabaseSync,
	migrations: readonly TaskMigration[],
): MigrationStatus {
	const migrationTable = database
		.prepare(
			"SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
		)
		.get() as { present?: number } | undefined;
	const metadataColumns = migrationTable
		? migrationMetadataColumns(database)
		: new Set<string>();
	const appliedRows = migrationTable
		? (database
				.prepare(
					metadataColumns.has("checksum")
						? "SELECT version, name, checksum FROM schema_migrations ORDER BY version"
						: "SELECT version, name, NULL AS checksum FROM schema_migrations ORDER BY version",
				)
				.all() as Array<{
				version: number;
				name: string;
				checksum: string | null;
			}>)
		: [];
	const appliedSet = new Set(appliedRows.map((row) => row.version));
	const expectedTables = expectedTableNames(migrations);
	const actualTables = new Set(
		(
			database
				.prepare("SELECT name FROM sqlite_master WHERE type='table'")
				.all() as Array<{ name: string }>
		).map((row) => row.name),
	);
	return {
		contract: "task-migration",
		contractVersion: "1.0.0",
		appliedVersions: appliedRows.map((row) => row.version),
		pendingVersions: migrations
			.filter((migration) => !appliedSet.has(migration.version))
			.map((migration) => migration.version),
		metadataDrift: migrations.flatMap((migration) => {
			const actual = appliedRows.find(
				(row) => row.version === migration.version,
			);
			const coveredLegacyIdentity =
				actual?.checksum === null &&
				migrations.some(
					(barrier) =>
						barrier.version > migration.version &&
						appliedSet.has(barrier.version) &&
						barrier.apply !== undefined &&
						barrier.coversLegacyVersions?.includes(migration.version) === true,
				);
			return actual !== undefined &&
				!coveredLegacyIdentity &&
				actual.name !== migration.name
				? [
						{
							version: migration.version,
							expectedName: migration.name,
							actualName: actual.name,
						},
					]
				: [];
		}),
		checksumDrift: migrations.flatMap((migration) => {
			const actual = appliedRows.find(
				(row) => row.version === migration.version,
			);
			const expectedChecksum = migrationChecksum(migration);
			return actual?.checksum !== null &&
				actual?.checksum !== undefined &&
				actual.checksum !== expectedChecksum
				? [
						{
							version: migration.version,
							expectedChecksum,
							actualChecksum: actual.checksum,
						},
					]
				: [];
		}),
		legacyMetadataVersions: appliedRows
			.filter((row) => row.checksum === null)
			.map((row) => row.version),
		missingTables: expectedTables.filter((table) => !actualTables.has(table)),
		schemaDrift: migrations.flatMap((migration) =>
			appliedSet.has(migration.version) && migration.verify
				? [...migration.verify(database)].map(
						(issue) => `v${migration.version}:${issue}`,
					)
				: [],
		),
	};
}

export function getMigrationStatus(input: MigrationInput): MigrationStatus {
	const migrations = discoverMigrations(input.migrations);
	if (input.databasePath !== ":memory:" && !existsSync(input.databasePath)) {
		return {
			contract: "task-migration",
			contractVersion: "1.0.0",
			appliedVersions: [],
			pendingVersions: migrations.map((migration) => migration.version),
			metadataDrift: [],
			checksumDrift: [],
			legacyMetadataVersions: [],
			missingTables: expectedTableNames(migrations),
			schemaDrift: [],
		};
	}
	const database = new DatabaseSync(input.databasePath, { readOnly: true });
	try {
		return inspectionStatus(database, migrations);
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
			if (alreadyApplied.has(migration.version)) {
				const row = database
					.prepare(
						"SELECT name, checksum FROM schema_migrations WHERE version = ?",
					)
					.get(migration.version) as
					| { name: string; checksum: string | null }
					| undefined;
				const legacyIdentityCoveredByCompatibility =
					row?.checksum === null &&
					migrations.some(
						(barrier) =>
							barrier.version > migration.version &&
							barrier.apply !== undefined &&
							barrier.coversLegacyVersions?.includes(migration.version) ===
								true,
					);
				if (
					!row ||
					(!legacyIdentityCoveredByCompatibility && row.name !== migration.name)
				)
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
							message: `migration ${migration.version} name drift: expected ${migration.name}, found ${row?.name ?? "missing"}`,
						},
					};
				if (row.checksum === null && migration.apply !== undefined)
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
							message: `compatibility migration ${migration.version} is missing checksum identity`,
						},
					};
				if (
					row.checksum !== null &&
					row.checksum !== migrationChecksum(migration)
				)
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
							message: `migration ${migration.version} checksum drift`,
						},
					};
				// Rows created by a pre-checksum runner remain explicitly legacy. They are
				// not backfilled with the current SQL checksum because the historical SQL
				// cannot be proven. A later compatibility migration validates/upgrades the
				// real schema instead.
				continue;
			}
			database.exec("BEGIN IMMEDIATE");
			try {
				if (migration.sql.trim().length > 0) database.exec(migration.sql);
				migration.apply?.(database, input.context ?? {});
				database
					.prepare(
						"INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
					)
					.run(
						migration.version,
						migration.name,
						migrationChecksum(migration),
						new Date().toISOString(),
					);
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
	if (input.databasePath !== ":memory:" && !existsSync(input.databasePath)) {
		return {
			contract: "task-migration",
			contractVersion: "1.0.0",
			ok: false,
			applied: [],
			pending: status.pendingVersions,
			error: {
				code: "MIGRATION_VERIFY_FAILED",
				message: "database does not exist",
			},
		};
	}
	const database = new DatabaseSync(input.databasePath, { readOnly: true });
	try {
		const integrity = database.prepare("PRAGMA integrity_check").get() as
			| { integrity_check?: string }
			| undefined;
		const appliedSet = new Set(status.appliedVersions);
		const legacyMetadataCoveredByCompatibilityBarrier =
			status.legacyMetadataVersions.length === 0 ||
			status.legacyMetadataVersions.every((legacyVersion) =>
				input.migrations.some(
					(migration) =>
						migration.version > legacyVersion &&
						appliedSet.has(migration.version) &&
						migration.apply !== undefined &&
						migration.coversLegacyVersions?.includes(legacyVersion) === true,
				),
			);
		const ok =
			status.pendingVersions.length === 0 &&
			status.metadataDrift.length === 0 &&
			status.checksumDrift.length === 0 &&
			legacyMetadataCoveredByCompatibilityBarrier &&
			status.missingTables.length === 0 &&
			status.schemaDrift.length === 0 &&
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

export interface TaskMigrationCliOutcome {
	contract: "deployment.result.v1";
	ok: boolean;
	status: "SUCCEEDED" | "FAILED";
	moduleRef: string;
	moduleVersion: string;
	data?: { usage: string };
	checks?: Array<{ id: string; status: "PASS" | "FAIL"; message: string }>;
	error?: { code: string; message: string; retryable: boolean };
}

export async function runCli(args: string[]): Promise<TaskMigrationCliOutcome> {
	if (args.includes("--json"))
		return {
			contract: "deployment.result.v1",
			ok: false,
			status: "FAILED",
			moduleRef: moduleDescriptor.moduleRef,
			moduleVersion: moduleDescriptor.moduleVersion,
			error: {
				code: "INVALID_REQUEST",
				message: "不支持的选项 --json",
				retryable: false,
			},
		};
	if (args.includes("--help") || args.includes("-h")) {
		return {
			contract: "deployment.result.v1",
			ok: true,
			status: "SUCCEEDED",
			moduleRef: moduleDescriptor.moduleRef,
			moduleVersion: moduleDescriptor.moduleVersion,
			data: {
				usage:
					"proflow-task-migrate [apply|status|verify] --database <path> [--legacy-role-map <json>]",
			},
		};
	}
	const command =
		args.find((item) => ["apply", "status", "verify"].includes(item)) ??
		"status";
	const databaseIndex = args.indexOf("--database");
	const databasePath =
		databaseIndex >= 0 ? (args[databaseIndex + 1] ?? ":memory:") : ":memory:";
	const legacyRoleMapIndex = args.indexOf("--legacy-role-map");
	let migrationContext: TaskMigrationContext | undefined;
	if (legacyRoleMapIndex >= 0) {
		const mapPath = args[legacyRoleMapIndex + 1];
		if (!mapPath) throw new TypeError("--legacy-role-map requires a JSON file");
		const parsed = JSON.parse(readFileSync(mapPath, "utf8")) as unknown;
		if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object")
			throw new TypeError("legacy role map must be a JSON object");
		const record = parsed as Record<string, unknown>;
		const structured = "roleMap" in record || "roleBindings" in record;
		migrationContext = structured
			? {
					...(record.roleMap && typeof record.roleMap === "object"
						? {
								legacyRoleMap: record.roleMap as Record<string, string>,
							}
						: {}),
					...(record.roleBindings && typeof record.roleBindings === "object"
						? {
								legacyRoleBindings: record.roleBindings as NonNullable<
									TaskMigrationContext["legacyRoleBindings"]
								>,
							}
						: {}),
				}
			: { legacyRoleMap: record as Record<string, string> };
	}
	let success = true;
	let message = "migration status is readable";
	if (command === "apply") {
		const result = applyMigrations({
			databasePath,
			migrations: taskMigrations,
			...(migrationContext ? { context: migrationContext } : {}),
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
	return {
		contract: "deployment.result.v1",
		ok: success,
		status: success ? "SUCCEEDED" : "FAILED",
		moduleRef: moduleDescriptor.moduleRef,
		moduleVersion: moduleDescriptor.moduleVersion,
		checks: [
			{ id: "migration-state", status: success ? "PASS" : "FAIL", message },
		],
		...(success
			? {}
			: { error: { code: "COMMAND_FAILED", message, retryable: false } }),
	};
}
