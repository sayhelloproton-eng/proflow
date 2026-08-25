import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { renderHumanResult, runCli } from "../src/cli.ts";

const parseCli = <T>(value: T): T => value;

import { tempWorkspace, writeWorkspaceModule } from "./test-helpers.ts";

test("platform status aggregates only Module-owned setup/runtime status", async () => {
	const root = await tempWorkspace();
	try {
		await writeWorkspaceModule(root, {
			moduleRef: "fixture-module",
			statusData: {
				setupStatus: "ACTION_REQUIRED",
				runtimeStatus: "STOPPED",
				issues: [
					{
						scope: "SETUP",
						code: "SETUP_REQUIRED",
						message: "Fixture 尚未配置",
						relatedModuleRefs: [],
						nextCommand: "platform setup --module fixture-module",
					},
				],
			},
		});
		const output = parseCli(await runCli(["status"], { cwd: root })) as {
			status: string;
			data: { modules: unknown[] };
		};
		assert.equal(output.status, "SUCCEEDED");
		assert.deepEqual(output.data.modules, [
			{
				moduleRef: "fixture-module",
				version: "1.0.0",
				setupStatus: "ACTION_REQUIRED",
				runtimeStatus: "STOPPED",
				issues: [
					{
						scope: "SETUP",
						code: "SETUP_REQUIRED",
						message: "Fixture 尚未配置",
						relatedModuleRefs: [],
						nextCommand: "platform setup --module fixture-module",
					},
				],
			},
		]);
		const serialized = JSON.stringify(output.data.modules[0]);
		assert.equal(serialized.includes("configStatus"), false);
		assert.equal(serialized.includes("missingConfig"), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("platform status summary counts runtime failure as failure instead of ready", () => {
	const rendered = renderHumanResult({
		command: "status",
		status: "SUCCEEDED",
		data: {
			modules: [
				{
					moduleRef: "dev-tunnel",
					version: "0.1.14",
					setupStatus: "READY",
					runtimeStatus: "FAILED",
					issues: [],
				},
				{
					moduleRef: "module-contract",
					version: "0.1.12",
					setupStatus: "READY",
					runtimeStatus: "NOT_APPLICABLE",
					issues: [],
				},
			],
		},
	});
	assert.match(rendered, /失败[\s\S]*dev-tunnel/);
	assert.match(rendered, /1 已就绪.*1 失败/);
	assert.doesNotMatch(rendered, /2 已就绪/);
});

test("platform status ignores obsolete config and all removed routes remain invalid", async () => {
	const root = await tempWorkspace();
	try {
		await writeWorkspaceModule(root, { moduleRef: "fixture-module" });
		const configRoot = join(root, ".proflow", "config");
		await mkdir(configRoot, { recursive: true });
		await writeFile(join(configRoot, "fixture-module.json"), "{not-json");
		const output = parseCli(await runCli(["status"], { cwd: root })) as {
			status: string;
		};
		assert.equal(output.status, "SUCCEEDED");
		for (const removed of [
			"modules",
			"preflight",
			"verify",
			"doctor",
			"restart",
			"plan",
			"apply",
			"upgrade",
			"manifest",
		]) {
			const old = parseCli(await runCli([removed], { cwd: root })) as {
				status: string;
				error?: { code: string };
			};
			assert.equal(old.status, "FAILED", removed);
			assert.equal(old.error?.code, "INVALID_REQUEST", removed);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("platform setup human output preserves all actions when the aggregate also contains machine failures", () => {
	const rendered = renderHumanResult({
		command: "setup",
		status: "FAILED",
		data: {
			phase: "setup",
			completed: false,
			skipped: [
				{ moduleRef: "module-contract", reason: "READY" },
				{ moduleRef: "platform-host", reason: "READY" },
			],
			results: [
				{
					moduleRef: "chatgpt-carrier",
					result: {
						status: "ACTION_REQUIRED",
						actionRequired: {
							action: "materialize-custom-gpt-carrier",
							description: "Run the package-owned carrier setup command.",
						},
					},
				},
				{
					moduleRef: "model-runtime",
					result: {
						status: "FAILED",
						error: {
							code: "SETUP_FAILED",
							message: "producer shared facts are unavailable",
						},
					},
				},
			],
		},
	});
	assert.match(rendered, /ProFlow 配置/);
	assert.match(rendered, /chatgpt-carrier/);
	assert.match(rendered, /◆ chatgpt-carrier/);
	assert.match(rendered, /proflow-chatgpt-carrier setup/);
	assert.match(rendered, /AI 执行/);
	assert.match(rendered, /model-runtime/);
	assert.match(rendered, /✕ model-runtime/);
	assert.match(rendered, /SETUP_FAILED/);
	assert.match(rendered, /producer shared facts are unavailable/);
	assert.match(rendered, /汇总：2 个已就绪，1 个需要操作，1 个系统阻塞/);
	assert.notEqual(rendered, "SETUP FAILED");
});

test("Dev Tunnel setup guidance uses automatic discovery without manual tunnel facts", () => {
	const rendered = renderHumanResult({
		command: "setup",
		status: "ACTION_REQUIRED",
		data: {
			phase: "setup",
			completed: false,
			results: [
				{
					moduleRef: "dev-tunnel",
					result: {
						status: "ACTION_REQUIRED",
						actionRequired: {
							action: "authenticate-dev-tunnel",
							description: "Authenticate Microsoft Dev Tunnel.",
						},
					},
				},
			],
		},
	});
	assert.match(rendered, /pnpm exec -- proflow-dev-tunnel setup/);
	assert.match(rendered, /需要输入：无/);
	assert.doesNotMatch(rendered, /--tunnel-id|--public-base-url/);
});

test("Platform setup guidance does not request stale Carrier, Agent, or model facts", () => {
	for (const moduleRef of [
		"chatgpt-carrier",
		"agent-controller-dev",
		"agent-product",
		"agent-test-ops",
		"model-provider-api",
		"model-runtime",
	]) {
		const rendered = renderHumanResult({
			command: "setup",
			status: "ACTION_REQUIRED",
			data: {
				phase: "setup",
				completed: false,
				results: [
					{
						moduleRef,
						result: {
							status: "ACTION_REQUIRED",
							actionRequired: {
								action: `configure-${moduleRef}`,
								description: "Reconcile current reality.",
							},
						},
					},
				],
			},
		});
		assert.doesNotMatch(
			rendered,
			/--carrier-url|--fast-model|--reason-model|--provider-base-url/,
		);
	}
});

test("Platform setup output shows dependency-blocked modules without inventing Module setup results", () => {
	const rendered = renderHumanResult({
		command: "setup",
		status: "BLOCKED",
		data: {
			phase: "setup",
			completed: false,
			results: [],
			blockers: [
				{
					moduleRef: "model-runtime",
					setupStatus: "BLOCKED",
					reason: "等待依赖模块就绪：model-provider-api",
					nextCommand: "platform setup --module model-provider-api",
				},
			],
		},
	});
	assert.match(rendered, /◇ model-runtime/);
	assert.match(rendered, /等待依赖模块就绪：model-provider-api/);
	assert.match(rendered, /platform setup --module model-provider-api/);
});
