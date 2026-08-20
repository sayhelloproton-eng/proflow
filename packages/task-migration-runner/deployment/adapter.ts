import { join, resolve } from "node:path";

import type { ModuleCommandContext } from "@tomflow/proflow-module-contract";
import { taskMigrations } from "@tomflow/proflow-task-store-sqlite/migrations";
import {
	applyMigrations,
	getMigrationStatus,
	verifyMigrations,
} from "../src/index.ts";
import { descriptor } from "./descriptor.ts";

const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;
const input = (context: ModuleCommandContext) => ({
	databasePath: join(
		resolve(context.workspaceRoot),
		".proflow",
		"state",
		"task.sqlite",
	),
	migrations: taskMigrations,
});
const data = (context: ModuleCommandContext) => {
	const i = input(context);
	const status = getMigrationStatus(i);
	const verification = verifyMigrations(i);
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
};
export const behaviorAdapter = {
	install: async (context: ModuleCommandContext) => {
		const migration = applyMigrations(input(context));
		if (!migration.ok)
			return {
				result: {
					...base,
					ok: false as const,
					status: "FAILED" as const,
					error: {
						code: "APPLY_FAILED" as const,
						message: migration.error?.message ?? "Task migration failed",
						retryable: false,
					},
				},
				observedEffects: [],
			};
		return {
			result: {
				...base,
				data: { applied: migration.applied, pending: migration.pending },
			},
			observedEffects: ["Applies Task Store migration SQL to SQLite"],
		};
	},
	uninstall: async (_context: ModuleCommandContext) => ({
		result: base,
		observedEffects: [],
	}),
	status: async (context: ModuleCommandContext) => {
		const v = verifyMigrations(input(context));
		return {
			result: {
				...base,
				data: {
					setupStatus: v.ok ? ("READY" as const) : ("FAILED" as const),
					runtimeStatus: "NOT_APPLICABLE" as const,
				},
			},
			observedEffects: [],
		};
	},
	setup: async (context: ModuleCommandContext) => {
		const v = verifyMigrations(input(context));
		return {
			result: v.ok
				? base
				: {
						...base,
						ok: false as const,
						status: "FAILED" as const,
						error: {
							code: "SETUP_FAILED" as const,
							message: v.error?.message ?? "Task migration state is not ready",
							retryable: true,
						},
					},
			observedEffects: [],
		};
	},
	docs: async (_context: ModuleCommandContext) => ({
		result: { ...base, data: { docs: "DOCS.md", setup: "SETUP.md" } },
		observedEffects: [],
	}),
	start: async (_context: ModuleCommandContext) => ({
		result: base,
		observedEffects: [],
	}),
	stop: async (_context: ModuleCommandContext) => ({
		result: base,
		observedEffects: [],
	}),
	migrate: async (context: ModuleCommandContext) => {
		const migration = applyMigrations(input(context));
		return {
			result: migration.ok
				? {
						...base,
						data: { applied: migration.applied, pending: migration.pending },
					}
				: {
						...base,
						ok: false as const,
						status: "FAILED" as const,
						error: {
							code: "APPLY_FAILED" as const,
							message: migration.error?.message ?? "Task migration failed",
							retryable: false,
						},
					},
			observedEffects: migration.ok
				? ["Applies Task Store migration SQL to SQLite"]
				: [],
		};
	},
	migrationStatus: async (context: ModuleCommandContext) => ({
		result: { ...base, data: data(context) },
		observedEffects: [],
	}),
} as const;
