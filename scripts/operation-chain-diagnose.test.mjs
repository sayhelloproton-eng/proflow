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
	await mkdir(join(stateRoot, "logs", "execution-runtime"), {
		recursive: true,
	});
	await mkdir(join(stateRoot, "logs", "browser-extension"), {
		recursive: true,
	});
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
	database
		.prepare(
			"INSERT INTO task_events(task_id,node_id,event_type,actor_ref,payload_json,created_at) VALUES(?,?,?,?,?,?)",
		)
		.run(
			"task:1",
			"dev",
			"NODE_STARTED",
			"worker:1",
			JSON.stringify({ runNo: 1, roleRef: "g-dev", workerRef: "worker:1" }),
			"2026-09-12T08:00:00.000Z",
		);
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
	assert.equal(result.firstDivergence, null);
	const candidate = result.timeline.find(
		(event) => event.source === "browser-extension",
	);
	assert.equal(candidate?.event, "PERMISSION_CLASSIFIED");
	assert.equal(candidate?.errorCode, "ROLE_VALIDATION_MISMATCH");
	assert.equal(candidate?.correlationKind, "IDENTITY_MATCH");
	assert.equal(result.previousSuccess, null);
});

test("operation query excludes unrelated exact IDs and does not discard earlier failure", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-exact-"));
	const dir = join(root, ".proflow/logs/agent-gateway");
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, "events.jsonl"),
		[
			{
				timestamp: "2026-09-12T08:00:01Z",
				operationRef: "other",
				correlationId: "unrelated",
				status: "FAILED",
				event: "UNRELATED",
			},
			{
				timestamp: "2026-09-12T08:00:02Z",
				eventId: "e1",
				operationRef: "op:1",
				correlationKind: "EXACT",
				status: "FAILED",
				event: "OWNER_FAILED",
				sideEffectState: "UNKNOWN",
			},
			{
				timestamp: "2026-09-12T08:00:03Z",
				eventId: "e2",
				operationRef: "op:1",
				correlationKind: "EXACT",
				status: "FAILED",
				event: "GATEWAY_FAILED",
			},
		]
			.map(JSON.stringify)
			.join("\n"),
	);
	const result = diagnoseOperationChain({
		workspaceRoot: root,
		operationRef: "op:1",
		nowMs: Date.parse("2026-09-12T08:05:00Z"),
		sinceMinutes: 10,
	});
	assert.equal(
		result.timeline.some((e) => e.event === "UNRELATED"),
		false,
	);
	assert.equal(result.firstDivergence?.event, "OWNER_FAILED");
	assert.equal(result.firstDivergence?.sideEffectState, "UNKNOWN");
});

test("causal child failure wins over parent symptom despite clock skew; branches remain ambiguous",async()=>{
 const root=await mkdtemp(join(tmpdir(),"proflow-causal-"));const dir=join(root,".proflow/logs/platform-host");await mkdir(dir,{recursive:true});
 const events=[{timestamp:"2026-09-12T08:00:01Z",operationRef:"op:root",status:"FAILED",event:"PARENT_SYMPTOM"},{timestamp:"2026-09-12T08:00:04Z",operationRef:"op:child",parentOperationRef:"op:root",correlationId:"op:root",status:"FAILED",event:"CHILD_FAILED"}];
 const options={workspaceRoot:root,operationRef:"op:root",nowMs:Date.parse("2026-09-12T08:05:00Z")};
 await writeFile(join(dir,"events.jsonl"),events.map(JSON.stringify).join("\n"));assert.equal(diagnoseOperationChain(options).firstDivergence?.event,"CHILD_FAILED");
 events.push({timestamp:"2026-09-12T08:00:02Z",operationRef:"op:branch",parentOperationRef:"op:root",correlationId:"op:root",status:"FAILED",event:"OTHER_FAILED"});await writeFile(join(dir,"events.jsonl"),events.map(JSON.stringify).join("\n"));assert.equal(diagnoseOperationChain(options).firstDivergence,null);
});
