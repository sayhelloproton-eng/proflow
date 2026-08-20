import assert from "node:assert/strict";
import { test } from "node:test";

import { behaviorAdapter } from "../deployment/adapter.ts";

test("uninstall is idempotent when no Execution Runtime service is bound", async () => {
	const result = await behaviorAdapter.uninstall({
		workspaceRoot: "/tmp/proflow-execution-uninstall-idempotent",
	});
	assert.equal(result.result.status, "SUCCEEDED");
	assert.equal(result.result.ok, true);
	assert.deepEqual(result.observedEffects, []);
});
