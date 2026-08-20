import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { descriptor } from "../deployment/descriptor.ts";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

test("EXT-TUNNEL-01 dev-tunnel owns ingress lifecycle only, never Gateway routing/auth or Task/Agent facts", () => {
	for (const text of [
		"Agent Gateway",
		"Gateway routing",
		"Gateway auth",
		"Task/Agent facts",
	])
		assert.match(readme, new RegExp(text.replace("/", "\\/"), "i"));
	assert.doesNotMatch(
		JSON.stringify(descriptor),
		/gatewayRoute|gatewayAuth|taskId|workerRef|roleRef/,
	);
});

test("EXT-TUNNEL-02 managed tunnel remains process-owning while standard lifecycle metadata is removed", () => {
	assert.equal("lifecycle" in descriptor, false);
	assert.equal(
		descriptor.effects.some((effect) => effect.kind === "process"),
		true,
	);
	assert.equal(descriptor.provides[0]?.contractRef, "public-ingress");
});

test("EXT-TUNNEL-03 ingress diagnostics remain Module-owned instead of descriptor verification metadata", () => {
	assert.equal("verification" in descriptor, false);
	assert.equal(
		descriptor.effects.some((effect) => effect.kind === "network"),
		true,
	);
});
