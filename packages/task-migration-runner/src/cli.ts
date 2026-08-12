#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { runCli } from "./index.ts";

export { runCli } from "./index.ts";

if (
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const output = await runCli(process.argv.slice(2));
	process.stdout.write(`${output}\n`);
	if ((JSON.parse(output) as { ok?: boolean }).ok !== true)
		process.exitCode = 1;
}
