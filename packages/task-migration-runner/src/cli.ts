#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runCli } from "./index.ts";

export { runCli } from "./index.ts";

if (
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
	const output = await runCli(process.argv.slice(2));
	if (output.data?.usage) process.stdout.write(`${output.data.usage}\n`);
	else
		process.stdout.write(
			output.ok
				? `${output.checks?.[0]?.message === "migrations applied" ? "迁移已完成" : output.checks?.[0]?.message === "migrations verified" ? "迁移验证通过" : "迁移状态可读取"}\n`
				: `迁移失败：${output.error?.message ?? output.checks?.[0]?.message ?? "未知错误"}\n`,
		);
	if (!output.ok) process.exitCode = 1;
}
