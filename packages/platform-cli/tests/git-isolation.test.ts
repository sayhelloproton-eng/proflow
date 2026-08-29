import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { ensureWorkspaceStateIsGitIgnored } from "../src/persistence/git-isolation.ts";

const execute = promisify(execFile);

test("install isolation keeps .proflow out of Git without changing tracked .gitignore", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-git-isolation-"));
	try {
		await execute("git", ["init", "-q", root]);
		await writeFile(join(root, ".gitignore"), "dist/\n");
		const result = await ensureWorkspaceStateIsGitIgnored(root);
		assert.deepEqual(result, { gitRepository: true, changed: true });
		assert.equal(await readFile(join(root, ".gitignore"), "utf8"), "dist/\n");
		assert.match(
			await readFile(join(root, ".git", "info", "exclude"), "utf8"),
			/^\/\.proflow\/$/m,
		);
		await writeFile(join(root, ".proflow-placeholder"), "outside\n");
		await execute("git", [
			"-C",
			root,
			"check-ignore",
			".proflow/workspace.json",
		]);
		assert.deepEqual(await ensureWorkspaceStateIsGitIgnored(root), {
			gitRepository: true,
			changed: false,
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
