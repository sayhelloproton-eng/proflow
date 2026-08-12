export interface TaskMigration {
	version: number;
	name: string;
	sql: string;
}

export const taskMigrations: readonly TaskMigration[] = [
	{
		version: 1,
		name: "task_core",
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
  authorized_by_ref TEXT,
  authorized_at TEXT,
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
  required_role_ref TEXT NOT NULL,
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
  role_ref TEXT NOT NULL,
  worker_ref TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (task_id, role_ref),
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
] as const;
