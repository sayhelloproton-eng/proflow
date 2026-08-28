import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("managed Dev Tunnel tool package is governed without becoming a ProFlow Module", async () => {
	const manifest = JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), "utf8"),
	) as Record<string, unknown>;
	assert.deepEqual(manifest.proflow, { tool: true });
	assert.equal(
		Boolean(
			typeof manifest.proflow === "object" &&
				manifest.proflow !== null &&
				Reflect.get(manifest.proflow, "module") === true,
		),
		false,
	);
});

test("managed Dev Tunnel resolver pins the version verified by Real-3", async () => {
	const source = await readFile(
		new URL("../src/index.ts", import.meta.url),
		"utf8",
	);
	assert.match(source, /MANAGED_VERSION = "1\.0\.2030"/);
	assert.doesNotMatch(source, /COMPATIBLE_VERSION = \/\^1\\\.0\\\.\//);
});
