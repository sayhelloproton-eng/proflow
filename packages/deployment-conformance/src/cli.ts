#!/usr/bin/env -S node --experimental-strip-types

import { readFile } from "node:fs/promises";

import { descriptor } from "../deployment/descriptor.ts";
import { runStaticConformance } from "./index.ts";

const moduleRef = descriptor.moduleRef;
const moduleVersion = descriptor.moduleVersion;

export async function runCli(args: readonly string[]): Promise<string> {
	if (args.includes("--help") || args.includes("-h")) {
		return JSON.stringify({
			contract: "deployment.result.v1",
			ok: true,
			status: "SUCCEEDED",
			moduleRef,
			moduleVersion,
			data: { usage: "proflow-conformance --json [descriptor.json]" },
		});
	}
	if (!args.includes("--json")) throw new TypeError("--json is required");
	const descriptorPath = args.find((argument) => argument !== "--json");
	if (descriptorPath === undefined) {
		return JSON.stringify({
			contract: "deployment.result.v1",
			ok: true,
			status: "SUCCEEDED",
			moduleRef,
			moduleVersion,
		});
	}
	try {
		const input: unknown = JSON.parse(await readFile(descriptorPath, "utf8"));
		const result = runStaticConformance(input);
		return JSON.stringify({
			contract: "deployment.result.v1",
			ok: result.status === "PASS",
			status: result.status === "PASS" ? "SUCCEEDED" : "FAILED",
			moduleRef,
			moduleVersion,
			data: result,
			...(result.status === "FAIL"
				? {
						error: {
							code: "CONFORMANCE_FAILED",
							message: "Static conformance failed",
							retryable: false,
						},
					}
				: {}),
		});
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "unknown error";
		return JSON.stringify({
			contract: "deployment.result.v1",
			ok: false,
			status: "FAILED",
			moduleRef,
			moduleVersion,
			error: { code: "INVALID_REQUEST", message, retryable: false },
		});
	}
}

if (import.meta.main) {
	const output = await runCli(process.argv.slice(2));
	process.stdout.write(`${output}\n`);
	const parsed: unknown = JSON.parse(output);
	if (
		typeof parsed === "object" &&
		parsed !== null &&
		Reflect.get(parsed, "ok") === false
	) {
		process.exitCode = 1;
	}
}
