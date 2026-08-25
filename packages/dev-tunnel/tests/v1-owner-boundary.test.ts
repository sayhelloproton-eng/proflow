import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { descriptor } from "../deployment/descriptor.ts";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const setup = await readFile(new URL("../SETUP.md", import.meta.url), "utf8");
const cli = await readFile(new URL("../src/cli.ts", import.meta.url), "utf8");

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

test("CP-DEV-TUNNEL-08 setup exposes zero user-supplied Tunnel configuration and preserves contract", () => {
	assert.doesNotMatch(
		setup,
		/Required inputs:\s*(Tunnel ID|publicBaseUrl|local port)/i,
	);
	assert.doesNotMatch(cli, /createInterface|prompt\.question/);
	assert.match(cli, /--tunnel-id/);
	assert.match(cli, /已移除/);
	assert.equal(descriptor.configSlots.length, 0);
});
