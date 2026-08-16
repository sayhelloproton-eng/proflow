import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createLocalExecutorPort } from "../src/executors/local-adapter.ts";
import {
	createExecutionRuntime,
	type ExecutionExecutorPort,
} from "../src/index.ts";

const executor: ExecutionExecutorPort = {
	execute: async () => {
		throw new Error("not used");
	},
	reconcile: async () => ({ state: "NOT_APPLIED", evidence: [] }),
	readArtifact: async () => ({ chunk: "", nextOffset: 0, eof: true, bytes: 0 }),
};

test("R2-P1-15-ART-01 getArtifactSummary reflects real Execution artifact registry state", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-artifact-summary-"));
	const databasePath = join(root, "execution.sqlite");
	const runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: executor,
	});
	assert.deepEqual(runtime.getArtifactSummary(), {
		totalArtifacts: 0,
		byKind: {},
		latestCreatedAt: null,
		pendingObserverSignals: 0,
	});
	runtime.registerArtifact({
		path: join(root, "a.txt"),
		record: {
			contract: "execution.artifact",
			contractVersion: "1.0.0",
			artifactRef: "artifact:test:summary",
			kind: "external-file",
			ownerCallerRef: "role:controller",
			taskId: "task:1",
			nodeId: "node:1",
			hash: "sha256:test",
			mime: "text/plain",
			bytes: 1,
			metadata: {},
			createdAt: "2026-08-16T00:00:00.000Z",
		},
	});
	const summary = runtime.getArtifactSummary();
	assert.equal(summary.totalArtifacts, 1);
	assert.equal(summary.byKind["external-file"], 1);
	assert.equal(summary.latestCreatedAt, "2026-08-16T00:00:00.000Z");
	runtime.close();
});

test("CP-EXE-RT-12 immutable Artifact registry is Execution-owned durable truth with caller/task scope metadata", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-artifact-registry-"));
	const databasePath = join(root, "execution.sqlite");
	let runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: executor,
	});
	const record = runtime.registerArtifact({
		path: join(root, "artifact.bin"),
		record: {
			contract: "execution.artifact",
			contractVersion: "1.0.0",
			artifactRef: "artifact:test:external-file",
			kind: "external-file",
			ownerCallerRef: "role:controller",
			taskId: "task:1",
			nodeId: "node:1",
			hash: "sha256:test",
			mime: "text/plain",
			bytes: 7,
			metadata: { provenanceRef: "file:source" },
			createdAt: "2026-08-16T00:00:00.000Z",
		},
	});
	assert.equal(record.kind, "external-file");
	assert.throws(
		() =>
			runtime.registerArtifact({
				path: join(root, "artifact-replaced.bin"),
				record: { ...record, hash: "sha256:replaced" },
			}),
		/artifactRef is immutable/,
	);
	runtime.close();
	runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: executor,
	});
	assert.throws(
		() =>
			runtime.getArtifactRecord({
				artifactRef: "artifact:test:external-file",
				callerRef: "role:other",
				taskId: "task:1",
				nodeId: "node:1",
			}),
		/caller does not own the Artifact/,
	);
	assert.throws(
		() =>
			runtime.getArtifactRecord({
				artifactRef: "artifact:test:external-file",
				callerRef: "role:controller",
				taskId: "task:other",
				nodeId: "node:1",
			}),
		/Artifact task scope does not match/,
	);
	const reopened = runtime.getArtifactRecord({
		artifactRef: "artifact:test:external-file",
		callerRef: "role:controller",
		taskId: "task:1",
		nodeId: "node:1",
	});
	assert.equal(reopened.ownerCallerRef, "role:controller");
	assert.equal(reopened.taskId, "task:1");
	assert.equal(reopened.nodeId, "node:1");
	assert.equal(reopened.hash, "sha256:test");
	runtime.close();
});

test("CP-EXE-RT-13 Context Pack and Patch Proposal share the Execution artifact registry rather than separate stores", async () => {
	const source = await import("node:fs/promises").then(({ readFile }) =>
		readFile(new URL("../src/index.ts", import.meta.url), "utf8"),
	);
	assert.match(source, /artifact_registry/);
	assert.doesNotMatch(
		source,
		/CREATE TABLE IF NOT EXISTS (?:context_packs|patches)/i,
	);
});

test("PRESMOKE-B4-ART-07 patch.apply resolves only caller-owned durable proposal and records one Execution effect", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-runtime-patch-"));
	await writeFile(join(root, "package.json"), '{"name":"fixture"}\n', "utf8");
	await writeFile(join(root, "a.txt"), "old\n", "utf8");
	for (const args of [
		["init"],
		["config", "user.email", "test@example.com"],
		["config", "user.name", "Test"],
		["add", "."],
		["commit", "-m", "init"],
	]) {
		const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
	}
	const artifactRoot = join(root, ".artifacts");
	await mkdir(artifactRoot, { recursive: true });
	const patchPath = join(artifactRoot, "proposal.diff");
	const diff = "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n";
	await writeFile(patchPath, diff, "utf8");
	const patchHash = `sha256:${createHash("sha256").update(diff).digest("hex")}`;
	const local = await createLocalExecutorPort({
		projectRoot: root,
		artifactRoot,
	});
	const runtime = await createExecutionRuntime({
		databasePath: join(root, ".proflow", "execution.db"),
		localExecutor: local,
		modelDecision: {
			decide: async () => ({
				decision: "ALLOW",
				decisionPath: "fast",
				approvalRequired: false,
			}),
		},
	});
	runtime.registerArtifact({
		path: patchPath,
		record: {
			contract: "execution.artifact",
			contractVersion: "1.0.0",
			artifactRef: "artifact:patch:1",
			kind: "patch-proposal",
			ownerCallerRef: "role:controller",
			taskId: "task:1",
			nodeId: "node:1",
			hash: patchHash,
			mime: "text/x-diff",
			bytes: Buffer.byteLength(diff),
			metadata: { baseHash: "sha256:base", baseRef: "snapshot:1" },
			createdAt: new Date().toISOString(),
		},
	});
	await assert.rejects(
		runtime.executeCapability({
			contract: "execution",
			contractVersion: "1.0.0",
			callerRef: "role:other",
			capability: "patch.apply",
			input: { artifactRef: "artifact:patch:1" },
			taskId: "task:1",
			nodeId: "node:1",
			projectRoot: root,
			idempotencyKey: "patch:other",
		}),
		(error: unknown) =>
			error instanceof Error && error.message.includes("does not own"),
	);
	const request = {
		contract: "execution",
		contractVersion: "1.0.0",
		callerRef: "role:controller",
		capability: "patch.apply",
		input: { artifactRef: "artifact:patch:1" },
		taskId: "task:1",
		nodeId: "node:1",
		projectRoot: root,
		idempotencyKey: "patch:apply:1",
	} as const;
	const first = await runtime.executeCapability(request);
	const second = await runtime.executeCapability(request);
	assert.equal(first.executionRef, second.executionRef);
	assert.equal(first.status, "SUCCEEDED");
	assert.equal(first.sideEffectState, "APPLIED");
	assert.equal(await readFile(join(root, "a.txt"), "utf8"), "new\n");
	runtime.close();
});

test("PRESMOKE-B4-ART-10 patch apply success and verification failure remain separate durable facts", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-patch-verify-fail-"));
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({ name: "fixture", scripts: { test: "node verify.cjs" } }),
		"utf8",
	);
	await writeFile(join(root, "verify.cjs"), "process.exit(9);\n", "utf8");
	await writeFile(join(root, "a.txt"), "old\n", "utf8");
	for (const args of [
		["init"],
		["config", "user.email", "test@example.com"],
		["config", "user.name", "Test"],
		["add", "."],
		["commit", "-m", "init"],
	]) {
		const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
	}
	const artifactRoot = join(root, ".artifacts");
	await mkdir(artifactRoot, { recursive: true });
	const diff = "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n";
	const patchPath = join(artifactRoot, "proposal.diff");
	await writeFile(patchPath, diff, "utf8");
	const patchHash = `sha256:${createHash("sha256").update(diff).digest("hex")}`;
	const local = await createLocalExecutorPort({
		projectRoot: root,
		artifactRoot,
	});
	const runtime = await createExecutionRuntime({
		databasePath: join(root, ".proflow", "execution.db"),
		localExecutor: local,
		modelDecision: {
			decide: async () => ({
				decision: "ALLOW",
				decisionPath: "fast",
				approvalRequired: false,
			}),
		},
	});
	runtime.registerArtifact({
		path: patchPath,
		record: {
			contract: "execution.artifact",
			contractVersion: "1.0.0",
			artifactRef: "artifact:patch:verify",
			kind: "patch-proposal",
			ownerCallerRef: "role:controller",
			taskId: "task:1",
			nodeId: "node:1",
			hash: patchHash,
			mime: "text/x-diff",
			bytes: Buffer.byteLength(diff),
			metadata: { baseHash: "sha256:base", baseRef: "snapshot:1" },
			createdAt: new Date().toISOString(),
		},
	});
	const applied = await runtime.executeCapability({
		contract: "execution",
		contractVersion: "1.0.0",
		callerRef: "role:controller",
		capability: "patch.apply",
		input: { artifactRef: "artifact:patch:verify" },
		taskId: "task:1",
		nodeId: "node:1",
		projectRoot: root,
		idempotencyKey: "patch:verify:apply",
	});
	assert.equal(applied.status, "SUCCEEDED");
	assert.equal(applied.sideEffectState, "APPLIED");
	const verification = await runtime.executeCapability({
		contract: "execution",
		contractVersion: "1.0.0",
		callerRef: "role:controller",
		capability: "quality.test",
		input: {},
		taskId: "task:1",
		nodeId: "node:1",
		projectRoot: root,
		idempotencyKey: "patch:verify:test",
		correlationId: applied.executionRef,
	});
	assert.equal(verification.status, "FAILED");
	assert.equal(verification.sideEffectState, "NOT_APPLIED");
	assert.equal(verification.error?.code, "EXECUTION_FAILED");
	assert.match(verification.error?.message ?? "", /code 9/);
	assert.equal(applied.status, "SUCCEEDED");
	assert.equal(await readFile(join(root, "a.txt"), "utf8"), "new\n");
	runtime.close();
});

test("CP-EXE-RT-17/RF-EXE-RT-17 Artifact registry and Execution relation commit atomically without replace semantics", async () => {
	const source = await readFile(
		new URL("../src/index.ts", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(source, /INSERT OR REPLACE INTO execution_artifacts/);
	const start = source.indexOf('database.exec("BEGIN IMMEDIATE")');
	const end = source.indexOf('database.exec("COMMIT")', start);
	assert.ok(start >= 0 && end > start);
	const transaction = source.slice(start, end);
	assert.ok(
		transaction.indexOf("registerArtifact") <
			transaction.indexOf("INSERT INTO execution_artifacts"),
	);
	assert.match(transaction, /Execution Artifact relation is immutable/);
});
