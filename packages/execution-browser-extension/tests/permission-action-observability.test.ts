import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("permission action dispatch is durably logged before release verification", async () => {
	const background = await readFile(
		new URL("../extension/background.ts", import.meta.url),
		"utf8",
	);
	assert.match(background, /event: "PERMISSION_ACTION"/);
	assert.match(background, /phase: "DISPATCHED"/);
	assert.match(background, /action: command\.permissionAction/);
	assert.match(background, /operationRef: command\.permissionFingerprint/);
	assert.match(background, /sideEffectState: "STARTED"/);
	assert.match(background, /await operationLogger\.emit/);
	assert.match(background, /errorCode: "PERMISSION_ACTION_FAILED"/);
	assert.match(background, /sideEffectState: "UNKNOWN"/);
});
