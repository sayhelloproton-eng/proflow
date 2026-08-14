import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runStaticConformance } from "@tomflow/proflow-deployment-conformance";
import { parseModuleDescriptor } from "@tomflow/proflow-module-contract";

import {
	descriptor,
	FROZEN_FACT_CATEGORIES,
	kind,
	moduleRef,
	moduleVersion,
	packageName,
	STOP_RULE_TOKENS,
} from "../src/index.ts";

const SKILL_SECTIONS = [
	"Source Order",
	"Allowed Facts",
	"Forbidden",
	"Stop Rules",
	"Create/Modify Flow",
	"Deployment Use",
] as const;

async function readSkill(): Promise<string> {
	return readFile(new URL("../SKILL.md", import.meta.url), "utf8");
}

async function readPackageJson(): Promise<Record<string, unknown>> {
	return JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), "utf8"),
	) as Record<string, unknown>;
}

test("CP-DPL-SKILL-01 descriptor round-trips the frozen contract and invents no capability/contract/dependency", () => {
	assert.equal(moduleRef, "module-skill");
	assert.equal(packageName, "@tomflow/proflow-module-skill");
	assert.equal(moduleVersion, "0.1.0");
	assert.equal(kind, "library");
	assert.deepEqual(parseModuleDescriptor(descriptor), descriptor);
	assert.deepEqual(descriptor.provides, []);
	assert.deepEqual(descriptor.requires, []);
	assert.deepEqual(descriptor.effects, []);
	assert.deepEqual(descriptor.configSlots, []);
});

test("CP-DPL-SKILL-01 SKILL.md references only the frozen fact vocabulary", async () => {
	const skill = await readSkill();
	for (const section of SKILL_SECTIONS) {
		assert.ok(
			skill.includes(section),
			`SKILL.md must declare section: ${section}`,
		);
	}
	for (const category of FROZEN_FACT_CATEGORIES) {
		assert.ok(
			skill.includes(category),
			`SKILL.md must reference frozen fact category: ${category}`,
		);
	}
});

test("CP-DPL-SKILL-02 package and descriptor carry no process lifecycle, persistence, service, or business store", async () => {
	const pkg = await readPackageJson();
	assert.equal("bin" in pkg, false);
	assert.equal(kind, "library");
	assert.deepEqual(descriptor.lifecycle.supported, ["verify"]);
	assert.deepEqual(descriptor.effects, []);
	assert.equal(descriptor.requirements.length, 1);
	assert.equal(descriptor.requirements[0]?.kind, "runtime");
});

test("CP-DPL-SKILL-03 SKILL.md declares the required STOP / NOT_FROZEN stop rules", async () => {
	const skill = await readSkill();
	assert.ok(skill.includes("Stop Rules"));
	for (const token of STOP_RULE_TOKENS) {
		assert.ok(
			skill.includes(token),
			`SKILL.md must declare stop rule token: ${token}`,
		);
	}
});

test("RF-DPL-SKILL-01 the skill invents no capability, dependency, or permission", async () => {
	const skill = await readSkill();
	assert.ok(skill.includes("Forbidden"));
	assert.deepEqual(descriptor.provides, []);
	assert.deepEqual(descriptor.requires, []);
	assert.deepEqual(descriptor.effects, []);
});

test("RF-DPL-SKILL-02 real static conformance rejects a skill promoted to a process runtime", () => {
	const withProcessEffect = runStaticConformance({
		...descriptor,
		effects: [{ kind: "process", description: "fake daemon" }],
	});
	assert.equal(withProcessEffect.status, "FAIL");
	assert.ok(
		withProcessEffect.issues.some(
			(issue) => issue.code === "LIBRARY_PROCESS_EFFECT_INVALID",
		),
	);

	const withStartLifecycle = runStaticConformance({
		...descriptor,
		lifecycle: { supported: ["verify", "start"] },
	});
	assert.equal(withStartLifecycle.status, "FAIL");
});

test("RF-DPL-SKILL-03 SKILL.md stop rules cover missing dependency/permission/conformance before guessing", async () => {
	const skill = await readSkill();
	assert.ok(skill.includes("Stop Rules"));
	for (const token of STOP_RULE_TOKENS) {
		assert.ok(skill.includes(token));
	}
	assert.ok(skill.includes("dependency"));
	assert.ok(skill.includes("permission"));
	assert.ok(skill.includes("conformance"));
});
