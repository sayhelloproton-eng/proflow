import { DatabaseSync } from "node:sqlite";

import type {
	IdempotencyRecord,
	NodeExecutionHistory,
	Task,
	TaskDocument,
	TaskEvent,
	TaskGroup,
	TaskMessage,
	TaskNode,
	TaskRepositories,
	TaskRoleBinding,
	TaskStore,
} from "@tomflow/proflow-task-orchestration";

export { type TaskMigration, taskMigrations } from "./migrations.ts";

type Row = Record<string, unknown>;
const json = (value: unknown): string => JSON.stringify(value);
const text = (value: unknown): string | null =>
	value === null || value === undefined ? null : String(value);
const number = (value: unknown): number => Number(value);
const boolean = (value: unknown): boolean | null =>
	value === null || value === undefined ? null : Number(value) === 1;
const list = (value: unknown): string[] =>
	JSON.parse(String(value)) as string[];

function group(row: Row): TaskGroup {
	return {
		taskGroupId: String(row.task_group_id),
		title: String(row.title),
		objective: text(row.objective),
		status: row.status as TaskGroup["status"],
		maxActiveTasks: 1,
		version: number(row.version),
		createdByRef: String(row.created_by_ref),
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
	};
}
function task(row: Row): Task {
	return {
		taskId: String(row.task_id),
		taskGroupId: text(row.task_group_id),
		sequenceNo: row.sequence_no === null ? null : number(row.sequence_no),
		title: String(row.title),
		objective: String(row.objective),
		status: row.status as Task["status"],
		version: number(row.version),
		planVersion: number(row.plan_version),
		currentNodeId: text(row.current_node_id),
		createdByRef: String(row.created_by_ref),
		createdAt: String(row.created_at),
		startedAt: text(row.started_at),
		completedAt: text(row.completed_at),
		updatedAt: String(row.updated_at),
	};
}
function node(row: Row): TaskNode {
	return {
		nodeId: String(row.node_id),
		taskId: String(row.task_id),
		sequenceNo: number(row.sequence_no),
		title: String(row.title),
		objective: String(row.objective),
		status: row.status as TaskNode["status"],
		version: number(row.version),
		runNo: number(row.run_no),
		requiredAgentPackageRef: String(row.required_agent_package_ref),
		workerRef: text(row.worker_ref),
		inputDocuments: list(row.input_documents_json),
		outputDocuments: list(row.output_documents_json),
		resultSummary: text(row.result_summary),
		errorCode: text(row.error_code),
		errorMessage: text(row.error_message),
		errorRetryable: boolean(row.error_retryable),
		startedAt: text(row.started_at),
		completedAt: text(row.completed_at),
		updatedAt: String(row.updated_at),
	};
}
function binding(row: Row): TaskRoleBinding {
	return {
		taskId: String(row.task_id),
		agentPackageRef: String(row.agent_package_ref),
		roleRef: String(row.role_ref),
		workerRef: text(row.worker_ref),
		conversationLocator: text(row.conversation_locator),
		version: number(row.version),
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
	};
}
function history(row: Row): NodeExecutionHistory {
	return {
		executionId: number(row.execution_id),
		taskId: String(row.task_id),
		nodeId: String(row.node_id),
		runNo: number(row.run_no),
		workerRef: text(row.worker_ref),
		finalStatus: row.final_status as NodeExecutionHistory["finalStatus"],
		resultSummary: text(row.result_summary),
		errorCode: text(row.error_code),
		errorMessage: text(row.error_message),
		errorRetryable: boolean(row.error_retryable),
		inputDocuments: list(row.input_documents_json),
		outputDocuments: list(row.output_documents_json),
		startedAt: text(row.started_at),
		endedAt: String(row.ended_at),
	};
}
function document(row: Row): TaskDocument {
	return {
		taskId: String(row.task_id),
		documentType: String(row.document_type),
		sourceNodeId: text(row.source_node_id),
		filePath: String(row.file_path),
		contentHash: String(row.content_hash),
		updatedByRef: String(row.updated_by_ref),
		updatedAt: String(row.updated_at),
	};
}
function message(row: Row): TaskMessage {
	return {
		messageId: String(row.message_id),
		taskId: String(row.task_id),
		nodeId: text(row.node_id),
		messageType: String(row.message_type),
		reasonCode: String(row.reason_code),
		message: String(row.message),
		relatedRef: text(row.related_ref),
		status: row.status as TaskMessage["status"],
		createdByRef: String(row.created_by_ref),
		createdAt: String(row.created_at),
		acknowledgedByRef: text(row.acknowledged_by_ref),
		acknowledgedAt: text(row.acknowledged_at),
		resolution: text(row.resolution),
	};
}
function event(row: Row): TaskEvent {
	return {
		eventId: number(row.event_id),
		taskId: String(row.task_id),
		nodeId: text(row.node_id),
		eventType: String(row.event_type),
		actorRef: String(row.actor_ref),
		taskVersion: row.task_version === null ? null : number(row.task_version),
		nodeVersion: row.node_version === null ? null : number(row.node_version),
		payload:
			row.payload_json === null
				? null
				: (JSON.parse(String(row.payload_json)) as Record<string, unknown>),
		createdAt: String(row.created_at),
	};
}
function idem(row: Row): IdempotencyRecord {
	return {
		idempotencyKey: String(row.idempotency_key),
		operation: String(row.operation),
		requestHash: String(row.request_hash),
		responseJson: String(row.response_json),
		createdAt: String(row.created_at),
	};
}

export class SqliteTaskStore implements TaskStore {
	#database: DatabaseSync;

	constructor(input: { databasePath: string; busyTimeoutMs?: number }) {
		this.#database = new DatabaseSync(input.databasePath);
		this.#database.exec(
			`PRAGMA busy_timeout = ${input.busyTimeoutMs ?? 2_500};`,
		);
		this.#database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
	}

	#repositories(): TaskRepositories {
		const db = this.#database;
		const get = (
			sql: string,
			...params: (string | number | null)[]
		): Row | undefined => db.prepare(sql).get(...params) as Row | undefined;
		const all = (sql: string, ...params: (string | number | null)[]): Row[] =>
			db.prepare(sql).all(...params) as Row[];
		return {
			taskGroups: {
				get: (id) => {
					const row = get(
						"SELECT * FROM task_groups WHERE task_group_id = ?",
						id,
					);
					return row ? group(row) : undefined;
				},
				insert: (v) => {
					db.prepare(
						"INSERT INTO task_groups VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
					).run(
						v.taskGroupId,
						v.title,
						v.objective,
						v.status,
						v.maxActiveTasks,
						v.version,
						v.createdByRef,
						v.createdAt,
						v.updatedAt,
					);
				},
				update: (v) => {
					const result = db
						.prepare(
							"UPDATE task_groups SET title=?, objective=?, status=?, max_active_tasks=?, version=?, updated_at=? WHERE task_group_id=? AND version=?",
						)
						.run(
							v.title,
							v.objective,
							v.status,
							v.maxActiveTasks,
							v.version,
							v.updatedAt,
							v.taskGroupId,
							v.version - 1,
						);
					if (Number(result.changes) !== 1)
						throw new Error("TASK_GROUP_VERSION_CONFLICT");
				},
				list: () =>
					all(
						"SELECT * FROM task_groups ORDER BY created_at, task_group_id",
					).map(group),
			},
			tasks: {
				get: (id) => {
					const row = get("SELECT * FROM tasks WHERE task_id = ?", id);
					return row ? task(row) : undefined;
				},
			insert: (v) => {
				db.prepare(
					"INSERT INTO tasks(task_id,task_group_id,sequence_no,title,objective,status,version,plan_version,current_node_id,created_by_ref,created_at,started_at,completed_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
				).run(
					v.taskId,
					v.taskGroupId,
					v.sequenceNo,
					v.title,
					v.objective,
					v.status,
					v.version,
					v.planVersion,
					v.currentNodeId,
					v.createdByRef,
					v.createdAt,
					v.startedAt,
					v.completedAt,
					v.updatedAt,
				);
			},
			update: (v) => {
				const result = db
					.prepare(
						"UPDATE tasks SET status=?, version=?, current_node_id=?, started_at=?, completed_at=?, updated_at=? WHERE task_id=? AND version=?",
					)
					.run(
						v.status,
						v.version,
						v.currentNodeId,
						v.startedAt,
						v.completedAt,
						v.updatedAt,
						v.taskId,
						v.version - 1,
					);
				if (Number(result.changes) !== 1)
					throw new Error("TASK_VERSION_CONFLICT");
			},
				list: (groupId) =>
					(groupId === undefined
						? all(
								"SELECT * FROM tasks ORDER BY COALESCE(sequence_no, 2147483647), created_at, task_id",
							)
						: all(
								"SELECT * FROM tasks WHERE task_group_id = ? ORDER BY sequence_no, task_id",
								groupId,
							)
					).map(task),
			},
			nodes: {
				get: (id) => {
					const row = get("SELECT * FROM nodes WHERE node_id = ?", id);
					return row ? node(row) : undefined;
				},
			insert: (v) => {
				db.prepare(
					"INSERT INTO nodes(node_id,task_id,sequence_no,title,objective,status,version,run_no,required_agent_package_ref,worker_ref,input_documents_json,output_documents_json,result_summary,error_code,error_message,error_retryable,started_at,completed_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
				).run(
					v.nodeId,
					v.taskId,
					v.sequenceNo,
					v.title,
					v.objective,
					v.status,
					v.version,
					v.runNo,
					v.requiredAgentPackageRef,
					v.workerRef,
						json(v.inputDocuments),
						json(v.outputDocuments),
						v.resultSummary,
						v.errorCode,
						v.errorMessage,
						v.errorRetryable === null ? null : Number(v.errorRetryable),
						v.startedAt,
						v.completedAt,
						v.updatedAt,
					);
				},
				update: (v) => {
					const result = db
						.prepare(
							"UPDATE nodes SET status=?, version=?, run_no=?, worker_ref=?, result_summary=?, error_code=?, error_message=?, error_retryable=?, started_at=?, completed_at=?, updated_at=? WHERE node_id=? AND version=?",
						)
						.run(
							v.status,
							v.version,
							v.runNo,
							v.workerRef,
							v.resultSummary,
							v.errorCode,
							v.errorMessage,
							v.errorRetryable === null ? null : Number(v.errorRetryable),
							v.startedAt,
							v.completedAt,
							v.updatedAt,
							v.nodeId,
							v.version - 1,
						);
					if (Number(result.changes) !== 1)
						throw new Error("NODE_VERSION_CONFLICT");
				},
				listByTask: (taskId) =>
					all(
						"SELECT * FROM nodes WHERE task_id = ? ORDER BY sequence_no, node_id",
						taskId,
					).map(node),
			},
		roleBindings: {
			get: (taskId, agentPackageRef) => {
				const row = get(
					"SELECT * FROM task_role_bindings WHERE task_id=? AND agent_package_ref=?",
					taskId,
					agentPackageRef,
				);
				return row ? binding(row) : undefined;
			},
			upsert: (v) => {
				db.prepare(
					"INSERT INTO task_role_bindings VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(task_id, agent_package_ref) DO UPDATE SET role_ref=excluded.role_ref, worker_ref=excluded.worker_ref, conversation_locator=excluded.conversation_locator, version=excluded.version, updated_at=excluded.updated_at",
				).run(
					v.taskId,
					v.agentPackageRef,
					v.roleRef,
					v.workerRef,
					v.conversationLocator,
					v.version,
					v.createdAt,
					v.updatedAt,
				);
			},
			listByTask: (taskId) =>
				all(
					"SELECT * FROM task_role_bindings WHERE task_id=? ORDER BY agent_package_ref",
					taskId,
				).map(binding),
		},
			executionHistory: {
				insert: (v) => {
					db.prepare(
						"INSERT INTO node_execution_history(task_id,node_id,run_no,worker_ref,final_status,result_summary,error_code,error_message,error_retryable,input_documents_json,output_documents_json,started_at,ended_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
					).run(
						v.taskId,
						v.nodeId,
						v.runNo,
						v.workerRef,
						v.finalStatus,
						v.resultSummary,
						v.errorCode,
						v.errorMessage,
						v.errorRetryable === null ? null : Number(v.errorRetryable),
						json(v.inputDocuments),
						json(v.outputDocuments),
						v.startedAt,
						v.endedAt,
					);
				},
				listByTask: (taskId) =>
					all(
						"SELECT * FROM node_execution_history WHERE task_id=? ORDER BY execution_id",
						taskId,
					).map(history),
			},
			documents: {
				get: (taskId, type) => {
					const row = get(
						"SELECT * FROM task_documents WHERE task_id=? AND document_type=?",
						taskId,
						type,
					);
					return row ? document(row) : undefined;
				},
				upsert: (v) => {
					db.prepare(
						"INSERT INTO task_documents VALUES (?,?,?,?,?,?,?) ON CONFLICT(task_id,document_type) DO UPDATE SET source_node_id=excluded.source_node_id,file_path=excluded.file_path,content_hash=excluded.content_hash,updated_by_ref=excluded.updated_by_ref,updated_at=excluded.updated_at",
					).run(
						v.taskId,
						v.documentType,
						v.sourceNodeId,
						v.filePath,
						v.contentHash,
						v.updatedByRef,
						v.updatedAt,
					);
				},
				listByTask: (taskId) =>
					all(
						"SELECT * FROM task_documents WHERE task_id=? ORDER BY document_type",
						taskId,
					).map(document),
			},
			messages: {
				get: (id) => {
					const row = get("SELECT * FROM task_messages WHERE message_id=?", id);
					return row ? message(row) : undefined;
				},
				insert: (v) => {
					db.prepare(
						"INSERT INTO task_messages(message_id,task_id,node_id,message_type,reason_code,message,related_ref,status,created_by_ref,created_at,acknowledged_by_ref,acknowledged_at,resolution) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
					).run(
						v.messageId,
						v.taskId,
						v.nodeId,
						v.messageType,
						v.reasonCode,
						v.message,
						v.relatedRef,
						v.status,
						v.createdByRef,
						v.createdAt,
						v.acknowledgedByRef,
						v.acknowledgedAt,
						v.resolution,
					);
				},
				update: (v) => {
					db.prepare(
						"UPDATE task_messages SET status=?,acknowledged_by_ref=?,acknowledged_at=?,resolution=? WHERE message_id=?",
					).run(
						v.status,
						v.acknowledgedByRef,
						v.acknowledgedAt,
						v.resolution,
						v.messageId,
					);
				},
				listPending: () =>
					all(
						"SELECT * FROM task_messages WHERE status='PENDING' ORDER BY created_at,message_id",
					).map(message),
			},
			events: {
				insert: (v) => {
					db.prepare(
						"INSERT INTO task_events(task_id,node_id,event_type,actor_ref,task_version,node_version,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)",
					).run(
						v.taskId,
						v.nodeId,
						v.eventType,
						v.actorRef,
						v.taskVersion,
						v.nodeVersion,
						v.payload === null ? null : json(v.payload),
						v.createdAt,
					);
				},
				listByTask: (taskId) =>
					all(
						"SELECT * FROM task_events WHERE task_id=? ORDER BY event_id",
						taskId,
					).map(event),
			},
			idempotency: {
				get: (key) => {
					const row = get(
						"SELECT * FROM idempotency_records WHERE idempotency_key=?",
						key,
					);
					return row ? idem(row) : undefined;
				},
				insert: (v) => {
					db.prepare("INSERT INTO idempotency_records VALUES (?,?,?,?,?)").run(
						v.idempotencyKey,
						v.operation,
						v.requestHash,
						v.responseJson,
						v.createdAt,
					);
				},
			},
		};
	}

	transaction<T>(work: (repositories: TaskRepositories) => T): T {
		this.#database.exec("BEGIN IMMEDIATE");
		try {
			const result = work(this.#repositories());
			this.#database.exec("COMMIT");
			return result;
		} catch (error) {
			this.#database.exec("ROLLBACK");
			throw error;
		}
	}
	read<T>(work: (repositories: TaskRepositories) => T): T {
		return work(this.#repositories());
	}
	close(): void {
		this.#database.close();
	}
	diagnostics(): {
		journalMode: string;
		busyTimeoutMs: number;
		integrity: string;
	} {
		const journal = this.#database.prepare("PRAGMA journal_mode").get() as {
			journal_mode: string;
		};
		const timeout = this.#database.prepare("PRAGMA busy_timeout").get() as {
			timeout: number;
		};
		const integrity = this.#database
			.prepare("PRAGMA integrity_check")
			.get() as { integrity_check: string };
		return {
			journalMode: journal.journal_mode,
			busyTimeoutMs: timeout.timeout,
			integrity: integrity.integrity_check,
		};
	}
	inspectCounts(): Record<string, number> {
		const tables = [
			"task_groups",
			"tasks",
			"nodes",
			"task_role_bindings",
			"node_execution_history",
			"task_documents",
			"task_messages",
			"task_events",
			"idempotency_records",
		];
		return Object.fromEntries(
			tables.map((table) => [
				table,
				Number(
					(
						this.#database
							.prepare(`SELECT COUNT(*) AS count FROM ${table}`)
							.get() as { count: number }
					).count,
				),
			]),
		);
	}
	inspectSchema(): {
		tables: string[];
		indexes: string[];
		foreignKeys: Record<string, string[]>;
		columns: Record<string, string[]>;
	} {
		const tables = (
			this.#database
				.prepare(
					"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
				)
				.all() as Array<{ name: string }>
		).map((row) => row.name);
		const indexes = (
			this.#database
				.prepare(
					"SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
				)
				.all() as Array<{ name: string }>
		).map((row) => row.name);
		const foreignKeys = Object.fromEntries(
			tables.map((table) => [
				table,
				(
					this.#database
						.prepare(`PRAGMA foreign_key_list(${table})`)
						.all() as Array<{ table: string; to: string }>
				).map((row) => `${row.table}.${row.to}`),
			]),
		);
		const columns = Object.fromEntries(
			tables.map((table) => [
				table,
				(
					this.#database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
						name: string;
					}>
				).map((row) => row.name),
			]),
		);
		return { tables, indexes, foreignKeys, columns };
	}
}
