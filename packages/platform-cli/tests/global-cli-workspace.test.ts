import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	acquireGlobalOperationLock,
	claimWorkspaceBinding,
	loadGlobalBinding,
	updateGlobalBindingState,
} from "../src/binding/global-binding.ts";
import { runCli } from "../src/cli.ts";
import { workspacePaths } from "../src/paths.ts";
import { savePlan } from "../src/persistence/plans.ts";
import { planDeployment } from "../src/planner/plan.ts";

async function fixture() {
	const base = await mkdtemp(join(tmpdir(), "proflow-global-cli-"));
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
		async bindInstalled(workspace = workspaceA) {
			const { binding } = await claimWorkspaceBinding({
				workspace,
				globalRoot,
			});
			return updateGlobalBindingState({
				workspaceInstanceId: binding.workspaceInstanceId,
				state: "INSTALLED",
				globalRoot,
			});
		},
		async cleanup() {
			await rm(base, { recursive: true, force: true });
		},
	};
}

function parse(output: string): Record<string, unknown> {
	return JSON.parse(output) as Record<string, unknown>;
}

test("CP-DPL-CLI-09 status without a binding reports UNBOUND instead of guessing cwd", async () => {
	const f = await fixture();
	try {
		const result = parse(
			await runCli(["status"], { cwd: f.workspaceB, globalRoot: f.globalRoot }),
		);
		assert.equal(result.status, "SUCCEEDED");
		assert.deepEqual(result.data, {
			installed: false,
			bindingState: "UNBOUND",
			boundWorkspace: null,
			nextAction: "Run platform install [--workspace <path>]",
		});
	} finally {
		await f.cleanup();
	}
});

test("CP-DPL-CLI-09 Agent workspace options fail closed when missing or misspelled", async () => {
	const missing = JSON.parse(
		await runCli(["install", "--workspace"], { cwd: tmpdir() }),
	) as { status?: string; error?: { code?: string } };
	assert.equal(missing.status, "FAILED");
	assert.equal(missing.error?.code, "INVALID_REQUEST");

	const misspelled = JSON.parse(
		await runCli(["install", "--workspce", tmpdir()], { cwd: tmpdir() }),
	) as { status?: string; error?: { code?: string } };
	assert.equal(misspelled.status, "FAILED");
	assert.equal(misspelled.error?.code, "INVALID_REQUEST");
});

test("CP-DPL-CLI-09 instance commands reject a different --workspace instead of bypassing the global binding", async () => {
	const f = await fixture();
	try {
		await f.bindInstalled();
		const result = parse(
			await runCli(["modules", "--workspace", f.workspaceB], {
				cwd: f.workspaceB,
				globalRoot: f.globalRoot,
			}),
		);
		assert.equal(result.status, "FAILED");
		assert.equal(
			(result.error as { code?: string } | undefined)?.code,
			"WORKSPACE_ALREADY_BOUND",
		);
	} finally {
		await f.cleanup();
	}
});

test("CP-DPL-CLI-08 mutating instance commands share the global operation lock", async () => {
	const f = await fixture();
	try {
		await f.bindInstalled();
		const lock = await acquireGlobalOperationLock(f.globalRoot);
		try {
			for (const argv of [
				["start"],
				["stop"],
				["restart"],
				["upgrade", "fixture"],
				["uninstall", "fixture"],
			]) {
				const result = parse(
					await runCli(argv, {
						cwd: f.workspaceB,
						globalRoot: f.globalRoot,
					}),
				);
				assert.equal(result.status, "FAILED");
				assert.equal(
					(result.error as { code?: string } | undefined)?.code,
					"GLOBAL_OPERATION_LOCKED",
				);
			}
		} finally {
			await lock.release();
		}
	} finally {
		await f.cleanup();
	}
});

test("CP-DPL-CLI-09 + RF-DPL-CLI-10 status from another cwd resolves the bound Workspace and exposes it", async () => {
	const f = await fixture();
	try {
		const binding = await f.bindInstalled();
		const result = parse(
			await runCli(["status"], { cwd: f.workspaceB, globalRoot: f.globalRoot }),
		);
		const workspace = result.workspace as
			| { boundWorkspace?: string; workspaceInstanceId?: string }
			| undefined;
		assert.equal(workspace?.boundWorkspace, binding.workspaceRealPath);
		assert.equal(workspace?.workspaceInstanceId, binding.workspaceInstanceId);
	} finally {
		await f.cleanup();
	}
});

test("CP-DPL-CLI-09 status reports a missing bound Workspace without silently switching to cwd", async () => {
	const f = await fixture();
	try {
		const binding = await f.bindInstalled();
		await rm(f.workspaceA, { recursive: true, force: true });
		const result = parse(
			await runCli(["status"], { cwd: f.workspaceB, globalRoot: f.globalRoot }),
		);
		assert.equal(result.status, "BLOCKED");
		assert.equal(
			(result.data as { code?: string }).code,
			"BOUND_WORKSPACE_MISSING",
		);
		assert.equal(
			(result.workspace as { boundWorkspace?: string }).boundWorkspace,
			binding.workspaceRealPath,
		);
	} finally {
		await f.cleanup();
	}
});

test("CP-DPL-CLI-10 uninstall --forget rejects module/package and --workspace arguments instead of ignoring them", async () => {
	const f = await fixture();
	try {
		await f.bindInstalled();
		await rm(f.workspaceA, { recursive: true, force: true });

		for (const argv of [
			["uninstall", "some-module", "--forget"],
			["uninstall", "--forget", "--workspace", f.workspaceB],
		]) {
			const result = parse(
				await runCli(argv, {
					cwd: f.workspaceB,
					globalRoot: f.globalRoot,
				}),
			);
			assert.equal(result.status, "FAILED");
			assert.equal(
				(result.error as { code?: string } | undefined)?.code,
				"INVALID_REQUEST",
			);
		}
		assert.ok(await loadGlobalBinding(f.globalRoot));
	} finally {
		await f.cleanup();
	}
});

test("CP-DPL-CLI-10 uninstall --forget clears only a missing Workspace binding", async () => {
	const f = await fixture();
	try {
		await f.bindInstalled();
		await rm(f.workspaceA, { recursive: true, force: true });
		const result = parse(
			await runCli(["uninstall", "--forget"], {
				cwd: f.workspaceB,
				globalRoot: f.globalRoot,
			}),
		);
		assert.equal(result.status, "SUCCEEDED");
		assert.equal(
			(result.data as { resourcesCleaned?: boolean }).resourcesCleaned,
			false,
		);
		const after = parse(
			await runCli(["status"], { cwd: f.workspaceB, globalRoot: f.globalRoot }),
		);
		assert.equal(
			(after.data as { bindingState?: string }).bindingState,
			"UNBOUND",
		);
	} finally {
		await f.cleanup();
	}
});

test("CP-DPL-CLI-09 an install plan can establish the first binding only when apply begins", async () => {
	const f = await fixture();
	try {
		const plan = planDeployment({ intent: "install", modules: [] });
		await savePlan(workspacePaths(f.workspaceA), plan);

		const before = parse(
			await runCli(["status"], { cwd: f.workspaceB, globalRoot: f.globalRoot }),
		);
		assert.equal(
			(before.data as { bindingState?: string }).bindingState,
			"UNBOUND",
		);

		const applied = parse(
			await runCli(["apply", plan.planRef, "--workspace", f.workspaceA], {
				cwd: f.workspaceB,
				globalRoot: f.globalRoot,
			}),
		);
		assert.equal(applied.status, "SUCCEEDED");
		assert.equal(
			(applied.workspace as { boundWorkspace?: string }).boundWorkspace,
			await realpath(f.workspaceA),
		);

		const after = parse(
			await runCli(["status"], { cwd: f.workspaceB, globalRoot: f.globalRoot }),
		);
		assert.equal(
			(after.workspace as { bindingState?: string }).bindingState,
			"INSTALLED",
		);
	} finally {
		await f.cleanup();
	}
});

test("CP-DPL-CLI-09 an unbound Workspace cannot apply a non-install plan", async () => {
	const f = await fixture();
	try {
		const plan = planDeployment({ intent: "repair", modules: [], facts: [] });
		await savePlan(workspacePaths(f.workspaceA), plan);
		const result = parse(
			await runCli(["apply", plan.planRef, "--workspace", f.workspaceA], {
				cwd: f.workspaceB,
				globalRoot: f.globalRoot,
			}),
		);
		assert.equal(result.status, "FAILED");
		assert.equal(
			(result.error as { code?: string } | undefined)?.code,
			"WORKSPACE_NOT_BOUND",
		);
	} finally {
		await f.cleanup();
	}
});

test("CP-DPL-CLI-10 same-Workspace install is idempotent but a second Workspace is blocked", async () => {
	const f = await fixture();
	try {
		const binding = await f.bindInstalled();
		const same = parse(
			await runCli(["install", "--workspace", f.workspaceA], {
				cwd: f.workspaceB,
				globalRoot: f.globalRoot,
			}),
		);
		assert.equal(same.status, "SUCCEEDED");
		assert.deepEqual(same.data, {
			alreadyInstalled: true,
			changed: false,
			boundWorkspace: binding.workspaceRealPath,
		});

		const other = parse(
			await runCli(["install", "--workspace", f.workspaceB], {
				cwd: f.workspaceB,
				globalRoot: f.globalRoot,
			}),
		);
		assert.equal(other.status, "FAILED");
		assert.equal(
			(other.error as { code?: string } | undefined)?.code,
			"WORKSPACE_ALREADY_BOUND",
		);
	} finally {
		await f.cleanup();
	}
});

test("CP-DPL-CLI-10 whole-instance uninstall rejects an explicit different Workspace instead of silently uninstalling the bound one", async () => {
	const f = await fixture();
	try {
		await f.bindInstalled();
		const result = parse(
			await runCli(["uninstall", "--workspace", f.workspaceB], {
				cwd: f.workspaceB,
				globalRoot: f.globalRoot,
			}),
		);
		assert.equal(result.status, "FAILED");
		assert.equal(
			(result.error as { code?: string } | undefined)?.code,
			"WORKSPACE_ALREADY_BOUND",
		);
		assert.equal(
			(await loadGlobalBinding(f.globalRoot))?.workspaceRealPath,
			await realpath(f.workspaceA),
		);
	} finally {
		await f.cleanup();
	}
});

test("CP-DPL-CLI-10 + RF-DPL-CLI-11 whole-instance uninstall works from another cwd and only then allows rebind to B", async () => {
	const f = await fixture();
	try {
		await f.bindInstalled();
		const removed = parse(
			await runCli(["uninstall"], {
				cwd: f.workspaceB,
				globalRoot: f.globalRoot,
			}),
		);
		assert.equal(removed.status, "SUCCEEDED");
		assert.equal(
			(removed.data as { uninstalledWorkspace?: string }).uninstalledWorkspace,
			await realpath(f.workspaceA),
		);
		assert.equal(
			(removed.data as { bindingCleared?: boolean }).bindingCleared,
			true,
		);
		const unbound = parse(
			await runCli(["status"], {
				cwd: f.workspaceB,
				globalRoot: f.globalRoot,
			}),
		);
		assert.equal(
			(unbound.data as { bindingState?: string }).bindingState,
			"UNBOUND",
		);

		const plan = planDeployment({ intent: "install", modules: [] });
		await savePlan(workspacePaths(f.workspaceB), plan);
		const rebound = parse(
			await runCli(["apply", plan.planRef, "--workspace", f.workspaceB], {
				cwd: f.workspaceA,
				globalRoot: f.globalRoot,
			}),
		);
		assert.equal(rebound.status, "SUCCEEDED");
		assert.equal(
			(rebound.workspace as { boundWorkspace?: string }).boundWorkspace,
			await realpath(f.workspaceB),
		);
	} finally {
		await f.cleanup();
	}
});
