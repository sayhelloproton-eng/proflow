import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
					issues: [
						{
							scope: "SETUP",
							code: "SETUP_REQUIRED",
							message: "尚未配置",
							relatedModuleRefs: [],
							nextCommand: "platform setup --module a",
						},
					],
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
					issues: [
						{
							scope: "SETUP",
							code: "VERIFY_FAILED",
							message: "配置文件签名无效",
							relatedModuleRefs: [],
							nextCommand: "platform setup --module c",
						},
					],
				},
				{
					moduleRef: "d",
					version: "1.0.0",
					setupStatus: "BLOCKED",
					runtimeStatus: "STOPPED",
					issues: [
						{
							scope: "SETUP",
							code: "UPSTREAM_NOT_READY",
							message: "等待 provider",
							relatedModuleRefs: ["provider"],
							nextCommand: "platform setup --module provider",
						},
					],
				},
			],
		},
	});
	for (const raw of ["ACTION_REQUIRED", "NOT_APPLICABLE", "RUNNING", "STOPPED"])
		assert.equal(rendered.includes(raw), false);
	for (const translated of [
		"需要操作",
		"无独立进程",
		"配置已完成",
		"运行中",
		"已停止",
		"失败",
	])
		assert.match(rendered, new RegExp(translated));
	assert.match(rendered, /●\s+b/);
	assert.match(rendered, /◆\s+a/);
	assert.match(rendered, /✕\s+c/);
	assert.match(rendered, /下一步：platform setup --module a/);
	assert.match(rendered, /原因：配置文件签名无效/);
	assert.match(rendered, /下游等待/);
	assert.match(rendered, /原因：等待 provider/);
	assert.doesNotMatch(rendered, /下一步：platform setup --module provider/);
	assert.doesNotMatch(rendered, /模块配置检查失败/);
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

test("browser setup guidance uses only the Platform public management entry", () => {
	const rendered = renderHumanResult({
		command: "setup",
		status: "ACTION_REQUIRED",
		data: {
			results: [
				{
					moduleRef: "execution-browser-extension",
					result: { status: "ACTION_REQUIRED" },
				},
			],
		},
	});
	assert.match(
		rendered,
		/人工执行：platform setup --module execution-browser-extension/,
	);
	assert.match(
		rendered,
		/AI 执行：platform setup --module execution-browser-extension/,
	);
	assert.match(rendered, /验证：platform status/);
	assert.doesNotMatch(
		rendered,
		/proflow-execution-browser-extension|pnpm exec/,
	);
});

test("help contains explanations and no raw JSON input route", () => {
	const rendered = renderHumanResult({ command: "help", status: "SUCCEEDED" });
	assert.match(rendered, /安装并初始化全部 ProFlow 模块/);
	assert.match(rendered, /配置入口/);
	assert.match(rendered, /状态图例/);
	assert.match(rendered, /-h, --help/);
	assert.match(rendered, /-v, --version/);
	assert.match(rendered, /等待依赖/);
	assert.equal(rendered.includes("--input"), false);
});

test("usage errors include contextual help while operation failures stay concise", async () => {
	const invalid = await runCli(["dasdsd"]);
	const invalidRendered = renderHumanResult(invalid);
	assert.match(invalidRendered, /unknown command dasdsd/);
	assert.match(invalidRendered, /用法/);
	assert.match(invalidRendered, /platform install/);
	const operationRendered = renderHumanResult({
		command: "start",
		status: "FAILED",
		error: { code: "COMMAND_FAILED", message: "service crashed" },
	});
	assert.match(operationRendered, /service crashed/);
	assert.doesNotMatch(operationRendered, /推荐流程/);
});

test("uninstall success says already uninstalled", () => {
	const rendered = renderHumanResult({
		command: "uninstall",
		status: "SUCCEEDED",
		workspaceRoot: "/workspace",
	});
	assert.match(rendered, /已经卸载/);
	assert.doesNotMatch(rendered, /卸载成功|已完成/);
});

test("docs terminal entry writes continuously without launching a pager", async () => {
	const source = await readFile(
		new URL("../src/cli.ts", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(source, /writeThroughPager|spawn\("less"/);
});

test("TTY replacement progress clears completed status checks instead of persisting them", () => {
	const stream = new PassThrough();
	Object.defineProperty(stream, "isTTY", { value: true });
	let output = "";
	stream.on("data", (chunk) => {
		output += chunk.toString();
	});
	const reporter = createTerminalProgressReporter(
		stream as unknown as NodeJS.WriteStream,
	);
	const event = {
		command: "start",
		kind: "detail" as const,
		retention: "REPLACE" as const,
		phase: "status",
		current: 12,
		total: 24,
		moduleRef: "model-runtime",
		message: "正在检查模块状态 · model-runtime",
	};
	reporter({ ...event, status: "STARTED" });
	reporter({ ...event, status: "SUCCEEDED" });
	reporter.close();
	assert.match(output, /正在检查模块状态/);
	assert.doesNotMatch(output, /完成/);
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

test("TTY progress keeps completed phases and restores the current task after subprocess logs", () => {
	const stream = new PassThrough();
	Object.defineProperty(stream, "isTTY", { value: true });
	let output = "";
	stream.on("data", (chunk) => {
		output += chunk.toString();
	});
	const reporter = createTerminalProgressReporter(
		stream as unknown as NodeJS.WriteStream,
	);
	reporter({
		command: "install",
		kind: "phase",
		phase: "registry",
		status: "SUCCEEDED",
		message: "Registry 解析完成",
	});
	reporter({
		command: "install",
		kind: "phase",
		phase: "packages",
		status: "STARTED",
		message: "正在同步依赖",
	});
	reporter({
		command: "install",
		kind: "subprocess",
		phase: "packages",
		status: "STARTED",
		message: "resolved 24, downloaded 3, added 24",
	});
	reporter.close();
	assert.match(output, /Registry 解析完成/);
	assert.match(output, /resolved 24, downloaded 3, added 24/);
	assert.ok((output.match(/正在同步依赖/g)?.length ?? 0) >= 2);
});

test("NO_COLOR disables semantic ANSI colors", () => {
	const previous = process.env.NO_COLOR;
	process.env.NO_COLOR = "1";
	try {
		const rendered = renderHumanResult(
			{ command: "help", status: "SUCCEEDED" },
			{ color: process.env.NO_COLOR === undefined, width: 80 },
		);
		assert.equal(rendered.includes(String.fromCharCode(27)), false);
	} finally {
		if (previous === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = previous;
	}
});

test("retryable package-manager warnings are yellow warnings, not failed events", () => {
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
		command: "uninstall",
		kind: "subprocess",
		phase: "packages",
		status: "WARNING",
		message: "[WARN] network error; will retry",
	});
	reporter.close();
	assert.match(output, /│ \[WARN\].*警告/);
	assert.doesNotMatch(output, /失败/);
});

test("stop summary does not count a no-effect module as both success and skipped", () => {
	const rendered = renderHumanResult({
		command: "stop",
		status: "SUCCEEDED",
		data: {
			results: [
				{
					moduleRef: "chrome-runtime",
					command: "stop",
					result: { status: "SUCCEEDED" },
				},
			],
			skipped: [{ moduleRef: "chrome-runtime", reason: "NO_EFFECT" }],
		},
	});
	assert.match(rendered, /成功：0\s+跳过：1\s+失败：0/);
});
