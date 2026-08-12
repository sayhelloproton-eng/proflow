#!/usr/bin/env -S node --experimental-strip-types

import { readFile } from "node:fs/promises";

import { runStaticConformance } from "./index.ts";

const descriptorPath = process.argv[2];
if (descriptorPath === undefined) {
	process.stdout.write(
		`${JSON.stringify({ status: "FAIL", error: "descriptor path required" })}\n`,
	);
	process.exitCode = 2;
} else {
	try {
		const input: unknown = JSON.parse(await readFile(descriptorPath, "utf8"));
		const result = runStaticConformance(input);
		process.stdout.write(`${JSON.stringify(result)}\n`);
		if (result.status === "FAIL") process.exitCode = 1;
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "unknown error";
		process.stdout.write(
			`${JSON.stringify({ status: "FAIL", error: message })}\n`,
		);
		process.exitCode = 2;
	}
}
