import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { descriptor } from "./descriptor.ts";

const REQUIRED_TABLES = [
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
] as const;

const success = (checks?: unknown[]) => ({
	contract: "deployment.result.v1" as const,
	ok: true,
	status: "SUCCEEDED" as const,
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
	...(checks === undefined ? {} : { checks }),
});

const actionRequired = (description: string, checks?: unknown[]) => ({
	contract: "deployment.result.v1" as const,
	ok: false,
	status: "ACTION_REQUIRED" as const,
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
	actionRequired: { action: "configure-task-store", description },
	...(checks === undefined ? {} : { checks }),
});

const blocked = (message: string, checks?: unknown[]) => ({
	contract: "deployment.result.v1" as const,
	ok: false,
	status: "BLOCKED" as const,
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
	error: { code: "VERIFY_FAILED" as const, message, retryable: true },
	...(checks === undefined ? {} : { checks }),
});

function inspect(databasePath: string | undefined): {
	ok: boolean;
	message: string;
} {
	if (!databasePath) return { ok: false, message: "databasePath is required" };
	if (!existsSync(databasePath)) {
		return {
			ok: false,
			message: `Task SQLite database does not exist at ${databasePath}`,
		};
	}
	let database: DatabaseSync | undefined;
	try {
		database = new DatabaseSync(databasePath, { readOnly: true });
		const integrity = database.prepare("PRAGMA integrity_check").get() as
			| { integrity_check?: string }
			| undefined;
		const tables = new Set(
			(
				database
					.prepare("SELECT name FROM sqlite_master WHERE type='table'")
					.all() as Array<{ name: string }>
			).map((row) => row.name),
		);
		const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
		if (integrity?.integrity_check !== "ok") {
			return {
				ok: false,
				message: `SQLite integrity_check returned ${integrity?.integrity_check ?? "unknown"}`,
			};
		}
		if (missing.length > 0) {
			return {
				ok: false,
				message: `Task SQLite schema is missing tables: ${missing.join(", ")}`,
			};
		}
		return {
			ok: true,
			message: "Task SQLite schema is present and integrity_check is ok",
		};
	} catch (error) {
		return {
			ok: false,
			message:
				error instanceof Error
					? error.message
					: "Task SQLite reality could not be read",
		};
	} finally {
		database?.close();
	}
}

export function createBehaviorAdapter(config: Record<string, string> = {}) {
	const resultForReality = (
		reality: { ok: boolean; message: string },
		checks?: unknown[],
	) =>
		reality.ok
			? success(checks)
			: config.databasePath
				? blocked(reality.message, checks)
				: actionRequired(reality.message, checks);
	return {
		describe: () => ({ result: success(), observedEffects: [] }),
		preflight: () => {
			const reality = inspect(config.databasePath);
			return { result: resultForReality(reality), observedEffects: [] };
		},
		status: () => {
			if (!config.databasePath) {
				return {
					result: {
						...success(),
						data: {
							configStatus: "INCOMPLETE" as const,
							missingConfig: ["databasePath"],
							runtimeStatus: "UNKNOWN" as const,
						},
					},
					observedEffects: [],
				};
			}
			const reality = inspect(config.databasePath);
			return {
				result: {
					...success(),
					data: {
						configStatus: reality.ok ? ("READY" as const) : ("INVALID" as const),
						runtimeStatus: "UNKNOWN" as const,
					},
				},
				observedEffects: [],
			};
		},
		verify: () => {
			const reality = inspect(config.databasePath);
			const check = {
				id: "sqlite-integrity-pass",
				status: reality.ok ? ("PASS" as const) : ("FAIL" as const),
				message: reality.message,
			};
			return {
				result: resultForReality(reality, [check]),
				observedEffects: [],
			};
		},
		doctor: () => {
			const reality = inspect(config.databasePath);
			return { result: resultForReality(reality), observedEffects: [] };
		},
	};
}

export const behaviorAdapter = createBehaviorAdapter();

export function createProductionBinding(input: {
	config: Record<string, string>;
}): { behaviorAdapter: Record<string, unknown> } {
	return { behaviorAdapter: createBehaviorAdapter(input.config) };
}
