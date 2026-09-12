import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { diagnoseOperationChain } from "./operation-chain-diagnose.mjs";

test("operation-chain diagnosis joins owner truth with task-agnostic browser evidence and finds the first divergence", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-operation-diagnose-"));
	const stateRoot = join(root, ".proflow");
	await mkdir(join(stateRoot, "state"), { recursive: true });
	await mkdir(join(stateRoot, "logs", "execution-runtime"), { recursive: true });
	await mkdir(join(stateRoot, "logs", "browser-extension"), { recursive: true });
	const database = new DatabaseSync(join(stateRoot, "state", "task.sqlite"));
	database.exec(`CREATE TABLE task_events (
		event_id INTEGER PRIMARY KEY AUTOINCREMENT,
		task_id TEXT NOT NULL,
		node_id TEXT,
		event_type TEXT NOT NULL,
		actor_ref TEXT NOT NULL,
		task_version INTEGER,
		node_version INTEGER,
		payload_json TEXT,
		created_at TEXT NOT NULL
	)`);
	database.prepare("INSERT INTO task_events(task_id,node_id,event_type,actor_ref,payload_json,created_at) VALUES(?,?,?,?,?,?)")
		.run("task:1", "dev", "NODE_STARTED", "worker:1", JSON.stringify({ runNo: 1, roleRef: "g-dev", workerRef: "worker:1" }), "2026-09-12T08:00:00.000Z");
	database.close();
	await writeFile(
		join(stateRoot, "logs", "execution-runtime", "events.jsonl"),
		`${JSON.stringify({ timestamp: "2026-09-12T08:00:01.000Z", component: "execution-runtime", taskId: "task:1", nodeId: "dev", runNo: 1, event: "INTENT_PERSISTED", status: "SUCCEEDED", executionRef: "execution:1", correlationId: "task-reconciliation:task:1:dev:1" })}\n`,
	);
	await writeFile(
		join(stateRoot, "logs", "browser-extension", "events.jsonl"),
		`${JSON.stringify({ timestamp: "2026-09-12T08:00:02.000Z", level: "WARN", component: "permission-controller", operation: "PERMISSION_CLASSIFIED", status: "HUMAN_REQUIRED", errorCode: "ROLE_VALIDATION_MISMATCH", roleRef: "g-dev", workerRef: "worker:1", operationRef: "permission:1" })}\n`,
	);
	const result = diagnoseOperationChain({
		workspaceRoot: root,
		taskId: "task:1",
		sinceMinutes: 10,
		nowMs: Date.parse("2026-09-12T08:05:00.000Z"),
	});
	assert.equal(result.firstDivergence?.source, "browser-extension");
	assert.equal(result.firstDivergence?.event, "PERMISSION_CLASSIFIED");
	assert.equal(result.firstDivergence?.errorCode, "ROLE_VALIDATION_MISMATCH");
	assert.equal(result.firstDivergence?.correlationKind, "IDENTITY_MATCH");
	assert.equal(result.previousSuccess?.event, "INTENT_PERSISTED");
});
