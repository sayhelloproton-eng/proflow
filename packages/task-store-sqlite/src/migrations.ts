import type { DatabaseSync } from "node:sqlite";

export interface LegacyRoleBindingDescriptor {
	agentPackageRef: string;
	roleRef: string;
	conversationLocator?: string | null;
}

export interface TaskMigrationContext {
	legacyRoleMap?: Readonly<Record<string, string>>;
	legacyRoleBindings?: Readonly<Record<string, LegacyRoleBindingDescriptor>>;
}

export interface TaskMigration {
	version: number;
	name: string;
	sql: string;
	identity?: string;
	coversLegacyVersions?: readonly number[];
	apply?: (database: DatabaseSync, context: TaskMigrationContext) => void;
	verify?: (database: DatabaseSync) => readonly string[];
}

const fixedAgentPackageRefs = new Set([
	"@tomflow/proflow-agent-product",
	"@tomflow/proflow-agent-controller-dev",
	"@tomflow/proflow-agent-test-ops",
]);

function tableColumns(database: DatabaseSync, table: string): Set<string> {
	return new Set(
		(
			database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
				name: string;
			}>
		).map((row) => row.name),
	);
}

function resolveLegacyAgentPackageRef(
	legacyRoleRef: string,
	context: TaskMigrationContext,
): string {
	if (fixedAgentPackageRefs.has(legacyRoleRef)) return legacyRoleRef;
	const mapped = context.legacyRoleMap?.[legacyRoleRef];
	if (mapped && fixedAgentPackageRefs.has(mapped)) return mapped;
	const descriptor = context.legacyRoleBindings?.[legacyRoleRef];
	if (descriptor && fixedAgentPackageRefs.has(descriptor.agentPackageRef))
		return descriptor.agentPackageRef;
	throw new Error(`LEGACY_TASK_ROLE_MAPPING_REQUIRED:${legacyRoleRef}`);
}

function tableExists(database: DatabaseSync, table: string): boolean {
	return Boolean(
		database
			.prepare(
				"SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?",
			)
			.get(table),
	);
}

type ColumnInfo = { name: string; notnull: number; pk: number };
function tableInfo(database: DatabaseSync, table: string): ColumnInfo[] {
	return database.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
}

function columnInfo(
	database: DatabaseSync,
	table: string,
	column: string,
): ColumnInfo | undefined {
	return tableInfo(database, table).find((item) => item.name === column);
}

function resolveLegacyRoleBinding(
	legacyRoleRef: string,
	agentPackageRef: string,
	context: TaskMigrationContext,
): LegacyRoleBindingDescriptor {
	const descriptor =
		context.legacyRoleBindings?.[legacyRoleRef] ??
		context.legacyRoleBindings?.[agentPackageRef];
	if (!descriptor)
		throw new Error(`LEGACY_TASK_BINDING_MAPPING_REQUIRED:${legacyRoleRef}`);
	if (descriptor.agentPackageRef !== agentPackageRef)
		throw new Error(`LEGACY_TASK_BINDING_MAPPING_CONFLICT:${legacyRoleRef}`);
	if (!fixedAgentPackageRefs.has(descriptor.agentPackageRef))
		throw new Error(`LEGACY_TASK_ROLE_MAPPING_REQUIRED:${legacyRoleRef}`);
	if (!descriptor.roleRef)
		throw new Error(`LEGACY_TASK_BINDING_MAPPING_REQUIRED:${legacyRoleRef}`);
	return descriptor;
}

function canonicalizeLegacyNodes(
	database: DatabaseSync,
	context: TaskMigrationContext,
): Array<{
	taskId: string;
	legacyRoleRef: string;
	agentPackageRef: string;
	workerRef: string | null;
}> {
	if (!tableExists(database, "nodes"))
		throw new Error("LEGACY_TASK_SCHEMA_UNSUPPORTED:nodes");
	let columns = tableColumns(database, "nodes");
	if (
		!columns.has("required_role_ref") &&
		!columns.has("required_agent_package_ref")
	)
		throw new Error("LEGACY_TASK_SCHEMA_UNSUPPORTED:nodes");

	const legacyRows = database
		.prepare(
			columns.has("required_role_ref")
				? "SELECT node_id, task_id, required_role_ref AS legacy_ref, required_agent_package_ref AS current_ref, worker_ref FROM nodes".replace(
						", required_agent_package_ref AS current_ref",
						columns.has("required_agent_package_ref")
							? ", required_agent_package_ref AS current_ref"
							: ", NULL AS current_ref",
					)
				: "SELECT node_id, task_id, required_agent_package_ref AS legacy_ref, required_agent_package_ref AS current_ref, worker_ref FROM nodes",
		)
		.all() as Array<{
		node_id: string;
		task_id: string;
		legacy_ref: string | null;
		current_ref: string | null;
		worker_ref: string | null;
	}>;
	const resolved = legacyRows.map((row) => {
		const sourceRef =
			row.current_ref && fixedAgentPackageRefs.has(row.current_ref)
				? row.current_ref
				: row.legacy_ref;
		if (!sourceRef)
			throw new Error("LEGACY_TASK_SCHEMA_UPGRADE_INCOMPLETE:nodes");
		return {
			nodeId: row.node_id,
			taskId: row.task_id,
			legacyRoleRef: row.legacy_ref ?? sourceRef,
			agentPackageRef: resolveLegacyAgentPackageRef(sourceRef, context),
			workerRef: row.worker_ref,
		};
	});

	if (columns.has("required_role_ref")) {
		const updateLegacy = database.prepare(
			"UPDATE nodes SET required_role_ref=? WHERE node_id=?",
		);
		for (const row of resolved)
			updateLegacy.run(row.agentPackageRef, row.nodeId);
		if (columns.has("required_agent_package_ref"))
			database.exec("ALTER TABLE nodes DROP COLUMN required_agent_package_ref");
		database.exec(
			"ALTER TABLE nodes RENAME COLUMN required_role_ref TO required_agent_package_ref",
		);
		columns = tableColumns(database, "nodes");
	} else {
		const updateCanonical = database.prepare(
			"UPDATE nodes SET required_agent_package_ref=? WHERE node_id=?",
		);
		for (const row of resolved)
			updateCanonical.run(row.agentPackageRef, row.nodeId);
	}

	const requiredPackageColumn = columnInfo(
		database,
		"nodes",
		"required_agent_package_ref",
	);
	if (requiredPackageColumn?.notnull !== 1 || columns.has("required_role_ref"))
		throw new Error("LEGACY_TASK_SCHEMA_UPGRADE_INCOMPLETE:nodes_constraints");
	return resolved.map(({ nodeId: _nodeId, ...row }) => row);
}

function createCanonicalTaskRoleBindings(database: DatabaseSync): void {
	database.exec(`
CREATE TABLE task_role_bindings (
  task_id TEXT NOT NULL,
  agent_package_ref TEXT NOT NULL,
  role_ref TEXT NOT NULL,
  worker_ref TEXT,
  conversation_locator TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (task_id, agent_package_ref),
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
);`);
}

function canonicalizeLegacyBindings(
	database: DatabaseSync,
	context: TaskMigrationContext,
	nodeFacts: Array<{
		taskId: string;
		legacyRoleRef: string;
		agentPackageRef: string;
		workerRef: string | null;
	}>,
): void {
	if (!tableExists(database, "task_role_bindings")) {
		createCanonicalTaskRoleBindings(database);
		const tasks = database
			.prepare(
				"SELECT task_id, created_at, updated_at FROM tasks ORDER BY task_id",
			)
			.all() as Array<{
			task_id: string;
			created_at: string;
			updated_at: string;
		}>;
		const insert = database.prepare(
			"INSERT INTO task_role_bindings(task_id,agent_package_ref,role_ref,worker_ref,conversation_locator,version,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)",
		);
		for (const task of tasks) {
			for (const agentPackageRef of fixedAgentPackageRefs) {
				const facts = nodeFacts.filter(
					(fact) =>
						fact.taskId === task.task_id &&
						fact.agentPackageRef === agentPackageRef,
				);
				const legacyRoleRefs = new Set(facts.map((fact) => fact.legacyRoleRef));
				if (legacyRoleRefs.size > 1)
					throw new Error("LEGACY_TASK_BINDING_AMBIGUOUS:role");
				const workerRefs = new Set(
					facts
						.map((fact) => fact.workerRef)
						.filter((workerRef): workerRef is string => workerRef !== null),
				);
				if (workerRefs.size > 1)
					throw new Error("LEGACY_TASK_BINDING_AMBIGUOUS:worker");
				const legacyRoleRef = [...legacyRoleRefs][0] ?? agentPackageRef;
				const descriptor = resolveLegacyRoleBinding(
					legacyRoleRef,
					agentPackageRef,
					context,
				);
				insert.run(
					task.task_id,
					agentPackageRef,
					descriptor.roleRef,
					[...workerRefs][0] ?? null,
					descriptor.conversationLocator ?? null,
					task.created_at,
					task.updated_at,
				);
			}
		}
		return;
	}

	const info = tableInfo(database, "task_role_bindings");
	const names = new Set(info.map((item) => item.name));
	const agentPackage = info.find((item) => item.name === "agent_package_ref");
	const taskId = info.find((item) => item.name === "task_id");
	const canonical =
		names.has("conversation_locator") &&
		agentPackage?.notnull === 1 &&
		agentPackage.pk === 2 &&
		taskId?.pk === 1;
	if (canonical) {
		const rows = database
			.prepare(
				"SELECT task_id,agent_package_ref,role_ref FROM task_role_bindings",
			)
			.all() as Array<{
			task_id: string;
			agent_package_ref: string;
			role_ref: string;
		}>;
		for (const row of rows)
			if (!fixedAgentPackageRefs.has(row.agent_package_ref))
				throw new Error(
					`LEGACY_TASK_ROLE_MAPPING_REQUIRED:${row.agent_package_ref || row.role_ref}`,
				);
		return;
	}

	const hasAgentPackage = names.has("agent_package_ref");
	const hasConversationLocator = names.has("conversation_locator");
	const rows = database
		.prepare(
			`SELECT task_id, role_ref, worker_ref, version, created_at, updated_at, ${
				hasAgentPackage ? "agent_package_ref" : "NULL"
			} AS agent_package_ref, ${
				hasConversationLocator ? "conversation_locator" : "NULL"
			} AS conversation_locator FROM task_role_bindings`,
		)
		.all() as Array<{
		task_id: string;
		role_ref: string;
		worker_ref: string | null;
		version: number;
		created_at: string;
		updated_at: string;
		agent_package_ref: string | null;
		conversation_locator: string | null;
	}>;
	database.exec(
		"ALTER TABLE task_role_bindings RENAME TO task_role_bindings_legacy_v3",
	);
	createCanonicalTaskRoleBindings(database);
	const insert = database.prepare(
		"INSERT INTO task_role_bindings(task_id,agent_package_ref,role_ref,worker_ref,conversation_locator,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
	);
	for (const row of rows) {
		const sourceRef = row.agent_package_ref ?? row.role_ref;
		let packageRef: string;
		try {
			packageRef = resolveLegacyAgentPackageRef(sourceRef, context);
		} catch {
			packageRef = resolveLegacyAgentPackageRef(row.role_ref, context);
		}
		insert.run(
			row.task_id,
			packageRef,
			row.role_ref,
			row.worker_ref,
			row.conversation_locator,
			row.version,
			row.created_at,
			row.updated_at,
		);
	}
	database.exec("DROP TABLE task_role_bindings_legacy_v3");
}

function isHistorical20260810Shape(database: DatabaseSync): boolean {
	if (!tableExists(database, "nodes")) return false;
	const nodeColumns = tableColumns(database, "nodes");
	return (
		nodeColumns.has("required_role_ref") &&
		!nodeColumns.has("required_agent_package_ref") &&
		!tableExists(database, "task_role_bindings")
	);
}

function rebuildHistorical20260810Schema(
	database: DatabaseSync,
	context: TaskMigrationContext,
): void {
	const requiredHistoricalTables = [
		"task_groups",
		"tasks",
		"nodes",
		"node_execution_history",
		"task_documents",
		"task_messages",
		"task_events",
		"idempotency_records",
	] as const;
	for (const table of requiredHistoricalTables)
		if (!tableExists(database, table))
			throw new Error(`LEGACY_TASK_SCHEMA_UNSUPPORTED:${table}`);

	const historicalNodes = database
		.prepare(
			"SELECT node_id,task_id,required_role_ref,worker_ref FROM nodes ORDER BY task_id,sequence_no,node_id",
		)
		.all() as Array<{
		node_id: string;
		task_id: string;
		required_role_ref: string;
		worker_ref: string | null;
	}>;
	const nodeFacts = historicalNodes.map((row) => ({
		nodeId: row.node_id,
		taskId: row.task_id,
		legacyRoleRef: row.required_role_ref,
		agentPackageRef: resolveLegacyAgentPackageRef(
			row.required_role_ref,
			context,
		),
		workerRef: row.worker_ref,
	}));

	database.exec(`
CREATE TABLE task_groups_v3 (
  task_group_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  objective TEXT,
  status TEXT NOT NULL CHECK (status IN ('READY','ACTIVE','SUCCEEDED')),
  max_active_tasks INTEGER NOT NULL DEFAULT 1 CHECK (max_active_tasks = 1),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE tasks_v3 (
  task_id TEXT PRIMARY KEY,
  task_group_id TEXT,
  sequence_no INTEGER,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','READY','ACTIVE','WAITING','FAILED','PAUSED','SUCCEEDED','TERMINATED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  plan_version INTEGER NOT NULL DEFAULT 1,
  current_node_id TEXT,
  created_by_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_group_id) REFERENCES task_groups_v3(task_group_id),
  UNIQUE(task_group_id, sequence_no)
);
CREATE TABLE nodes_v3 (
  node_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  sequence_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','READY','IN_PROGRESS','WAITING','FAILED','SUCCEEDED','TERMINATED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  run_no INTEGER NOT NULL DEFAULT 1 CHECK (run_no >= 1),
  required_agent_package_ref TEXT NOT NULL,
  worker_ref TEXT,
  input_documents_json TEXT NOT NULL DEFAULT '[]',
  output_documents_json TEXT NOT NULL DEFAULT '[]',
  result_summary TEXT,
  error_code TEXT,
  error_message TEXT,
  error_retryable INTEGER,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks_v3(task_id) ON DELETE CASCADE,
  UNIQUE(task_id, sequence_no)
);
CREATE TABLE task_role_bindings_v3 (
  task_id TEXT NOT NULL,
  agent_package_ref TEXT NOT NULL,
  role_ref TEXT NOT NULL,
  worker_ref TEXT,
  conversation_locator TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (task_id, agent_package_ref),
  FOREIGN KEY (task_id) REFERENCES tasks_v3(task_id) ON DELETE CASCADE
);
CREATE TABLE node_execution_history_v3 (
  execution_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  run_no INTEGER NOT NULL,
  worker_ref TEXT,
  final_status TEXT NOT NULL,
  result_summary TEXT,
  error_code TEXT,
  error_message TEXT,
  error_retryable INTEGER,
  input_documents_json TEXT NOT NULL DEFAULT '[]',
  output_documents_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT,
  ended_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks_v3(task_id),
  FOREIGN KEY (node_id) REFERENCES nodes_v3(node_id),
  UNIQUE(node_id, run_no)
);
CREATE TABLE task_documents_v3 (
  task_id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  source_node_id TEXT,
  file_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  updated_by_ref TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (task_id, document_type),
  FOREIGN KEY (task_id) REFERENCES tasks_v3(task_id) ON DELETE CASCADE
);
CREATE TABLE task_messages_v3 (
  message_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  node_id TEXT,
  message_type TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  message TEXT NOT NULL,
  related_ref TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACKNOWLEDGED')),
  created_by_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  acknowledged_by_ref TEXT,
  acknowledged_at TEXT,
  resolution TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks_v3(task_id) ON DELETE CASCADE
);
CREATE TABLE task_events_v3 (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  node_id TEXT,
  event_type TEXT NOT NULL,
  actor_ref TEXT NOT NULL,
  task_version INTEGER,
  node_version INTEGER,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks_v3(task_id) ON DELETE CASCADE
);
CREATE TABLE idempotency_records_v3 (
  idempotency_key TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

	database.exec(`
INSERT INTO task_groups_v3 SELECT * FROM task_groups;
INSERT INTO tasks_v3 SELECT * FROM tasks;
`);
	const insertNode = database.prepare(`
INSERT INTO nodes_v3(
  node_id,task_id,sequence_no,title,objective,status,version,run_no,
  required_agent_package_ref,worker_ref,input_documents_json,output_documents_json,
  result_summary,error_code,error_message,error_retryable,started_at,completed_at,updated_at
)
SELECT node_id,task_id,sequence_no,title,objective,status,version,run_no,?,worker_ref,
       input_documents_json,output_documents_json,result_summary,error_code,error_message,
       error_retryable,started_at,completed_at,updated_at
FROM nodes WHERE node_id=?`);
	for (const fact of nodeFacts)
		insertNode.run(fact.agentPackageRef, fact.nodeId);

	const tasks = database
		.prepare("SELECT task_id,created_at,updated_at FROM tasks ORDER BY task_id")
		.all() as Array<{
		task_id: string;
		created_at: string;
		updated_at: string;
	}>;
	const insertBinding = database.prepare(
		"INSERT INTO task_role_bindings_v3(task_id,agent_package_ref,role_ref,worker_ref,conversation_locator,version,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)",
	);
	for (const task of tasks) {
		for (const agentPackageRef of fixedAgentPackageRefs) {
			const facts = nodeFacts.filter(
				(fact) =>
					fact.taskId === task.task_id &&
					fact.agentPackageRef === agentPackageRef,
			);
			const legacyRoleRefs = new Set(facts.map((fact) => fact.legacyRoleRef));
			if (legacyRoleRefs.size > 1)
				throw new Error("LEGACY_TASK_BINDING_AMBIGUOUS:role");
			const workerRefs = new Set(
				facts
					.map((fact) => fact.workerRef)
					.filter((workerRef): workerRef is string => workerRef !== null),
			);
			if (workerRefs.size > 1)
				throw new Error("LEGACY_TASK_BINDING_AMBIGUOUS:worker");
			const legacyRoleRef = [...legacyRoleRefs][0] ?? agentPackageRef;
			const descriptor = resolveLegacyRoleBinding(
				legacyRoleRef,
				agentPackageRef,
				context,
			);
			insertBinding.run(
				task.task_id,
				agentPackageRef,
				descriptor.roleRef,
				[...workerRefs][0] ?? null,
				descriptor.conversationLocator ?? null,
				task.created_at,
				task.updated_at,
			);
		}
	}

	database.exec(`
INSERT INTO node_execution_history_v3 SELECT * FROM node_execution_history;
INSERT INTO task_documents_v3 SELECT * FROM task_documents;
INSERT INTO task_messages_v3 SELECT * FROM task_messages;
INSERT INTO task_events_v3 SELECT * FROM task_events;
INSERT INTO idempotency_records_v3 SELECT * FROM idempotency_records;

DROP TABLE task_events;
DROP TABLE task_messages;
DROP TABLE task_documents;
DROP TABLE node_execution_history;
DROP TABLE nodes;
DROP TABLE tasks;
DROP TABLE task_groups;
DROP TABLE idempotency_records;

ALTER TABLE task_groups_v3 RENAME TO task_groups;
ALTER TABLE tasks_v3 RENAME TO tasks;
ALTER TABLE nodes_v3 RENAME TO nodes;
ALTER TABLE task_role_bindings_v3 RENAME TO task_role_bindings;
ALTER TABLE node_execution_history_v3 RENAME TO node_execution_history;
ALTER TABLE task_documents_v3 RENAME TO task_documents;
ALTER TABLE task_messages_v3 RENAME TO task_messages;
ALTER TABLE task_events_v3 RENAME TO task_events;
ALTER TABLE idempotency_records_v3 RENAME TO idempotency_records;

CREATE INDEX idx_tasks_group_sequence ON tasks(task_group_id, sequence_no);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_nodes_task_sequence ON nodes(task_id, sequence_no);
CREATE INDEX idx_nodes_task_status ON nodes(task_id, status);
CREATE INDEX idx_messages_pending ON task_messages(status, created_at);
CREATE INDEX idx_events_task ON task_events(task_id, event_id);
`);
}

function tableSql(database: DatabaseSync, table: string): string {
	const row = database
		.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
		.get(table) as { sql?: string | null } | undefined;
	return (row?.sql ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

function hasUniqueColumns(
	database: DatabaseSync,
	table: string,
	columns: readonly string[],
): boolean {
	const indexes = database
		.prepare(`PRAGMA index_list(${table})`)
		.all() as Array<{
		name: string;
		unique: number;
	}>;
	return indexes.some((index) => {
		if (index.unique !== 1) return false;
		const names = (
			database.prepare(`PRAGMA index_info(${index.name})`).all() as Array<{
				seqno: number;
				name: string;
			}>
		)
			.sort((left, right) => left.seqno - right.seqno)
			.map((item) => item.name);
		return (
			names.length === columns.length &&
			names.every((name, i) => name === columns[i])
		);
	});
}

function applyTaskSchemaCompatibilityV3(
	database: DatabaseSync,
	context: TaskMigrationContext,
): void {
	if (isHistorical20260810Shape(database))
		rebuildHistorical20260810Schema(database, context);
	else {
		const nodeFacts = canonicalizeLegacyNodes(database, context);
		canonicalizeLegacyBindings(database, context, nodeFacts);
	}

	const nodePackage = columnInfo(
		database,
		"nodes",
		"required_agent_package_ref",
	);
	const bindingInfo = tableInfo(database, "task_role_bindings");
	const bindingPackage = bindingInfo.find(
		(item) => item.name === "agent_package_ref",
	);
	const bindingTask = bindingInfo.find((item) => item.name === "task_id");
	if (
		nodePackage?.notnull !== 1 ||
		bindingPackage?.notnull !== 1 ||
		bindingPackage.pk !== 2 ||
		bindingTask?.pk !== 1 ||
		!bindingInfo.some((item) => item.name === "conversation_locator")
	)
		throw new Error("LEGACY_TASK_SCHEMA_UPGRADE_INCOMPLETE:canonical_shape");
}

function verifyTaskSchemaCompatibilityV3(
	database: DatabaseSync,
): readonly string[] {
	const issues: string[] = [];
	const expectedNodeColumns = new Set([
		"node_id",
		"task_id",
		"sequence_no",
		"title",
		"objective",
		"status",
		"version",
		"run_no",
		"required_agent_package_ref",
		"worker_ref",
		"input_documents_json",
		"output_documents_json",
		"result_summary",
		"error_code",
		"error_message",
		"error_retryable",
		"started_at",
		"completed_at",
		"updated_at",
	]);
	const expectedBindingColumns = new Set([
		"task_id",
		"agent_package_ref",
		"role_ref",
		"worker_ref",
		"conversation_locator",
		"version",
		"created_at",
		"updated_at",
	]);
	if (!tableExists(database, "nodes")) issues.push("nodes:missing");
	else {
		const info = tableInfo(database, "nodes");
		const names = new Set(info.map((item) => item.name));
		if (
			names.size !== expectedNodeColumns.size ||
			[...expectedNodeColumns].some((name) => !names.has(name))
		)
			issues.push("nodes:column_shape_mismatch");
		const required = info.find(
			(item) => item.name === "required_agent_package_ref",
		);
		if (!required) issues.push("nodes.required_agent_package_ref:missing");
		else if (required.notnull !== 1)
			issues.push("nodes.required_agent_package_ref:not_null_required");
		if (names.has("required_role_ref"))
			issues.push("nodes.required_role_ref:legacy_column_present");
		if (required) {
			const invalid = database
				.prepare(
					`SELECT COUNT(*) AS count FROM nodes WHERE required_agent_package_ref NOT IN (${[
						...fixedAgentPackageRefs,
					]
						.map(() => "?")
						.join(",")})`,
				)
				.get(...fixedAgentPackageRefs) as { count: number };
			if (Number(invalid.count) !== 0)
				issues.push("nodes.required_agent_package_ref:invalid_value");
		}
	}
	if (!tableExists(database, "task_role_bindings"))
		issues.push("task_role_bindings:missing");
	else {
		const info = tableInfo(database, "task_role_bindings");
		const names = new Set(info.map((item) => item.name));
		if (
			names.size !== expectedBindingColumns.size ||
			[...expectedBindingColumns].some((name) => !names.has(name))
		)
			issues.push("task_role_bindings:column_shape_mismatch");
		const taskId = info.find((item) => item.name === "task_id");
		const packageRef = info.find((item) => item.name === "agent_package_ref");
		const roleRef = info.find((item) => item.name === "role_ref");
		if (taskId?.pk !== 1) issues.push("task_role_bindings.task_id:pk_order");
		if (!packageRef)
			issues.push("task_role_bindings.agent_package_ref:missing");
		else {
			if (packageRef.notnull !== 1)
				issues.push("task_role_bindings.agent_package_ref:not_null_required");
			if (packageRef.pk !== 2)
				issues.push("task_role_bindings.agent_package_ref:pk_order");
		}
		if (roleRef?.notnull !== 1)
			issues.push("task_role_bindings.role_ref:not_null_required");
		for (const column of ["version", "created_at", "updated_at"]) {
			if (info.find((item) => item.name === column)?.notnull !== 1)
				issues.push(`task_role_bindings.${column}:not_null_required`);
		}
		if (!names.has("conversation_locator"))
			issues.push("task_role_bindings.conversation_locator:missing");
		if (packageRef) {
			const invalid = database
				.prepare(
					`SELECT COUNT(*) AS count FROM task_role_bindings WHERE agent_package_ref NOT IN (${[
						...fixedAgentPackageRefs,
					]
						.map(() => "?")
						.join(",")})`,
				)
				.get(...fixedAgentPackageRefs) as { count: number };
			if (Number(invalid.count) !== 0)
				issues.push("task_role_bindings.agent_package_ref:invalid_value");
		}
	}

	const expectedColumnsByTable: Readonly<Record<string, readonly string[]>> = {
		task_groups: [
			"task_group_id",
			"title",
			"objective",
			"status",
			"max_active_tasks",
			"version",
			"created_by_ref",
			"created_at",
			"updated_at",
		],
		tasks: [
			"task_id",
			"task_group_id",
			"sequence_no",
			"title",
			"objective",
			"status",
			"version",
			"plan_version",
			"current_node_id",
			"created_by_ref",
			"created_at",
			"started_at",
			"completed_at",
			"updated_at",
		],
		node_execution_history: [
			"execution_id",
			"task_id",
			"node_id",
			"run_no",
			"worker_ref",
			"final_status",
			"result_summary",
			"error_code",
			"error_message",
			"error_retryable",
			"input_documents_json",
			"output_documents_json",
			"started_at",
			"ended_at",
		],
		task_documents: [
			"task_id",
			"document_type",
			"source_node_id",
			"file_path",
			"content_hash",
			"updated_by_ref",
			"updated_at",
		],
		task_messages: [
			"message_id",
			"task_id",
			"node_id",
			"message_type",
			"reason_code",
			"message",
			"related_ref",
			"status",
			"created_by_ref",
			"created_at",
			"acknowledged_by_ref",
			"acknowledged_at",
			"resolution",
		],
		task_events: [
			"event_id",
			"task_id",
			"node_id",
			"event_type",
			"actor_ref",
			"task_version",
			"node_version",
			"payload_json",
			"created_at",
		],
		idempotency_records: [
			"idempotency_key",
			"operation",
			"request_hash",
			"response_json",
			"created_at",
		],
	};
	const requiredNotNullByTable: Readonly<Record<string, readonly string[]>> = {
		task_groups: [
			"title",
			"status",
			"max_active_tasks",
			"version",
			"created_by_ref",
			"created_at",
			"updated_at",
		],
		tasks: [
			"title",
			"objective",
			"status",
			"version",
			"plan_version",
			"created_by_ref",
			"created_at",
			"updated_at",
		],
		node_execution_history: [
			"task_id",
			"node_id",
			"run_no",
			"final_status",
			"input_documents_json",
			"output_documents_json",
			"ended_at",
		],
		task_documents: [
			"task_id",
			"document_type",
			"file_path",
			"content_hash",
			"updated_by_ref",
			"updated_at",
		],
		task_messages: [
			"task_id",
			"message_type",
			"reason_code",
			"message",
			"status",
			"created_by_ref",
			"created_at",
		],
		task_events: ["task_id", "event_type", "actor_ref", "created_at"],
		idempotency_records: [
			"operation",
			"request_hash",
			"response_json",
			"created_at",
		],
	};
	for (const [table, expectedColumns] of Object.entries(
		expectedColumnsByTable,
	)) {
		if (!tableExists(database, table)) {
			issues.push(`${table}:missing`);
			continue;
		}
		const info = tableInfo(database, table);
		const names = new Set(info.map((item) => item.name));
		if (
			names.size !== expectedColumns.length ||
			expectedColumns.some((name) => !names.has(name))
		)
			issues.push(`${table}:column_shape_mismatch`);
		for (const column of requiredNotNullByTable[table] ?? [])
			if (info.find((item) => item.name === column)?.notnull !== 1)
				issues.push(`${table}.${column}:not_null_required`);
	}
	if (!hasUniqueColumns(database, "tasks", ["task_group_id", "sequence_no"]))
		issues.push("tasks:group_sequence_unique_required");
	if (!hasUniqueColumns(database, "nodes", ["task_id", "sequence_no"]))
		issues.push("nodes:task_sequence_unique_required");
	if (
		!hasUniqueColumns(database, "node_execution_history", ["node_id", "run_no"])
	)
		issues.push("node_execution_history:node_run_unique_required");

	const requiredSqlFragments: Readonly<Record<string, readonly string[]>> = {
		task_groups: [
			"CHECK (STATUS IN ('READY','ACTIVE','SUCCEEDED'))",
			"CHECK (MAX_ACTIVE_TASKS = 1)",
			"CHECK (VERSION >= 1)",
		],
		tasks: [
			"CHECK (STATUS IN ('PENDING','READY','ACTIVE','WAITING','FAILED','PAUSED','SUCCEEDED','TERMINATED'))",
			"CHECK (VERSION >= 1)",
		],
		nodes: [
			"CHECK (STATUS IN ('PENDING','READY','IN_PROGRESS','WAITING','FAILED','SUCCEEDED','TERMINATED'))",
			"CHECK (VERSION >= 1)",
			"CHECK (RUN_NO >= 1)",
		],
		task_role_bindings: ["CHECK (VERSION >= 1)"],
		task_messages: ["CHECK (STATUS IN ('PENDING','ACKNOWLEDGED'))"],
	};
	for (const [table, fragments] of Object.entries(requiredSqlFragments)) {
		const sql = tableSql(database, table);
		for (const fragment of fragments)
			if (!sql.includes(fragment))
				issues.push(`${table}:constraint_missing:${fragment}`);
	}
	const foreignKeyViolations = database
		.prepare("PRAGMA foreign_key_check")
		.all();
	if (foreignKeyViolations.length > 0)
		issues.push(`foreign_key_check:${foreignKeyViolations.length}`);
	return issues;
}

export const taskMigrations: readonly TaskMigration[] = [
	{
		version: 1,
		name: "task_core",
		identity: "task_core.current.20260814",
		sql: `
CREATE TABLE task_groups (
  task_group_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  objective TEXT,
  status TEXT NOT NULL CHECK (status IN ('READY','ACTIVE','SUCCEEDED')),
  max_active_tasks INTEGER NOT NULL DEFAULT 1 CHECK (max_active_tasks = 1),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  task_group_id TEXT,
  sequence_no INTEGER,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','READY','ACTIVE','WAITING','FAILED','PAUSED','SUCCEEDED','TERMINATED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  plan_version INTEGER NOT NULL DEFAULT 1,
  current_node_id TEXT,
  created_by_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_group_id) REFERENCES task_groups(task_group_id),
  UNIQUE(task_group_id, sequence_no)
);
CREATE TABLE nodes (
  node_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  sequence_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','READY','IN_PROGRESS','WAITING','FAILED','SUCCEEDED','TERMINATED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  run_no INTEGER NOT NULL DEFAULT 1 CHECK (run_no >= 1),
  required_agent_package_ref TEXT NOT NULL,
  worker_ref TEXT,
  input_documents_json TEXT NOT NULL DEFAULT '[]',
  output_documents_json TEXT NOT NULL DEFAULT '[]',
  result_summary TEXT,
  error_code TEXT,
  error_message TEXT,
  error_retryable INTEGER,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
  UNIQUE(task_id, sequence_no)
);
CREATE TABLE task_role_bindings (
  task_id TEXT NOT NULL,
  agent_package_ref TEXT NOT NULL,
  role_ref TEXT NOT NULL,
  worker_ref TEXT,
  conversation_locator TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (task_id, agent_package_ref),
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
);
CREATE TABLE node_execution_history (
  execution_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  run_no INTEGER NOT NULL,
  worker_ref TEXT,
  final_status TEXT NOT NULL,
  result_summary TEXT,
  error_code TEXT,
  error_message TEXT,
  error_retryable INTEGER,
  input_documents_json TEXT NOT NULL DEFAULT '[]',
  output_documents_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT,
  ended_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id),
  FOREIGN KEY (node_id) REFERENCES nodes(node_id),
  UNIQUE(node_id, run_no)
);
CREATE INDEX idx_tasks_group_sequence ON tasks(task_group_id, sequence_no);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_nodes_task_sequence ON nodes(task_id, sequence_no);
CREATE INDEX idx_nodes_task_status ON nodes(task_id, status);
`,
	},
	{
		version: 2,
		name: "task_documents_audit_idempotency",
		identity: "task_documents_audit_idempotency.current.20260814",
		sql: `
CREATE TABLE task_documents (
  task_id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  source_node_id TEXT,
  file_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  updated_by_ref TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (task_id, document_type),
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
);
CREATE TABLE task_messages (
  message_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  node_id TEXT,
  message_type TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  message TEXT NOT NULL,
  related_ref TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACKNOWLEDGED')),
  created_by_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  acknowledged_by_ref TEXT,
  acknowledged_at TEXT,
  resolution TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
);
CREATE TABLE task_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  node_id TEXT,
  event_type TEXT NOT NULL,
  actor_ref TEXT NOT NULL,
  task_version INTEGER,
  node_version INTEGER,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
);
CREATE TABLE idempotency_records (
  idempotency_key TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_messages_pending ON task_messages(status, created_at);
CREATE INDEX idx_events_task ON task_events(task_id, event_id);
`,
	},
	{
		version: 3,
		name: "task_schema_compatibility_v3",
		identity: "task_schema_compatibility_v3.20260815",
		coversLegacyVersions: [1, 2],
		sql: "",
		apply: applyTaskSchemaCompatibilityV3,
		verify: verifyTaskSchemaCompatibilityV3,
	},
] as const;
