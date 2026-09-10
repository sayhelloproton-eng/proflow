import assert from "node:assert/strict";
import { test } from "node:test";
import { compareRoleCarrierMaterial, roleCarrierMaterialFingerprint, type RoleCarrierMaterial } from "../src/role-carrier-material.ts";

const expected: RoleCarrierMaterial = {
	packageName: "@tomflow/proflow-agent-controller-dev", version: "0.1.18",
	displayName: "Dev", description: "Developer", instructions: "Use repomix, codeGraph and localDev.",
	actionSchema: 'openapi: 3.1.0\ninfo: {title: Dev, version: 2.0.0}\npaths: {}\n',
	conversationStarters: ["Inspect task"], recommendedModel: "gpt-5-6",
	capabilities: { webSearch: true, imageGeneration: true, codeInterpreter: true },
	requirements: { actions: "required", apps: "disabled" },
	knowledgeBundleSha256: `sha256:${"a".repeat(64)}`,
};
const observedAt = "2026-09-11T00:00:00.000Z";
const target = { roleRef: "g-dev", carrierUrl: "https://chatgpt.com/g/g-dev" };
const published = {
	displayName: expected.displayName,
	description: expected.description,
	instructions: expected.instructions,
	actionSchema: expected.actionSchema,
	conversationStarters: expected.conversationStarters,
	recommendedModel: expected.recommendedModel,
	capabilities: expected.capabilities,
};
const observation = { contract: "proflow.role-carrier-material-observation.v1", source: "LIVE_CARRIER", ...target, observedAt, material: published };
const compare = (raw: unknown) => compareRoleCarrierMaterial({ expected, ...target, observation: raw, now: Date.parse(observedAt) });

test("material canonicalization ignores YAML object order and line endings but preserves instruction meaning", () => {
	assert.equal(roleCarrierMaterialFingerprint(expected), roleCarrierMaterialFingerprint({ ...expected, instructions: `\r\n${expected.instructions}\r\n`, actionSchema: '{"paths":{},"info":{"version":"2.0.0","title":"Dev"},"openapi":"3.1.0"}' }));
	assert.notEqual(roleCarrierMaterialFingerprint(expected), roleCarrierMaterialFingerprint({ ...expected, instructions: "Use executeCapability." }));
});

test("changed published schema/instructions/model/starters/capabilities is material drift", () => {
	for (const change of [
		{ instructions: "Use typed Execution." },
		{ actionSchema: expected.actionSchema.replace("2.0.0", "1.0.0") },
		{ recommendedModel: "other" },
		{ conversationStarters: ["Old starter"] },
		{ capabilities: { ...expected.capabilities, webSearch: false } },
	]) assert.deepEqual(compare({ ...observation, material: { ...published, ...change } }), { status: "FAIL", issue: "ROLE_CARRIER_MATERIAL_DRIFT" });
	assert.equal(compare(observation).status, "MATCH");
	assert.equal(
		roleCarrierMaterialFingerprint(expected),
		roleCarrierMaterialFingerprint({ ...expected, requirements: { actions: "optional" }, knowledgeBundleSha256: `sha256:${"b".repeat(64)}` }),
	);
});

test("unobserved, draft, malformed and expired remote facts cannot prove carrier readiness", () => {
	for (const raw of [undefined, {}, { ...observation, source: "DRAFT" }, { ...observation, observedAt: "2026-09-10T00:00:00.000Z" }, { ...observation, material: { ...published, actionSchema: "not: [valid" } }]) assert.deepEqual(compare(raw), { status: "FAIL", issue: "ROLE_CARRIER_MATERIAL_UNVERIFIED" });
});

test("package version and role identity remain mandatory alongside fingerprint", () => {
	assert.deepEqual(compare({ ...observation, roleRef: "g-other" }), { status: "FAIL", issue: "ROLE_CARRIER_MATERIAL_DRIFT" });
	assert.equal(roleCarrierMaterialFingerprint(expected).startsWith("sha256:"), true);
});
