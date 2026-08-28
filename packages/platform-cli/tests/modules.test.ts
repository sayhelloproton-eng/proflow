import assert from "node:assert/strict";
import {
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { renderHumanResult, runCli } from "../src/cli.ts";

const parseCli = <T>(value: T): T => value;

import { tempWorkspace, writeWorkspaceModule } from "./test-helpers.ts";

async function snapshotProflowFiles(root: string) {
	const proflowRoot = join(root, ".proflow");
	const files: Array<{ path: string; content: string; mtimeMs: number }> = [];
	async function walk(directory: string, prefix = "") {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const relativePath =
				prefix === "" ? entry.name : join(prefix, entry.name);
			const absolutePath = join(directory, entry.name);
			if (entry.isDirectory()) {
				await walk(absolutePath, relativePath);
				continue;
			}
			const metadata = await stat(absolutePath);
			files.push({
				path: relativePath,
				content: (await readFile(absolutePath)).toString("base64"),
				mtimeMs: metadata.mtimeMs,
			});
		}
	}
	await walk(proflowRoot);
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

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

test("platform status is a pure read and preserves .proflow file set, content, and mtime across repeated calls", async () => {
	const root = await tempWorkspace();
	try {
		await writeWorkspaceModule(root, { moduleRef: "fixture-module" });
		const proflowRoot = join(root, ".proflow");
		await mkdir(join(proflowRoot, "nested"), { recursive: true });
		await writeFile(join(proflowRoot, "sentinel.json"), '{"stable":true}\n');
		await writeFile(join(proflowRoot, "nested", "state.txt"), "stable-state\n");
		const before = await snapshotProflowFiles(root);

		for (let attempt = 0; attempt < 2; attempt += 1) {
			const output = parseCli(await runCli(["status"], { cwd: root })) as {
				status: string;
			};
			assert.equal(output.status, "SUCCEEDED");
			assert.deepEqual(await snapshotProflowFiles(root), before);
		}
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
	assert.match(rendered, /1 配置已完成.*1 失败/);
	assert.doesNotMatch(rendered, /2 配置已完成/);
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
					moduleRef: "execution-browser-extension",
					result: {
						status: "ACTION_REQUIRED",
						actionRequired: {
							action: "load-unpacked-extension",
							description: "Load the prepared browser extension.",
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
	assert.match(rendered, /浏览器扩展/);
	assert.match(rendered, /◆ 浏览器扩展/);
	assert.doesNotMatch(
		rendered,
		/platform setup --module execution-browser-extension/,
	);
	assert.match(rendered, /FAST \/ THINK 模型/);
	assert.match(rendered, /✕ FAST \/ THINK 模型/);
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
	assert.match(rendered, /远程连接/);
	assert.match(rendered, /Platform 向导/);
	assert.doesNotMatch(rendered, /platform setup --module dev-tunnel/);
	assert.doesNotMatch(rendered, /--tunnel-id|--public-base-url/);
});

test("Platform setup guidance does not request stale Carrier, Agent, or model facts", () => {
	for (const moduleRef of [
		"execution-browser-extension",
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
