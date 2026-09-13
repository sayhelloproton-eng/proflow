import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { applyMigrations } from "@tomflow/proflow-task-migration-runner";
import {
	SqliteTaskStore,
	taskMigrations,
} from "@tomflow/proflow-task-store-sqlite";
import { createTaskServices } from "../src/index.ts";

const PACKAGES = {
	product: "@tomflow/proflow-agent-product",
	dev: "@tomflow/proflow-agent-controller-dev",
	test: "@tomflow/proflow-agent-test-ops",
} as const;

const ROLES = {
	product: "g-product",
	dev: "g-dev",
	test: "g-test",
} as const;

test("RF-TASK-ORCH-06 settled document recovery removes the empty Task recovery root", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-persistence-recovery-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const databasePath = join(root, ".proflow", "state", "task.sqlite");
	assert.equal(
		applyMigrations({ databasePath, migrations: taskMigrations }).ok,
		true,
	);
	const store = new SqliteTaskStore({ databasePath, busyTimeoutMs: 2_500 });
	context.after(() => store.close());
	const services = createTaskServices({ store, workspaceRoot: root });
	const taskId = "task-recovery-cleanup";
	const created = services.commands.createTask({
		taskId,
		title: "Recovery cleanup",
		objective: "Prove settled recovery leaves no Task-level residue",
		plan: {
			nodes: [
				{
					nodeId: `${taskId}-dev`,
					title: "Development",
					objective: "Write design",
					requiredAgentPackageRef: PACKAGES.dev,
					inputDocuments: ["REQUIREMENT"],
					outputDocuments: ["TECHNICAL_DESIGN"],
				},
			],
		},
		initialDocuments: [
			{ documentType: "REQUIREMENT", content: "# Requirement\n" },
		],
		roleBindings: [
			{
				agentPackageRef: PACKAGES.product,
				roleRef: ROLES.product,
				workerRef: null,
				conversationLocator: null,
			},
			{
				agentPackageRef: PACKAGES.dev,
				roleRef: ROLES.dev,
				workerRef: null,
				conversationLocator: null,
			},
			{
				agentPackageRef: PACKAGES.test,
				roleRef: ROLES.test,
				workerRef: null,
				conversationLocator: null,
			},
		],
		actorRef: "extension:new-task",
		idempotencyKey: "persistence-recovery:create",
	});
	assert.equal(created.ok, true);
	if (!created.ok) throw new Error(JSON.stringify(created));

	const written = services.documents.putTaskDocument({
		taskId,
		nodeId: null,
		documentType: "PRD",
		content: "# PRD\n",
		expectedTaskVersion: created.data.version,
		actorRef: "worker:product",
		idempotencyKey: "persistence-recovery:put",
	});
	assert.equal(written.ok, true);

	const taskRecoveryRoot = join(
		root,
		".proflow",
		"recovery",
		"task-document",
		taskId,
	);
	await assert.rejects(() => stat(taskRecoveryRoot));
});
