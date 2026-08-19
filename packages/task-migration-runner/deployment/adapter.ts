import { observeDeclaredModuleStatus } from "@tomflow/proflow-module-contract";
import { taskMigrations } from "@tomflow/proflow-task-store-sqlite/migrations";
import {
	applyMigrations,
	getMigrationStatus,
	verifyMigrations,
} from "../src/index.ts";
import { descriptor } from "./descriptor.ts";

const base = {
	contract: "deployment.result.v1" as const,
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
};

const success = (data?: unknown, checks?: unknown[]) => ({
	...base,
	ok: true,
	status: "SUCCEEDED" as const,
	...(data === undefined ? {} : { data }),
	...(checks === undefined ? {} : { checks }),
});

const actionRequired = (
	description: string,
	data?: unknown,
	checks?: unknown[],
) => ({
	...base,
	ok: false,
	status: "ACTION_REQUIRED" as const,
	actionRequired: { action: "configure-task-migrations", description },
	...(data === undefined ? {} : { data }),
	...(checks === undefined ? {} : { checks }),
});

const failed = (
	message: string,
	data?: unknown,
	checks?: unknown[],
	code: "APPLY_FAILED" | "VERIFY_FAILED" = "APPLY_FAILED",
) => ({
	...base,
	ok: false,
	status: "FAILED" as const,
	error: { code, message, retryable: false },
	...(data === undefined ? {} : { data }),
	...(checks === undefined ? {} : { checks }),
});

const blocked = (message: string, data?: unknown) => ({
	...base,
	ok: false,
	status: "BLOCKED" as const,
	error: { code: "VERIFY_FAILED" as const, message, retryable: true },
	...(data === undefined ? {} : { data }),
});

function migrationInput(config: Record<string, string>) {
	const databasePath = config.databasePath;
	if (!databasePath) return undefined;
	return { databasePath, migrations: taskMigrations };
}

function statusData(config: Record<string, string>) {
	const input = migrationInput(config);
	if (input === undefined) return undefined;
	const status = getMigrationStatus(input);
	const verification = verifyMigrations(input);
	return {
		migrated: verification.ok,
		appliedVersions: status.appliedVersions,
		pendingVersions: status.pendingVersions,
		metadataDrift: status.metadataDrift,
		checksumDrift: status.checksumDrift,
		legacyMetadataVersions: status.legacyMetadataVersions,
		missingTables: status.missingTables,
		schemaDrift: status.schemaDrift,
	};
}

export function createBehaviorAdapter(config: Record<string, string> = {}) {
	return {
		describe: () => ({ result: success(), observedEffects: [] }),
		preflight: () => ({
			result:
				migrationInput(config) === undefined
					? actionRequired("databasePath is required for Task migrations")
					: success(),
			observedEffects: [],
		}),
		status: () => ({
			result: success(
				observeDeclaredModuleStatus(descriptor, config, "STOPPED"),
			),
			observedEffects: [],
		}),
		verify: () => {
			const input = migrationInput(config);
			if (input === undefined) {
				const check = {
					id: "migration-state-pass",
					status: "FAIL" as const,
					message: "databasePath is required for Task migration verification",
				};
				return {
					result: actionRequired(check.message, undefined, [check]),
					observedEffects: [],
				};
			}
			const verification = verifyMigrations(input);
			const data = statusData(config);
			const check = {
				id: "migration-state-pass",
				status: verification.ok ? ("PASS" as const) : ("FAIL" as const),
				message: verification.ok
					? "Task migration state and SQLite integrity match the current schema"
					: (verification.error?.message ??
						"Task migration verification failed"),
			};
			return {
				result: verification.ok
					? success(data, [check])
					: failed(check.message, data, [check], "VERIFY_FAILED"),
				observedEffects: [],
			};
		},
		doctor: () => {
			const data = statusData(config);
			if (data === undefined) {
				return {
					result: actionRequired(
						"databasePath is required for Task migration diagnostics",
					),
					observedEffects: [],
				};
			}
			return {
				result: data.migrated
					? success(data)
					: blocked(
							"Task migration state requires a repair/migration plan before readiness",
							data,
						),
				observedEffects: [],
			};
		},
		migrate: () => {
			const input = migrationInput(config);
			if (input === undefined) {
				return {
					result: actionRequired(
						"databasePath is required before Task migrations can run",
					),
					observedEffects: [],
				};
			}
			const migration = applyMigrations(input);
			return {
				result: migration.ok
					? success({ applied: migration.applied, pending: migration.pending })
					: failed(migration.error?.message ?? "Task migration failed", {
							applied: migration.applied,
							pending: migration.pending,
						}),
				observedEffects: migration.ok
					? ["Applies Task Store migration SQL to SQLite"]
					: [],
			};
		},
	};
}

export const behaviorAdapter = createBehaviorAdapter();

export function createProductionBinding(input: {
	config: Record<string, string>;
}): { behaviorAdapter: Record<string, unknown> } {
	return { behaviorAdapter: createBehaviorAdapter(input.config) };
}
