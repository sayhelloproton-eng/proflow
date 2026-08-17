import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { ConfigSlot } from "@tomflow/proflow-module-contract";

import type {
	DeploymentPlan,
	ModuleTarget,
	ResolvedModule,
	VerificationRecord,
} from "../src/contracts.ts";
import { PlatformError, type PlatformErrorCode } from "../src/errors.ts";
import { type WorkspacePaths, workspacePaths } from "../src/paths.ts";
import {
	appendVerification,
	emptyDeploymentState,
	listPlans,
	loadConfig,
	loadDeploymentState,
	loadLatestVerification,
	loadPlan,
	loadVerificationHistory,
	materializeConfig,
	saveDeploymentState,
	savePlan,
	writeInstallDoc,
} from "../src/persistence/index.ts";
import {
	acquireWorkspaceLock,
	readWorkspaceLock,
	redactDeep,
	redactPlanSecrets,
	redactSecretValues,
	SECRET_REDACTED,
	workspaceLockPath,
} from "../src/security/index.ts";

async function tmpWorkspace(): Promise<{
	root: string;
	paths: WorkspacePaths;
	cleanup(): Promise<void>;
}> {
	const root = await mkdtemp(join(tmpdir(), "proflow-cli-persist-"));
	return {
		root,
		paths: workspacePaths(root),
		async cleanup() {
			await rm(root, { recursive: true, force: true });
		},
	};
}

function makePlan(
	planRef: string,
	opts: { secretConfig?: Record<string, string> } = {},
): DeploymentPlan {
	const configSlots: ConfigSlot[] = [];
	if (opts.secretConfig !== undefined) {
		configSlots.push({
			key: "apiKey",
			type: "secretRef",
			required: false,
			sensitive: true,
			description: "api credential reference",
		});
	}
	const resolvedModules: ResolvedModule[] = [
		{
			moduleRef: "mod-a",
			packageName: "@tomflow/proflow-mod-a",
			moduleVersion: "1.0.0",
			kind: "service",
			installClass: "optional",
			identity: {
				domain: "deployment-governance",
				summary: "Platform CLI test fixture",
			},
			documentation: [],
			provides: [],
			requires: [],
			requirements: [],
			configSlots,
			lifecycle: ["describe", "verify"],
			verification: { checks: [] },
			effects: [],
			source: { type: "workspace", path: "/fixture" },
		},
	];
	const moduleTargets: ModuleTarget[] =
		opts.secretConfig !== undefined
			? [
					{
						moduleRef: "mod-a",
						targetVersion: "1.0.0",
						config: opts.secretConfig,
					},
				]
			: [{ moduleRef: "mod-a", targetVersion: "1.0.0" }];
	return {
		planRef,
		intent: "install",
		moduleTargets,
		resolvedModules,
		steps: [],
		effects: [],
		humanActions: [],
		verification: [],
		fingerprint: `fp-${planRef}`,
		createdAt: new Date().toISOString(),
	};
}

function makeVerification(
	moduleRef: string,
	moduleVersion: string,
	result: "PASS" | "FAIL",
): VerificationRecord {
	return {
		verificationRef: `${moduleRef}-${moduleVersion}-${result.toLowerCase()}`,
		moduleRef,
		moduleVersion,
		result,
		summary: `verified ${moduleVersion}`,
		evidenceRefs: [],
		verifiedAt: new Date().toISOString(),
	};
}

function errorCode(code: PlatformErrorCode): (error: unknown) => boolean {
	return (error: unknown): boolean =>
		error instanceof PlatformError && error.code === code;
}

// ---- State ----

test("state roundtrips deployment facts without claiming runtime readiness", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const state = emptyDeploymentState();
		assert.equal(state.contract, "proflow.deployment-state.v1");
		assert.ok(!Object.keys(state).includes("platformState"));
		state.selectedModules = [{ moduleRef: "mod-a", moduleVersion: "1.0.0" }];
		state.lastAppliedPlans = [
			{
				planRef: "plan-1",
				intent: "install",
				appliedAt: new Date().toISOString(),
			},
		];

		await saveDeploymentState(paths, state);

		const loaded = await loadDeploymentState(paths);
		assert.deepEqual(loaded?.selectedModules, state.selectedModules);
		assert.deepEqual(loaded?.lastAppliedPlans, state.lastAppliedPlans);
		assert.ok(!Object.keys(loaded ?? {}).includes("platformState"));

		// atomic write: on-disk content is complete valid JSON with no temp residue
		const raw = await readFile(paths.stateJson, "utf8");
		assert.deepEqual(JSON.parse(raw).selectedModules, state.selectedModules);
		const entries = await readdir(paths.deployment);
		assert.ok(entries.every((entry) => !entry.includes(".tmp-")));
	} finally {
		await cleanup();
	}
});

test("missing state loads as undefined so current reality wins", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		assert.equal(await loadDeploymentState(paths), undefined);
	} finally {
		await cleanup();
	}
});

test("pending actions persist durably as an interrupted-apply resume signal", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const state = emptyDeploymentState();
		state.pendingActions = [
			{
				planRef: "plan-1",
				stepRef: "step-human",
				moduleRef: "svc",
				action: "approve-external-resource",
				createdAt: new Date().toISOString(),
			},
		];
		await saveDeploymentState(paths, state);

		// simulate interruption: fresh process view re-reads from disk only
		const reloaded = await loadDeploymentState(paths);
		assert.deepEqual(reloaded?.pendingActions, state.pendingActions);
		assert.deepEqual(
			reloaded?.pendingActions.map((action) => action.planRef),
			["plan-1"],
		);
	} finally {
		await cleanup();
	}
});

// ---- Plans ----

test("CP-DPL-CLI-07 plan save/load roundtrips and is atomic", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const plan = makePlan("plan-001");
		await savePlan(paths, plan);

		const loaded = await loadPlan(paths, "plan-001");
		assert.equal(loaded?.planRef, "plan-001");
		assert.equal(loaded?.intent, "install");
		assert.deepEqual(await listPlans(paths), ["plan-001"]);

		const entries = await readdir(paths.plans);
		assert.ok(entries.every((entry) => !entry.includes(".tmp-")));
	} finally {
		await cleanup();
	}
});

test("missing plan loads as undefined", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		assert.equal(await loadPlan(paths, "nope"), undefined);
	} finally {
		await cleanup();
	}
});

test("secretRef reference persists verbatim in the plan", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const reference = "secret://model-provider/default";
		const plan = makePlan("plan-002", { secretConfig: { apiKey: reference } });
		await savePlan(paths, plan);

		const raw = await readFile(join(paths.plans, "plan-002.json"), "utf8");
		assert.ok(raw.includes(reference));

		const loaded = await loadPlan(paths, "plan-002");
		assert.equal(loaded?.moduleTargets[0]?.config?.apiKey, reference);
	} finally {
		await cleanup();
	}
});

// ---- Verification ----

test("verification history appends and preserves every record", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		await appendVerification(paths, makeVerification("mod-a", "1.0.0", "PASS"));
		await appendVerification(paths, makeVerification("mod-a", "1.0.1", "FAIL"));
		await appendVerification(paths, makeVerification("mod-a", "1.0.2", "PASS"));

		const history = await loadVerificationHistory(paths, "mod-a");
		assert.deepEqual(
			history.map((record) => record.moduleVersion),
			["1.0.0", "1.0.1", "1.0.2"],
		);
		assert.deepEqual(
			history.map((record) => record.result),
			["PASS", "FAIL", "PASS"],
		);
		assert.equal(
			(await loadLatestVerification(paths, "mod-a"))?.moduleVersion,
			"1.0.2",
		);
		assert.equal(
			(await loadLatestVerification(paths, "mod-a"))?.result,
			"PASS",
		);
	} finally {
		await cleanup();
	}
});

test("verification records for distinct modules stay isolated", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		await appendVerification(paths, makeVerification("mod-a", "1.0.0", "PASS"));
		await appendVerification(paths, makeVerification("mod-b", "2.0.0", "FAIL"));

		assert.equal((await loadVerificationHistory(paths, "mod-a")).length, 1);
		assert.equal((await loadVerificationHistory(paths, "mod-b")).length, 1);
		assert.equal(
			(await loadLatestVerification(paths, "mod-b"))?.result,
			"FAIL",
		);
	} finally {
		await cleanup();
	}
});

// ---- Config materialization ----

test("config materialization preserves secretRef references in public config, never .secrets.json", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const reference = "secret://model-provider/default";
		await materializeConfig(paths, {
			moduleRef: "mod-a",
			values: { apiKey: reference, endpoint: "https://example.com" },
			secretRefs: ["apiKey"],
		});

		const publicRaw = await readFile(join(paths.config, "mod-a.json"), "utf8");
		assert.ok(publicRaw.includes(reference));
		assert.ok(publicRaw.includes("https://example.com"));

		const secretRaw = await readFile(
			join(paths.config, "mod-a.secrets.json"),
			"utf8",
		);
		assert.ok(!secretRaw.includes(reference));

		const secretStat = await stat(join(paths.config, "mod-a.secrets.json"));
		assert.equal(secretStat.mode & 0o777, 0o600);

		const loaded = await loadConfig(paths, "mod-a");
		assert.equal(loaded?.publicValues.endpoint, "https://example.com");
		assert.equal(loaded?.publicValues.apiKey, reference);
		assert.equal(loaded?.secretValues.apiKey, undefined);
	} finally {
		await cleanup();
	}
});

// ---- Generated INSTALL ----

test("generated INSTALL.md never contains a raw secret", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const secret = "never-leak-this-value";
		const sanitized = redactDeep(
			{ config: { apiKey: secret, endpoint: "https://example.com" } },
			[secret],
		);
		await writeInstallDoc(paths, JSON.stringify(sanitized, null, 2));

		const install = await readFile(paths.installMd, "utf8");
		assert.ok(!install.includes(secret));
		assert.ok(install.includes(SECRET_REDACTED));
	} finally {
		await cleanup();
	}
});

// ---- Exclusive lock ----

test("acquire records lock metadata and release removes it", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const lock = await acquireWorkspaceLock(paths, "plan-1");
		assert.equal(lock.record.planRef, "plan-1");
		assert.equal(lock.record.pid, process.pid);
		assert.ok(lock.record.workspaceFingerprint.length > 0);
		assert.ok(lock.record.createdAt.length > 0);

		const onDisk = await readWorkspaceLock(paths);
		assert.equal(onDisk?.planRef, "plan-1");
		assert.equal(onDisk?.pid, process.pid);

		await lock.release();
		assert.equal(await readWorkspaceLock(paths), undefined);
	} finally {
		await cleanup();
	}
});

test("CP-DPL-CLI-07 second same-workspace apply is blocked with WORKSPACE_LOCKED", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const lock = await acquireWorkspaceLock(paths, "plan-1");
		try {
			await assert.rejects(
				() => acquireWorkspaceLock(paths, "plan-2"),
				(error: unknown): boolean =>
					error instanceof PlatformError &&
					error.code === "WORKSPACE_LOCKED" &&
					error.message.includes("plan-1") &&
					error.message.includes(String(process.pid)),
			);
		} finally {
			await lock.release();
		}
		// after release a new apply can acquire
		const lock2 = await acquireWorkspaceLock(paths, "plan-3");
		await lock2.release();
	} finally {
		await cleanup();
	}
});

test("lock is released via finally even when the body throws", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		const lock = await acquireWorkspaceLock(paths, "plan-1");
		await assert.rejects(async () => {
			try {
				throw new Error("boom");
			} finally {
				await lock.release();
			}
		});
		assert.equal(await readWorkspaceLock(paths), undefined);
		const again = await acquireWorkspaceLock(paths, "plan-2");
		await again.release();
	} finally {
		await cleanup();
	}
});

test("a lock that cannot be proven stale is never reclaimed", async () => {
	const { paths, cleanup } = await tmpWorkspace();
	try {
		await mkdir(paths.runtime, { recursive: true });
		// simulate a leftover lock from a possibly-dead pid
		await writeFile(
			workspaceLockPath(paths),
			JSON.stringify({
				pid: 999_999_999,
				createdAt: new Date(0).toISOString(),
				planRef: "ghost-plan",
				workspaceFingerprint: "deadbeef",
			}),
			"utf8",
		);

		await assert.rejects(
			() => acquireWorkspaceLock(paths, "plan-1"),
			errorCode("WORKSPACE_LOCKED"),
		);
		// the stale-looking lock remains untouched
		const onDisk = await readWorkspaceLock(paths);
		assert.equal(onDisk?.planRef, "ghost-plan");
	} finally {
		await cleanup();
	}
});

// ---- Redaction ----

test("redactSecretValues preserves secretRef references verbatim", () => {
	const reference = "secret://model-provider/default";
	const out = redactSecretValues({ apiKey: reference, name: "app" }, [
		"apiKey",
	]);
	assert.equal(out.apiKey, reference);
	assert.equal(out.name, "app");
});

test("redactDeep scrubs raw secrets from nested structures", () => {
	const secret = "token-abc-123";
	const input = {
		config: { apiKey: secret },
		list: [secret, `prefix-${secret}-suffix`, 42],
		nested: { deep: { value: secret } },
	};
	const out = redactDeep(input, [secret]);
	const serialized = JSON.stringify(out);
	assert.ok(!serialized.includes(secret));
	assert.ok(serialized.includes(SECRET_REDACTED));
});

test("redactPlanSecrets preserves secretRef references without mutating the input", () => {
	const reference = "secret://model-provider/default";
	const plan = makePlan("plan-9", { secretConfig: { apiKey: reference } });
	const cloned = redactPlanSecrets(plan);

	assert.equal(cloned.moduleTargets[0]?.config?.apiKey, reference);
	assert.notEqual(cloned, plan);
	// original untouched
	assert.equal(plan.moduleTargets[0]?.config?.apiKey, reference);
});
