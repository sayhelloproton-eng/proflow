import assert from "node:assert/strict";
import { test } from "node:test";

import { systemPackageCommandRunner } from "../src/install/package-manager.ts";

test("package command runner streams complete stdout and stderr lines before completion", async () => {
	const observed: string[] = [];
	let completed = false;
	const run = systemPackageCommandRunner().run(
		process.execPath,
		[
			"-e",
			"process.stdout.write('resolved '); setTimeout(() => { process.stdout.write('24\\n'); process.stderr.write('warning: fixture\\n'); }, 10)",
		],
		process.cwd(),
		(event) => {
			assert.equal(completed, false);
			observed.push(`${event.stream}:${event.line}`);
		},
	);
	await run;
	completed = true;
	assert.deepEqual(observed, ["stdout:resolved 24", "stderr:warning: fixture"]);
});
