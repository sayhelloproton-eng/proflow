import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { renderHumanResult, runCli } from "../src/cli.ts";
import { createTerminalProgressReporter } from "../src/terminal.ts";

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
	assert.match(rendered, /●\s+b/);
	assert.match(rendered, /◆\s+a/);
	assert.match(rendered, /✕\s+c/);
	assert.match(rendered, /下一步：platform setup --module a/);
	assert.match(rendered, /原因：模块配置检查失败/);
});

test("status reports one aggregate progress phase instead of printing every module", async () => {
	const events: Array<{ phase: string; moduleRef?: string; status: string }> =
		[];
	const result = await runCli(["status"], {
		onProgress: (event) => events.push(event),
	});
	assert.equal(result.status, "SUCCEEDED");
	assert.equal(
		events.some((event) => event.moduleRef !== undefined),
		false,
	);
	assert.deepEqual(
		events.map((event) => [event.phase, event.status]),
		[
			["status", "STARTED"],
			["status", "SUCCEEDED"],
		],
	);
});

test("help contains explanations and no raw JSON input route", () => {
	const rendered = renderHumanResult({ command: "help", status: "SUCCEEDED" });
	assert.match(rendered, /安装并初始化全部 ProFlow 模块/);
	assert.match(rendered, /人工配置示例/);
	assert.match(rendered, /状态图例/);
	assert.equal(rendered.includes("--input"), false);
});

test("non-TTY progress uses a stable marker instead of a frozen spinner", () => {
	const stream = new PassThrough();
	Object.defineProperty(stream, "isTTY", { value: false });
	let output = "";
	stream.on("data", (chunk) => {
		output += chunk.toString();
	});
	const reporter = createTerminalProgressReporter(
		stream as unknown as NodeJS.WriteStream,
	);
	reporter({
		command: "install",
		phase: "registry",
		status: "STARTED",
		message: "正在发现 Registry 模块",
	});
	reporter.close();
	assert.match(output, /^› 正在发现 Registry 模块\n$/);
	assert.doesNotMatch(output, /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
});
