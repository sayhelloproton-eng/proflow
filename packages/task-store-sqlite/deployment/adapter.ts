import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { ModuleCommandContext } from "@tomflow/proflow-module-contract";
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
const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;
export const taskDatabasePath = (context: ModuleCommandContext) =>
	join(resolve(context.workspaceRoot), ".proflow", "state", "task.sqlite");
function inspect(path: string): boolean {
	if (!existsSync(path)) return false;
	let db: DatabaseSync | undefined;
	try {
		db = new DatabaseSync(path, { readOnly: true });
		const integrity = db.prepare("PRAGMA integrity_check").get() as
			| { integrity_check?: string }
			| undefined;
		const tables = new Set(
			(
				db
					.prepare("SELECT name FROM sqlite_master WHERE type='table'")
					.all() as Array<{ name: string }>
			).map((row) => row.name),
		);
		return (
			integrity?.integrity_check === "ok" &&
			REQUIRED_TABLES.every((table) => tables.has(table))
		);
	} catch {
		return false;
	} finally {
		db?.close();
	}
}
export const behaviorAdapter = {
	install: async (context: ModuleCommandContext) => {
		const path = taskDatabasePath(context);
		await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
		if (!existsSync(path)) {
			const db = new DatabaseSync(path);
			db.close();
		}
		return {
			result: { ...base, data: { databasePath: path } },
			observedEffects: [],
		};
	},
	uninstall: async (_context: ModuleCommandContext) => ({
		result: base,
		observedEffects: [],
	}),
	status: async (context: ModuleCommandContext) => ({
		result: {
			...base,
			data: {
				setupStatus: inspect(taskDatabasePath(context))
					? ("READY" as const)
					: ("FAILED" as const),
				runtimeStatus: "NOT_APPLICABLE" as const,
			},
		},
		observedEffects: [],
	}),
	setup: async (context: ModuleCommandContext) => ({
		result: inspect(taskDatabasePath(context))
			? base
			: {
					...base,
					ok: false as const,
					status: "FAILED" as const,
					error: {
						code: "SETUP_FAILED" as const,
						message:
							"Task SQLite schema is not materialized; task-migration-runner must complete deterministic install",
						retryable: true,
					},
				},
		observedEffects: [],
	}),
	docs: async (_context: ModuleCommandContext) => ({
		result: {
			...base,
			data: {
				docs: readFileSync(new URL("../DOCS.md", import.meta.url), "utf8"),
			},
		},
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
} as const;
