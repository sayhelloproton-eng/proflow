import assert from "node:assert/strict";
import { test } from "node:test";

import { renderHumanResult, runCli } from "../src/cli.ts";

test("public --json is rejected and runCli returns a typed object", async () => {
	const result = await runCli(["--json"]);
	assert.equal(typeof result, "object");
	assert.equal(result.status, "FAILED");
	assert.equal(result.error?.code, "INVALID_REQUEST");
});

test("human status output translates every public status enum", () => {
	const rendered = renderHumanResult({
		command: "status",
		status: "SUCCEEDED",
		data: {
			modules: [
				{
					moduleRef: "a",
					version: "1.0.0",
					setupStatus: "ACTION_REQUIRED",
					runtimeStatus: "NOT_APPLICABLE",
				},
				{
					moduleRef: "b",
					version: "1.0.0",
					setupStatus: "READY",
					runtimeStatus: "RUNNING",
				},
				{
					moduleRef: "c",
					version: "1.0.0",
					setupStatus: "FAILED",
					runtimeStatus: "STOPPED",
				},
			],
		},
	});
	for (const raw of [
		"ACTION_REQUIRED",
		"NOT_APPLICABLE",
		"READY",
		"RUNNING",
		"STOPPED",
	])
		assert.equal(rendered.includes(raw), false);
	for (const translated of [
		"需要操作",
		"无独立进程",
		"已就绪",
		"运行中",
		"已停止",
		"失败",
	])
		assert.match(rendered, new RegExp(translated));
});

test("help contains explanations and no raw JSON input route", () => {
	const rendered = renderHumanResult({ command: "help", status: "SUCCEEDED" });
	assert.match(rendered, /安装并初始化全部 ProFlow 模块/);
	assert.match(rendered, /人工配置示例/);
	assert.match(rendered, /状态图例/);
	assert.equal(rendered.includes("--input"), false);
});
