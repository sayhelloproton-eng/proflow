import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("public migration CLI executes when launched through a node_modules/.bin-style symlink", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-task-migrate-bin-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
	const bin = join(root, "proflow-task-migrate");
	const databasePath = join(root, "task.sqlite");
	await symlink(cli, bin);

	const result = spawnSync(
		process.execPath,
		[bin, "apply", "--database", databasePath],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /迁移已完成/);
	assert.doesNotMatch(result.stdout, /^\s*[{[]/);
	await access(databasePath);
});
