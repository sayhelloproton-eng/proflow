import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Task-agnostic Direct Tool Permission does not require or manufacture taskId", async () => {
	const source = await readFile(
		new URL("../extension/runtime/permission-controller.ts", import.meta.url),
		"utf8",
	);
	assert.match(source, /browser\.permission\.classify/);
	assert.match(source, /identity\?\.workerRef/);
	assert.match(
		source,
		/\.\.\.\(facts\.taskId \? \{ taskId: facts\.taskId \} : \{\}\)/,
	);
	assert.doesNotMatch(source, /if \(!identity \|\| !facts\.taskId\)/);
	assert.doesNotMatch(source, /taskId:\s*facts\.taskId\s+as string/);
});

 test("Permission Controller owns trust/action lifecycle instead of Browser background", async () => {
	const [controller, background] = await Promise.all([
		readFile(
			new URL("../extension/runtime/permission-controller.ts", import.meta.url),
			"utf8",
		),
		readFile(new URL("../extension/background.ts", import.meta.url), "utf8"),
	]);
	for (const required of [
		"resolveRoutineCarrierPermission",
		"resolveHumanCarrierPermission",
		"createCarrierPermissionAttemptRegistry",
		"createCarrierAttentionRegistry",
		"createCarrierContinuationControl",
	])
		assert.match(controller, new RegExp(required));
	for (const leaked of [
		/resolveRoutineCarrierPermission/,
		/resolveHumanCarrierPermission/,
		/createCarrierPermissionAttemptRegistry/,
		/createCarrierAttentionRegistry/,
		/createCarrierContinuationControl/,
	])
		assert.doesNotMatch(background, leaked);
});
