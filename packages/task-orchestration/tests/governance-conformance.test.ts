import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { runGeneratedPackageConformance } from "@tomflow/proflow-deployment-conformance";

const packagesRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("Task Wave 1 modules each pass Foundation C1/C2/C3", async () => {
	for (const moduleName of [
		"task-orchestration",
		"task-store-sqlite",
		"task-migration-runner",
	]) {
		const results = await runGeneratedPackageConformance(
			join(packagesRoot, moduleName),
		);
		assert.deepEqual(
			results.map((item) => item.status),
			["PASS", "PASS", "PASS"],
			JSON.stringify({ moduleName, results }),
		);
	}
});
