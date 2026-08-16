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

test("EXT-TUNNEL-02 only the real managed tunnel resource declares start/stop/restart", () => {
	for (const primitive of ["start", "stop", "restart"])
		assert.equal(
			descriptor.lifecycle.supported.includes(primitive as never),
			true,
		);
	assert.equal(
		descriptor.effects.some((effect) => effect.kind === "process"),
		true,
	);
});

test("EXT-TUNNEL-03 tunnel verification remains bounded to ingress/file-relay diagnostics", () => {
	const checks = descriptor.verification.checks.map((check) => check.id).sort();
	assert.deepEqual(checks, [
		"tunnel-diagnostics",
		"tunnel-file-relay",
		"tunnel-public-ingress",
		"tunnel-status",
	]);
});
