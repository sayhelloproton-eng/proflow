import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { descriptor } from "../deployment/descriptor.ts";

const repoUrl = new URL("../../../", import.meta.url);
const externalRegistryUrl = new URL(
	"spec/EXTERNAL-RESOURCE-REGISTRY.json",
	repoUrl,
);
const testPlanIndexUrl = new URL(
	"spec/平台架构与公共约定/06-测试计划/TEST-PLAN-INDEX.json",
	repoUrl,
);

test("SPEC-ALIGN dev-tunnel remains an honest Deployment-owned external-resource adapter", async () => {
	const registry = JSON.parse(
		await readFile(externalRegistryUrl, "utf8"),
	) as Array<{
		moduleRef?: string;
		kind?: string;
		owner?: string;
		consumers?: string[];
	}>;
	const matches = registry.filter((entry) => entry.moduleRef === "dev-tunnel");
	assert.equal(
		matches.length,
		1,
		"external adapter must have exactly one current External Resource Registry entry",
	);
	assert.equal(matches[0]?.kind, "external-resource");
	assert.equal(matches[0]?.owner, "deployment-governance");
	assert.equal(descriptor.moduleRef, "dev-tunnel");
	assert.equal(descriptor.kind, "external-resource");
	for (const forbidden of ["Task", "Worker", "Execution", "SystemAssessment"]) {
		assert.equal(Object.hasOwn(descriptor, forbidden), false);
	}

	const index = JSON.parse(await readFile(testPlanIndexUrl, "utf8")) as {
		documents: Array<{
			moduleRef?: string | null;
			path: string;
			governanceStatus: string;
		}>;
	};
	const plan = index.documents.find(
		(entry) => entry.moduleRef === "dev-tunnel",
	);
	assert.ok(plan);
	assert.equal(plan.governanceStatus, "ACTIVE_BASELINE");
	assert.equal(plan.path, "部署领域/07-测试计划/modules/dev-tunnel.md");
});
