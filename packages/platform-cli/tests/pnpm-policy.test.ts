import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import {
	cleanOwnedPnpmPolicy,
	observeMinimumReleaseAgeExclude,
	recordPnpmPolicyOwnership,
} from "../src/install/pnpm-policy.ts";
import { tempWorkspace } from "./test-helpers.ts";

test("uninstall policy cleanup removes only install-introduced pnpm exclusions", async () => {
	const root = await tempWorkspace();
	try {
		const policy = join(root, "pnpm-workspace.yaml");
		await writeFile(
			policy,
			"packages: []\nminimumReleaseAgeExclude:\n  - 'user-owned@1.0.0'\n",
		);
		const before = await observeMinimumReleaseAgeExclude(root);
		await writeFile(
			policy,
			"packages: []\nminimumReleaseAgeExclude:\n  - 'user-owned@1.0.0'\n  - '@tomflow/proflow-platform-cli@0.1.22'\n",
		);
		await mkdir(join(root, ".proflow", "deployment"), { recursive: true });
		await recordPnpmPolicyOwnership(root, before);
		const upgradeBefore = await observeMinimumReleaseAgeExclude(root);
		await writeFile(
			policy,
			"packages: []\nminimumReleaseAgeExclude:\n  - 'user-owned@1.0.0'\n  - '@tomflow/proflow-platform-cli@0.1.22'\n  - '@tomflow/proflow-platform-cli@0.1.24'\n",
		);
		await recordPnpmPolicyOwnership(root, upgradeBefore);
		assert.deepEqual(await cleanOwnedPnpmPolicy(root), [
			"@tomflow/proflow-platform-cli@0.1.22",
			"@tomflow/proflow-platform-cli@0.1.24",
		]);
		const final = await readFile(policy, "utf8");
		assert.match(final, /user-owned@1\.0\.0/);
		assert.doesNotMatch(final, /proflow-platform-cli/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
