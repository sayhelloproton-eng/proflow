import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { runCli } from "../src/cli.ts";

const WORKSPACE = resolve(import.meta.dirname, "../../..");

async function machineResult(argv: readonly string[]): Promise<{
	ok: boolean;
	status: string;
	data?: unknown;
	error?: { code: string };
}> {
	const output = await runCli(argv);
	const parsed: unknown = JSON.parse(output);
	assert.equal(typeof parsed, "object");
	return parsed as {
		ok: boolean;
		status: string;
		data?: unknown;
		error?: { code: string };
	};
}

test("runCli --json returns the structured machine result contract", async () => {
	const result = await machineResult(["--json"]);
	assert.equal(result.ok, true);
	assert.equal(result.status, "SUCCEEDED");
});

test("unknown command returns FAILED with INVALID_REQUEST", async () => {
	const result = await machineResult(["frobnicate"]);
	assert.equal(result.ok, false);
	assert.equal(result.status, "FAILED");
	assert.equal(result.error?.code, "INVALID_REQUEST");
});

test("plan without --intent returns FAILED", async () => {
	const result = await machineResult(["plan", "--workspace", WORKSPACE]);
	assert.equal(result.status, "FAILED");
	assert.equal(result.error?.code, "INVALID_REQUEST");
});

test("plan with invalid --intent returns FAILED", async () => {
	const result = await machineResult([
		"plan",
		"--workspace",
		WORKSPACE,
		"--intent",
		"destroy",
	]);
	assert.equal(result.status, "FAILED");
	assert.equal(result.error?.code, "INVALID_REQUEST");
});

test("apply without planRef returns FAILED", async () => {
	const result = await machineResult(["apply", "--workspace", WORKSPACE]);
	assert.equal(result.status, "FAILED");
	assert.equal(result.error?.code, "INVALID_REQUEST");
});

test("status against the real workspace returns a structured array", async () => {
	const result = await machineResult(["status", "--workspace", WORKSPACE]);
	assert.ok(
		["SUCCEEDED", "ACTION_REQUIRED", "BLOCKED"].includes(result.status),
	);
	assert.ok(Array.isArray(result.data));
});

test("preflight against the real workspace returns a typed result", async () => {
	const result = await machineResult(["preflight", "--workspace", WORKSPACE]);
	assert.ok(result.status === "SUCCEEDED" || result.status === "BLOCKED");
	const data = result.data as {
		ok: boolean;
		status: string;
		findings: unknown[];
	};
	assert.equal(typeof data.ok, "boolean");
	assert.ok(
		["READY", "DEGRADED", "ACTION_REQUIRED", "NOT_READY"].includes(data.status),
	);
	assert.ok(Array.isArray(data.findings));
});

test("doctor against the real workspace returns a structured array", async () => {
	const result = await machineResult(["doctor", "--workspace", WORKSPACE]);
	assert.ok(
		["SUCCEEDED", "ACTION_REQUIRED", "BLOCKED"].includes(result.status),
	);
	assert.ok(Array.isArray(result.data));
});

test("manifest materializes .proflow and emits a typed manifest", async () => {
	const temp = await mkdtemp(join(tmpdir(), "proflow-cli-manifest-"));
	try {
		const result = await machineResult(["manifest", "--workspace", temp]);
		assert.ok(
			result.status === "SUCCEEDED" || result.status === "ACTION_REQUIRED",
		);
		const data = result.data as { contract: string };
		assert.equal(data.contract, "proflow.manifest.v1");
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
});

test("plan --intent install persists a plan with a planRef", async () => {
	const temp = await mkdtemp(join(tmpdir(), "proflow-cli-plan-"));
	try {
		const result = await machineResult([
			"plan",
			"--workspace",
			temp,
			"--intent",
			"install",
		]);
		assert.equal(result.status, "SUCCEEDED");
		const data = result.data as { planRef: string };
		assert.equal(typeof data.planRef, "string");
		assert.ok(data.planRef.length > 0);
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
});
