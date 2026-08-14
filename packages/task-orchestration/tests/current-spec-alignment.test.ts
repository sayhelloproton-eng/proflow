import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const repoUrl = new URL("../../../", import.meta.url);
const moduleRegistryUrl = new URL("spec/MODULE-REGISTRY.json", repoUrl);
const testPlanIndexUrl = new URL(
	"spec/平台架构与公共约定/06-测试计划/TEST-PLAN-INDEX.json",
	repoUrl,
);

test("SPEC-ALIGN task-orchestration remains registered and has an ACTIVE current Module Test Plan", async () => {
	const registry = JSON.parse(await readFile(moduleRegistryUrl, "utf8")) as Array<{ moduleRef?: string }>;
	const matches = registry.filter((entry) => entry.moduleRef === "task-orchestration");
	assert.equal(matches.length, 1, "formal package must have exactly one current Module Registry entry");

	const index = JSON.parse(await readFile(testPlanIndexUrl, "utf8")) as {
		documents: Array<{ moduleRef?: string | null; path: string; testPlanStatus: string }>;
	};
	const plan = index.documents.find((entry) => entry.moduleRef === "task-orchestration");
	assert.ok(plan, "formal package must be covered by the current Test Plan Index");
	assert.equal(plan.testPlanStatus, "ACTIVE_BASELINE");
	assert.equal(plan.path, "任务与编排领域/07-测试计划/modules/task-orchestration.md");
	const planText = await readFile(new URL(`spec/${plan.path}`, repoUrl), "utf8");
	assert.match(planText, /Module Test Plan|测试计划/);
});
