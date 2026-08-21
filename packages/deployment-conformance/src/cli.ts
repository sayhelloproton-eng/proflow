#!/usr/bin/env -S node --experimental-strip-types

import { readFile } from "node:fs/promises";

import { descriptor } from "../deployment/descriptor.ts";
import { runStaticConformance } from "./index.ts";

const moduleRef = descriptor.moduleRef;
const moduleVersion = descriptor.moduleVersion;

export interface ConformanceCliOutcome {
	contract: "deployment.result.v1";
	ok: boolean;
	status: "SUCCEEDED" | "FAILED";
	moduleRef: string;
	moduleVersion: string;
	data?: unknown;
	error?: { code: string; message: string; retryable: boolean };
}

export async function runCli(
	args: readonly string[],
): Promise<ConformanceCliOutcome> {
	if (args.includes("--json")) {
		return {
			contract: "deployment.result.v1",
			ok: false,
			status: "FAILED",
			moduleRef,
			moduleVersion,
			error: {
				code: "INVALID_REQUEST",
				message: "不支持的选项 --json",
				retryable: false,
			},
		};
	}
	if (args.includes("--help") || args.includes("-h")) {
		return {
			contract: "deployment.result.v1",
			ok: true,
			status: "SUCCEEDED",
			moduleRef,
			moduleVersion,
			data: { usage: "proflow-conformance [descriptor.json]" },
		};
	}
	const descriptorPath = args[0];
	if (descriptorPath === undefined) {
		return {
			contract: "deployment.result.v1",
			ok: true,
			status: "SUCCEEDED",
			moduleRef,
			moduleVersion,
		};
	}
	try {
		const input: unknown = JSON.parse(await readFile(descriptorPath, "utf8"));
		const result = runStaticConformance(input);
		return {
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
		};
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "unknown error";
		return {
			contract: "deployment.result.v1",
			ok: false,
			status: "FAILED",
			moduleRef,
			moduleVersion,
			error: { code: "INVALID_REQUEST", message, retryable: false },
		};
	}
}

if (import.meta.main) {
	const output = await runCli(process.argv.slice(2));
	if (output.data && typeof output.data === "object" && "usage" in output.data)
		process.stdout.write(`${String(Reflect.get(output.data, "usage"))}\n`);
	else
		process.stdout.write(
			output.ok
				? "一致性检查通过\n"
				: `一致性检查失败：${output.error?.message ?? "存在不一致"}\n`,
		);
	if (!output.ok) process.exitCode = 1;
}
