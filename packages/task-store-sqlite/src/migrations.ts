import type { DatabaseSync } from "node:sqlite";

export interface TaskMigrationContext {
	legacyRoleMap?: Readonly<Record<string, string>>;
}

export interface TaskMigration {
	version: number;
	name: string;
	sql: string;
	identity?: string;
	coversLegacyVersions?: readonly number[];
	apply?: (database: DatabaseSync, context: TaskMigrationContext) => void;
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
	throw new Error(`LEGACY_TASK_ROLE_MAPPING_REQUIRED:${legacyRoleRef}`);
}

function applyTaskSchemaCompatibilityV3(
	database: DatabaseSync,
	context: TaskMigrationContext,
): void {
	const nodeColumns = tableColumns(database, "nodes");
	const hadCanonicalNodePackage = nodeColumns.has("required_agent_package_ref");
	if (!hadCanonicalNodePackage) {
		if (!nodeColumns.has("required_role_ref"))
			throw new Error("LEGACY_TASK_SCHEMA_UNSUPPORTED:nodes");
		database.exec(
			"ALTER TABLE nodes ADD COLUMN required_agent_package_ref TEXT",
		);
	}
	const nodeRows = database
		.prepare(
			hadCanonicalNodePackage
				? "SELECT node_id, required_agent_package_ref AS legacy_ref FROM nodes"
				: "SELECT node_id, required_role_ref AS legacy_ref FROM nodes",
		)
		.all() as Array<{ node_id: string; legacy_ref: string | null }>;
	const updateNode = database.prepare(
		"UPDATE nodes SET required_agent_package_ref=? WHERE node_id=?",
	);
	for (const row of nodeRows) {
		if (!row.legacy_ref)
			throw new Error("LEGACY_TASK_SCHEMA_UPGRADE_INCOMPLETE:nodes");
		const packageRef = resolveLegacyAgentPackageRef(row.legacy_ref, context);
		if (!hadCanonicalNodePackage || row.legacy_ref !== packageRef)
			updateNode.run(packageRef, row.node_id);
	}

	const bindingColumns = tableColumns(database, "task_role_bindings");
	const legacyBindingKey = !bindingColumns.has("agent_package_ref");
	if (legacyBindingKey) {
		if (!bindingColumns.has("role_ref"))
			throw new Error("LEGACY_TASK_SCHEMA_UNSUPPORTED:task_role_bindings");
		database.exec(
			"ALTER TABLE task_role_bindings ADD COLUMN agent_package_ref TEXT",
		);
	}
	if (!bindingColumns.has("conversation_locator"))
		database.exec(
			"ALTER TABLE task_role_bindings ADD COLUMN conversation_locator TEXT",
		);

	const bindings = database
		.prepare(
			"SELECT task_id, role_ref, agent_package_ref FROM task_role_bindings",
		)
		.all() as Array<{
		task_id: string;
		role_ref: string;
		agent_package_ref: string | null;
	}>;
	const updateBinding = database.prepare(
		"UPDATE task_role_bindings SET agent_package_ref=? WHERE task_id=? AND role_ref=?",
	);
	for (const binding of bindings) {
		const legacyRef = binding.agent_package_ref ?? binding.role_ref;
		let packageRef: string;
		try {
			packageRef = resolveLegacyAgentPackageRef(legacyRef, context);
		} catch {
			// Some historical rows already had an agent_package_ref column but still
			// carried the old logical role value. Allow an explicit role_ref mapping
			// before refusing the upgrade; never guess either value.
			packageRef = resolveLegacyAgentPackageRef(binding.role_ref, context);
		}
		if (binding.agent_package_ref !== packageRef)
			updateBinding.run(packageRef, binding.task_id, binding.role_ref);
	}

	if (legacyBindingKey)
		database.exec(
			"CREATE UNIQUE INDEX IF NOT EXISTS uq_task_role_bindings_task_agent_package ON task_role_bindings(task_id, agent_package_ref)",
		);
	const missingNodePackage = database
		.prepare(
			"SELECT COUNT(*) AS count FROM nodes WHERE required_agent_package_ref IS NULL OR required_agent_package_ref=''",
		)
		.get() as { count: number };
	const missingBindingPackage = database
		.prepare(
			"SELECT COUNT(*) AS count FROM task_role_bindings WHERE agent_package_ref IS NULL OR agent_package_ref=''",
		)
		.get() as { count: number };
	if (
		Number(missingNodePackage.count) !== 0 ||
		Number(missingBindingPackage.count) !== 0
	)
		throw new Error("LEGACY_TASK_SCHEMA_UPGRADE_INCOMPLETE");
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
	},
] as const;
