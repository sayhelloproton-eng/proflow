import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { descriptor } from "../deployment/descriptor.ts";

const repoUrl = new URL("../../../", import.meta.url);
const externalRegistryUrl = new URL(
	"spec/EXTERNAL-RESOURCE-REGISTRY.json",
	repoUrl,
);

test("SPEC-ALIGN chrome-runtime remains an honest Deployment-owned external-resource adapter", async () => {
	const registry = JSON.parse(
		await readFile(externalRegistryUrl, "utf8"),
	) as Array<{
		moduleRef?: string;
		kind?: string;
		owner?: string;
		consumers?: string[];
	}>;
	const matches = registry.filter(
		(entry) => entry.moduleRef === "chrome-runtime",
	);
	assert.equal(
		matches.length,
		1,
		"external adapter must have exactly one current External Resource Registry entry",
	);
	assert.equal(matches[0]?.kind, "external-resource");
	assert.equal(matches[0]?.owner, "deployment-governance");
	assert.equal(descriptor.moduleRef, "chrome-runtime");
	assert.equal(descriptor.kind, "external-resource");
	for (const forbidden of ["Task", "Worker", "Execution", "SystemAssessment"]) {
		assert.equal(Object.hasOwn(descriptor, forbidden), false);
	}
});
