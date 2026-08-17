import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	acquireGlobalOperationLock,
	claimWorkspaceBinding,
	clearGlobalBinding,
	forgetMissingWorkspaceBinding,
	globalPlatformPaths,
	loadGlobalBinding,
	requireBoundWorkspace,
	updateGlobalBindingState,
} from "../src/binding/global-binding.ts";
import { PlatformError } from "../src/errors.ts";

async function fixture() {
	const base = await mkdtemp(join(tmpdir(), "proflow-global-binding-"));
	const globalRoot = join(base, "global");
	const workspaceA = join(base, "a");
	const workspaceB = join(base, "b");
	await Promise.all([
		mkdir(workspaceA, { recursive: true }),
		mkdir(workspaceB, { recursive: true }),
	]);
	return {
		base,
		globalRoot,
		workspaceA,
		workspaceB,
		async cleanup() {
			await rm(base, { recursive: true, force: true });
		},
	};
}

test("CP-DPL-CLI-08 global binding claims exactly one Workspace and persists stable identity", async () => {
	const f = await fixture();
	try {
		const claimed = await claimWorkspaceBinding({
			workspace: f.workspaceA,
			globalRoot: f.globalRoot,
		});
		assert.equal(claimed.alreadyBound, false);
		assert.equal(claimed.binding.state, "INSTALLING");
		assert.equal(
			claimed.binding.workspaceRealPath,
			await realpath(f.workspaceA),
		);
		assert.ok(claimed.binding.workspaceInstanceId.length > 0);

		const persisted = await loadGlobalBinding(f.globalRoot);
		assert.equal(
			persisted?.workspaceInstanceId,
			claimed.binding.workspaceInstanceId,
		);
		const marker = JSON.parse(
			await readFile(
				join(f.workspaceA, ".proflow", "deployment", "instance.json"),
				"utf8",
			),
		) as { workspaceInstanceId: string };
		assert.equal(
			marker.workspaceInstanceId,
			claimed.binding.workspaceInstanceId,
		);
	} finally {
		await f.cleanup();
	}
});

test("CP-DPL-CLI-08 + RF-DPL-CLI-09 same canonical Workspace is idempotent but a second Workspace is blocked", async () => {
	const f = await fixture();
	try {
		const first = await claimWorkspaceBinding({
			workspace: f.workspaceA,
			globalRoot: f.globalRoot,
		});
		const alias = join(f.base, "a-link");
		await symlink(f.workspaceA, alias, "dir");
		const same = await claimWorkspaceBinding({
			workspace: alias,
			globalRoot: f.globalRoot,
		});
		assert.equal(same.alreadyBound, true);
		assert.equal(
			same.binding.workspaceInstanceId,
			first.binding.workspaceInstanceId,
		);

		await assert.rejects(
			claimWorkspaceBinding({
				workspace: f.workspaceB,
				globalRoot: f.globalRoot,
			}),
			(error: unknown) =>
				error instanceof PlatformError &&
				error.code === "WORKSPACE_ALREADY_BOUND",
		);
	} finally {
		await f.cleanup();
	}
});

test("CP-DPL-CLI-08 binding state transitions are instance-guarded and clear removes the active binding", async () => {
	const f = await fixture();
	try {
		const { binding } = await claimWorkspaceBinding({
			workspace: f.workspaceA,
			globalRoot: f.globalRoot,
		});
		const installed = await updateGlobalBindingState({
			workspaceInstanceId: binding.workspaceInstanceId,
			state: "INSTALLED",
			globalRoot: f.globalRoot,
		});
		assert.equal(installed.state, "INSTALLED");
		assert.equal(
			(await requireBoundWorkspace(f.globalRoot)).workspaceRealPath,
			await realpath(f.workspaceA),
		);
		await clearGlobalBinding({
			workspaceInstanceId: binding.workspaceInstanceId,
			globalRoot: f.globalRoot,
			removeWorkspaceMarker: true,
		});
		assert.equal(await loadGlobalBinding(f.globalRoot), undefined);
		await assert.rejects(
			requireBoundWorkspace(f.globalRoot),
			(error: unknown) =>
				error instanceof PlatformError && error.code === "WORKSPACE_NOT_BOUND",
		);
	} finally {
		await f.cleanup();
	}
});

test("CP-DPL-CLI-08 missing bound Workspace is reported and can only be forgotten explicitly", async () => {
	const f = await fixture();
	try {
		const { binding } = await claimWorkspaceBinding({
			workspace: f.workspaceA,
			globalRoot: f.globalRoot,
		});
		await rm(f.workspaceA, { recursive: true, force: true });
		await assert.rejects(
			requireBoundWorkspace(f.globalRoot),
			(error: unknown) =>
				error instanceof PlatformError &&
				error.code === "BOUND_WORKSPACE_MISSING",
		);
		const forgotten = await forgetMissingWorkspaceBinding({
			globalRoot: f.globalRoot,
		});
		assert.equal(forgotten.workspaceInstanceId, binding.workspaceInstanceId);
		assert.equal(await loadGlobalBinding(f.globalRoot), undefined);
	} finally {
		await f.cleanup();
	}
});

test("CP-DPL-CLI-08 global state paths are outside the managed Workspace and can be isolated for tests", async () => {
	const f = await fixture();
	try {
		const paths = globalPlatformPaths(f.globalRoot);
		assert.equal(paths.root, f.globalRoot);
		assert.equal(paths.bindingJson, join(f.globalRoot, "binding.json"));
		assert.equal(paths.bindingLock, join(f.globalRoot, "binding.lock"));
		assert.equal(paths.operationLock, join(f.globalRoot, "operation.lock"));
	} finally {
		await f.cleanup();
	}
});

test("CP-DPL-CLI-08 global operation lock covers the whole install/uninstall critical section", async () => {
	const f = await fixture();
	try {
		const first = await acquireGlobalOperationLock(f.globalRoot);
		try {
			await assert.rejects(
				acquireGlobalOperationLock(f.globalRoot),
				(error: unknown) =>
					error instanceof PlatformError &&
					error.code === "GLOBAL_OPERATION_LOCKED",
			);
		} finally {
			await first.release();
		}
		const second = await acquireGlobalOperationLock(f.globalRoot);
		await second.release();
	} finally {
		await f.cleanup();
	}
});

test("CP-DPL-CLI-08 orphan Workspace marker restores the stable instance identity instead of minting a new one", async () => {
	const f = await fixture();
	try {
		const first = await claimWorkspaceBinding({
			workspace: f.workspaceA,
			globalRoot: f.globalRoot,
		});
		const firstId = first.binding.workspaceInstanceId;
		await rm(globalPlatformPaths(f.globalRoot).bindingJson, { force: true });

		const recovered = await claimWorkspaceBinding({
			workspace: f.workspaceA,
			globalRoot: f.globalRoot,
		});
		assert.equal(recovered.alreadyBound, false);
		assert.equal(recovered.binding.workspaceInstanceId, firstId);
		assert.equal(recovered.binding.createdAt, first.binding.createdAt);
	} finally {
		await f.cleanup();
	}
});

test("CP-DPL-CLI-08 a malformed orphan Workspace marker fails closed", async () => {
	const f = await fixture();
	try {
		const markerDir = join(f.workspaceA, ".proflow", "deployment");
		await mkdir(markerDir, { recursive: true });
		await writeFile(join(markerDir, "instance.json"), "{}\n", "utf8");
		await assert.rejects(
			claimWorkspaceBinding({
				workspace: f.workspaceA,
				globalRoot: f.globalRoot,
			}),
			(error: unknown) =>
				error instanceof PlatformError &&
				error.code === "WORKSPACE_INSTANCE_INVALID",
		);
		assert.equal(await loadGlobalBinding(f.globalRoot), undefined);
	} finally {
		await f.cleanup();
	}
});
