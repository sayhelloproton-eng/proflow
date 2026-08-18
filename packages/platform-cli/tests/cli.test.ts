import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import {
	claimWorkspaceBinding,
	updateGlobalBindingState,
} from "../src/binding/global-binding.ts";
import {
	type CliRuntimeOptions,
	renderHumanResult,
	runCli,
} from "../src/cli.ts";
import { discoverModules } from "../src/discovery/discover.ts";
import { workspacePaths } from "../src/paths.ts";
import { materializeConfig } from "../src/persistence/config.ts";

const WORKSPACE = resolve(import.meta.dirname, "../../..");

interface MachineResult {
	ok: boolean;
	status: string;
	data?: unknown;
	workspace?: { boundWorkspace?: string; bindingState?: string };
	error?: { code: string };
}

async function machineResult(
	argv: readonly string[],
	runtime?: CliRuntimeOptions,
): Promise<MachineResult> {
	if (runtime !== undefined) {
		const output = await runCli(argv, runtime);
		const parsed: unknown = JSON.parse(output);
		assert.equal(typeof parsed, "object");
		return parsed as MachineResult;
	}
	const base = await mkdtemp(join(tmpdir(), "proflow-cli-unbound-"));
	try {
		return await machineResult(argv, {
			cwd: WORKSPACE,
			globalRoot: join(base, "global"),
		});
	} finally {
		await rm(base, { recursive: true, force: true });
	}
}

async function boundRealWorkspaceFixture() {
	const base = await mkdtemp(join(tmpdir(), "proflow-cli-real-bound-"));
	const root = join(base, "workspace");
	const globalRoot = join(base, "global");
	await writeFile(join(base, "placeholder"), "");
	await import("node:fs/promises").then(({ mkdir }) =>
		mkdir(root, { recursive: true }),
	);
	const packageDirs = (
		await readdir(join(WORKSPACE, "packages"), { withFileTypes: true })
	)
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(WORKSPACE, "packages", entry.name));
	await writeFile(
		join(root, "pnpm-workspace.yaml"),
		`packages:\n${packageDirs.map((directory) => `  - ${JSON.stringify(directory)}`).join("\n")}\n`,
	);
	await writeFile(
		join(root, "package.json"),
		`${JSON.stringify({ name: "platform-cli-real-fixture", private: true }, null, 2)}\n`,
	);
	const { binding } = await claimWorkspaceBinding({
		workspace: root,
		globalRoot,
	});
	const installed = await updateGlobalBindingState({
		workspaceInstanceId: binding.workspaceInstanceId,
		state: "INSTALLED",
		globalRoot,
	});
	return {
		root,
		globalRoot,
		binding: installed,
		async cleanup() {
			await rm(base, { recursive: true, force: true });
		},
	};
}

async function bindInstalled(workspace: string) {
	const globalBase = await mkdtemp(join(tmpdir(), "proflow-cli-bound-"));
	const globalRoot = join(globalBase, "global");
	const { binding } = await claimWorkspaceBinding({ workspace, globalRoot });
	const installed = await updateGlobalBindingState({
		workspaceInstanceId: binding.workspaceInstanceId,
		state: "INSTALLED",
		globalRoot,
	});
	return {
		globalRoot,
		binding: installed,
		async cleanup() {
			await rm(globalBase, { recursive: true, force: true });
		},
	};
}

test("--version exposes the published CLI version and human rendering is readable", async () => {
	const output = await runCli(["--version", "--json"]);
	const result = JSON.parse(output) as { data?: { version?: string } };
	assert.equal(result.data?.version, "0.1.2");
	assert.equal(renderHumanResult(output), "ProFlow Platform CLI 0.1.2");
});

test("human help explains common install, readiness, configure, and lifecycle flows", async () => {
	const output = await runCli(["--help"]);
	const rendered = renderHumanResult(output);
	assert.ok(rendered.includes("Usage:"));
	assert.ok(rendered.includes("platform preflight --intent install"));
	assert.ok(
		rendered.includes("platform plan --intent configure --config <file>"),
	);
	assert.ok(rendered.includes("append --json"));
	assert.ok(!rendered.trimStart().startsWith("{"));
});

test("runCli --json returns the structured machine result contract", async () => {
	const result = await machineResult(["--json"]);
	assert.equal(result.ok, true);
	assert.equal(result.status, "SUCCEEDED");
});

test("unknown command returns FAILED with INVALID_REQUEST", async () => {
	const result = await machineResult(["frobnicate"]);
	assert.equal(result.ok, false);
	assert.equal(result.status, "FAILED");
	assert.equal(result.error?.code, "INVALID_REQUEST");
});

test("plan without --intent returns FAILED", async () => {
	const result = await machineResult(["plan", "--workspace", WORKSPACE]);
	assert.equal(result.status, "FAILED");
	assert.equal(result.error?.code, "INVALID_REQUEST");
});

test("plan with invalid --intent returns FAILED", async () => {
	const result = await machineResult([
		"plan",
		"--workspace",
		WORKSPACE,
		"--intent",
		"destroy",
	]);
	assert.equal(result.status, "FAILED");
	assert.equal(result.error?.code, "INVALID_REQUEST");
});

test("plan configure is not gated by runtime or human preflight readiness", async () => {
	const fixture = await boundRealWorkspaceFixture();
	const configFile = join(fixture.root, "configure.json");
	try {
		const modules = await discoverModules({ workspaceRoot: fixture.root });
		const target = modules.find((module) => module.configSlots.length > 0);
		assert.ok(target, "fixture must expose at least one config slot");
		const slot = target.configSlots[0];
		assert.ok(slot, "target must expose a concrete config slot");
		const value =
			slot.type === "secretRef"
				? "secret://real1/configure-bootstrap"
				: slot.type === "url"
					? "http://127.0.0.1:65530"
					: slot.type === "path"
						? fixture.root
						: "real1-configure-bootstrap";

		await writeFile(
			configFile,
			`${JSON.stringify(
				{ modules: { [target.moduleRef]: { [slot.key]: value } } },
				null,
				2,
			)}
`,
		);

		const result = await machineResult(
			["plan", "--intent", "configure", "--config", configFile],
			{
				cwd: WORKSPACE,
				globalRoot: fixture.globalRoot,
			},
		);

		assert.equal(result.status, "SUCCEEDED");
		const data = result.data as {
			planRef: string;
			plan: {
				intent: string;
				steps: Array<{
					moduleRef: string;
					kind: string;
					executeStrategy: string;
				}>;
				humanActions: unknown[];
			};
		};
		assert.equal(typeof data.planRef, "string");
		assert.equal(data.plan.intent, "configure");
		assert.deepEqual(
			data.plan.steps.map((step) => step.moduleRef),
			[target.moduleRef],
		);
		assert.ok(data.plan.steps.every((step) => step.kind === "config"));
		assert.ok(
			data.plan.steps.every((step) => step.executeStrategy === "config:write"),
		);
		assert.equal(data.plan.humanActions.length, 0);
	} finally {
		await fixture.cleanup();
	}
});

test("apply without planRef returns FAILED", async () => {
	const result = await machineResult(["apply", "--workspace", WORKSPACE]);
	assert.equal(result.status, "FAILED");
	assert.equal(result.error?.code, "INVALID_REQUEST");
});

test("status against a bound real-module workspace returns a structured array and bound path", async () => {
	const fixture = await boundRealWorkspaceFixture();
	try {
		const result = await machineResult(["status"], {
			cwd: WORKSPACE,
			globalRoot: fixture.globalRoot,
		});
		assert.ok(
			["SUCCEEDED", "ACTION_REQUIRED", "BLOCKED"].includes(result.status),
		);
		assert.ok(Array.isArray(result.data));
		assert.equal(
			result.workspace?.boundWorkspace,
			fixture.binding.workspaceRealPath,
		);
	} finally {
		await fixture.cleanup();
	}
});

test("preflight against the bound real-module workspace returns a typed result", async () => {
	const fixture = await boundRealWorkspaceFixture();
	try {
		const result = await machineResult(["preflight"], {
			cwd: WORKSPACE,
			globalRoot: fixture.globalRoot,
		});
		const data = result.data as {
			ok: boolean;
			status: string;
			findings: unknown[];
		};
		assert.equal(typeof data.ok, "boolean");
		assert.ok(
			["READY", "DEGRADED", "ACTION_REQUIRED", "NOT_READY"].includes(
				data.status,
			),
		);
		const expectedOuterStatus =
			data.status === "READY"
				? "SUCCEEDED"
				: data.status === "ACTION_REQUIRED"
					? "ACTION_REQUIRED"
					: "BLOCKED";
		assert.equal(result.status, expectedOuterStatus);
		assert.ok(Array.isArray(data.findings));
	} finally {
		await fixture.cleanup();
	}
});

test("doctor against the bound real-module workspace returns a structured array", async () => {
	const fixture = await boundRealWorkspaceFixture();
	try {
		const result = await machineResult(["doctor"], {
			cwd: WORKSPACE,
			globalRoot: fixture.globalRoot,
		});
		assert.ok(
			["SUCCEEDED", "ACTION_REQUIRED", "BLOCKED"].includes(result.status),
		);
		assert.ok(Array.isArray(result.data));
	} finally {
		await fixture.cleanup();
	}
});

test("manifest materializes .proflow and emits a typed manifest", async () => {
	const temp = await mkdtemp(join(tmpdir(), "proflow-cli-manifest-"));
	const binding = await bindInstalled(temp);
	try {
		const result = await machineResult(["manifest"], {
			cwd: WORKSPACE,
			globalRoot: binding.globalRoot,
		});
		assert.ok(
			result.status === "SUCCEEDED" || result.status === "ACTION_REQUIRED",
		);
		const data = result.data as { contract: string };
		assert.equal(data.contract, "proflow.manifest.v1");
	} finally {
		await binding.cleanup();
		await rm(temp, { recursive: true, force: true });
	}
});

test("plan --intent install persists a plan with a planRef before binding", async () => {
	const temp = await mkdtemp(join(tmpdir(), "proflow-cli-plan-"));
	try {
		const result = await machineResult([
			"plan",
			"--workspace",
			temp,
			"--intent",
			"install",
		]);
		assert.equal(result.status, "SUCCEEDED");
		const data = result.data as { planRef: string };
		assert.equal(typeof data.planRef, "string");
		assert.ok(data.planRef.length > 0);
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
});

test("preflight reuses materialized Workspace config after configuration is applied", async () => {
	const fixture = await boundRealWorkspaceFixture();
	try {
		const modules = await discoverModules({ workspaceRoot: fixture.root });
		const target = modules.find((module) =>
			module.configSlots.some((slot) => slot.required),
		);
		assert.ok(target, "fixture must expose at least one required config slot");

		const before = await machineResult(["preflight", target.moduleRef], {
			cwd: WORKSPACE,
			globalRoot: fixture.globalRoot,
		});
		const beforeFindings =
			(
				before.data as
					| { findings?: Array<{ code?: string; moduleRef?: string }> }
					| undefined
			)?.findings ?? [];
		assert.ok(
			beforeFindings.some(
				(finding) =>
					finding.code === "CONFIG_MISSING" &&
					finding.moduleRef === target.moduleRef,
			),
		);

		const values: Record<string, string> = {};
		const secretRefs: string[] = [];
		for (const slot of target.configSlots.filter((slot) => slot.required)) {
			values[slot.key] =
				slot.type === "secretRef" ? "secret://real1/test" : "real1-test-value";
			if (slot.type === "secretRef") secretRefs.push(slot.key);
		}
		await materializeConfig(workspacePaths(fixture.root), {
			moduleRef: target.moduleRef,
			values,
			secretRefs,
		});

		const after = await machineResult(["preflight", target.moduleRef], {
			cwd: WORKSPACE,
			globalRoot: fixture.globalRoot,
		});
		const afterFindings =
			(
				after.data as
					| { findings?: Array<{ code?: string; moduleRef?: string }> }
					| undefined
			)?.findings ?? [];
		assert.equal(
			afterFindings.some(
				(finding) =>
					finding.code === "CONFIG_MISSING" &&
					finding.moduleRef === target.moduleRef,
			),
			false,
		);
	} finally {
		await fixture.cleanup();
	}
});
