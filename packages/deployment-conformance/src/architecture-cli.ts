#!/usr/bin/env -S node --experimental-strip-types

import { runRepositoryArchitecture } from "./architecture.ts";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
	process.stdout.write("Usage: proflow-architecture\n");
} else {
	const result = await runRepositoryArchitecture(process.cwd());
	process.stdout.write(`${JSON.stringify(result)}\n`);
	if (result.status === "FAIL") process.exitCode = 1;
}
