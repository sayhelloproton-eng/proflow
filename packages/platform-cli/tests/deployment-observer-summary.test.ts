import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { writeDeploymentObserverSummary } from "../src/observer/deployment-summary.ts";
import { ensureLayout, workspacePaths } from "../src/paths.ts";

test("P1-15 Deployment owner emits bounded observer summary from current lifecycle results", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-deployment-observer-"));
	try {
		const paths = workspacePaths(root);
		await ensureLayout(paths);
		const summary = await writeDeploymentObserverSummary({
			paths,
			source: "status",
			selectedModuleCount: 3,
			totalModuleCount: 3,
			modules: [
				{ moduleRef: "gateway", status: "SUCCEEDED" },
				{ moduleRef: "execution", status: "ACTION_REQUIRED" },
				{ moduleRef: "model", status: "SUCCEEDED" },
			],
		});
		assert.equal(summary.state, "ACTION_REQUIRED");
		assert.equal(summary.blockingModuleCount, 1);
		const persisted = JSON.parse(
			await readFile(join(paths.deployment, "observer-summary.json"), "utf8"),
		) as Record<string, unknown>;
		assert.equal(persisted.contract, "proflow.deployment-observer-summary.v1");
		assert.equal(persisted.scope, "PLATFORM");
		assert.equal(persisted.source, "status");
		assert.equal(persisted.state, "ACTION_REQUIRED");
		assert.equal(persisted.selectedModuleCount, 3);
		assert.equal(persisted.totalModuleCount, 3);
		assert.ok(Date.parse(String(persisted.freshUntil)) > Date.now());
		assert.equal(persisted.observedModuleCount, 3);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("P1-15 Deployment owner never reports READY from an empty observation", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "proflow-deployment-observer-empty-"),
	);
	try {
		const paths = workspacePaths(root);
		await ensureLayout(paths);
		const summary = await writeDeploymentObserverSummary({
			paths,
			source: "doctor",
			selectedModuleCount: 0,
			totalModuleCount: 0,
			modules: [],
		});
		assert.equal(summary.state, "NOT_READY");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("P1-15 Deployment owner never reports READY from a partial platform observation", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "proflow-deployment-observer-partial-"),
	);
	try {
		const paths = workspacePaths(root);
		await ensureLayout(paths);
		const summary = await writeDeploymentObserverSummary({
			paths,
			source: "status",
			selectedModuleCount: 1,
			totalModuleCount: 3,
			modules: [{ moduleRef: "gateway", status: "SUCCEEDED" }],
		});
		assert.equal(summary.scope, "PLATFORM");
		assert.equal(summary.state, "NOT_READY");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
