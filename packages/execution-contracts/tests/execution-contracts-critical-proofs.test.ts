import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import * as contracts from "../src/index.ts";

test("CP-EXE-CON-01 public API types and runtime schemas stay aligned", () => {
	assert.equal(
		typeof Reflect.get(contracts, "parseExecuteCapabilityRequest"),
		"function",
	);
	assert.equal(
		typeof Reflect.get(contracts, "parseExecutionRecord"),
		"function",
	);
	assert.equal(
		typeof Reflect.get(contracts, "parseReadExecutionOutputRequest"),
		"function",
	);
	assert.equal(Reflect.get(contracts, "parseGetExecutionRequest"), undefined);
	assert.equal(
		contracts.EXECUTION_CONTRACT_DESCRIPTOR.publicTypes.includes(
			"GetExecutionRequest",
		),
		false,
	);
	assert.deepEqual(
		contracts.parseReadExecutionOutputRequest({
			contract: "execution",
			contractVersion: "1.0.0",
			executionRef: "execution:contract-read",
			stream: "stdout",
		}),
		{
			contract: "execution",
			contractVersion: "1.0.0",
			executionRef: "execution:contract-read",
			stream: "stdout",
		},
	);
	assert.throws(() =>
		contracts.parseReadExecutionOutputRequest({
			contract: "execution",
			contractVersion: "1.0.0",
			executionRef: "execution:contract-read",
			callerRef: "role:must-not-be-public-dto",
			stream: "stdout",
		}),
	);
	assert.equal(
		typeof Reflect.get(contracts, "parseCancelExecutionRequest"),
		"function",
	);
	assert.equal(
		contracts.parseExecuteCapabilityRequest({
			contract: "execution",
			contractVersion: "1.0.0",
			callerRef: "caller:test",
			idempotencyKey: "valid",
			capability: "file.write",
			input: { path: "README.md", content: "typed" },
		}).capability,
		"file.write",
	);
	assert.equal(
		contracts.parseCapabilityResult({
			capability: "file.write",
			data: { path: "README.md", afterHash: "sha256:value", bytes: 5 },
		}).capability,
		"file.write",
	);
});

test("CP-EXE-CON-02 illegal ExecutionStatus and SideEffectState combinations reject", () => {
	const parse = Reflect.get(contracts, "parseExecutionRecord");
	assert.equal(typeof parse, "function");
	assert.throws(() =>
		parse({
			contract: "execution",
			contractVersion: "1.0.0",
			executionRef: "execution:invalid",
			capability: "file.write",
			callerRef: "caller:test",
			idempotencyKey: "invalid-state",
			inputFingerprint: "sha256:invalid",
			status: "SUCCEEDED",
			sideEffectState: "UNKNOWN",
			retryable: false,
			attemptCount: 1,
			evidence: [],
			createdAt: "2026-08-13T00:00:00.000Z",
			updatedAt: "2026-08-13T00:00:00.000Z",
		}),
	);
	const legal = new Set([
		"PENDING:NOT_STARTED",
		"RUNNING:NOT_STARTED",
		"RUNNING:STARTED",
		"SUCCEEDED:APPLIED",
		"SUCCEEDED:NOT_APPLIED",
		"FAILED:NOT_APPLIED",
		"UNKNOWN:UNKNOWN",
	]);
	for (const status of contracts.executionStatuses) {
		for (const sideEffectState of contracts.sideEffectStates) {
			const pair = `${status}:${sideEffectState}`;
			const candidate = {
				contract: "execution",
				contractVersion: "1.0.0",
				executionRef: `execution:${pair}`,
				capability: "file.read",
				callerRef: "caller:test",
				idempotencyKey: pair,
				inputFingerprint: "sha256:test",
				status,
				sideEffectState,
				retryable: false,
				...(status === "SUCCEEDED"
					? {
							result: {
								capability: "file.read",
								data: {
									path: "README.md",
									content: "",
									bytes: 0,
									hash: "sha256:test",
								},
							},
						}
					: {}),
				...(status === "FAILED"
					? {
							error: {
								code: "EXECUTION_FAILED",
								message: "failed",
								retryable: false,
							},
						}
					: {}),
				...(status === "UNKNOWN"
					? {
							error: {
								code: "UNKNOWN_SIDE_EFFECT",
								message: "unknown",
								retryable: false,
							},
						}
					: {}),
				evidence: [],
				attemptCount: 1,
				createdAt: "2026-08-13T00:00:00.000Z",
				updatedAt: "2026-08-13T00:00:00.000Z",
			};
			if (legal.has(pair))
				assert.doesNotThrow(() => contracts.parseExecutionRecord(candidate));
			else assert.throws(() => contracts.parseExecutionRecord(candidate));
		}
	}
});

test("CP-EXE-CON-03 every external boundary validates unknown and public source has zero any", async () => {
	const parse = Reflect.get(contracts, "parseExecuteCapabilityRequest");
	assert.equal(typeof parse, "function");
	assert.throws(() =>
		parse({
			contract: "execution",
			contractVersion: "1.0.0",
			callerRef: "caller:test",
			idempotencyKey: "typed-boundary",
			capability: "file.write",
			input: { path: "README.md", unexpected: true },
		}),
	);
	const source = await readFile(
		new URL("../src/index.ts", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(source, /\bany\b/);
});

test("CP-EXE-CON-04 compatibility rejects an intentional breaking provider", () => {
	const descriptor = Reflect.get(contracts, "EXECUTION_CONTRACT_DESCRIPTOR");
	const check = Reflect.get(contracts, "checkExecutionContractCompatibility");
	assert.equal(typeof check, "function");
	assert.ok(descriptor);
	const broken = {
		...structuredClone(descriptor),
		publicApi: ["executeCapability"],
	};
	const result = check(descriptor, broken);
	assert.equal(result.status, "FAIL");
	assert.ok(result.missing.includes("publicApi:getExecution"));
});
