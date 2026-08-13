import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { promisify } from "node:util";
import { runGeneratedPackageConformance } from "@tomflow/proflow-deployment-conformance";
import {
	type ExecutionCapabilityResult,
	parseExecutionRecord,
} from "@tomflow/proflow-execution-contracts";
import {
	createLocalExecutor,
	type LocalExecutionResult,
} from "@tomflow/proflow-execution-local";
import {
	createExecutionRuntime,
	type ExecutionExecutorPort,
	ExecutionRuntimeError,
} from "../src/index.ts";

const exec = promisify(execFile);

function input(
	capability: string,
	capabilityInput: unknown,
	key: string,
	extras: Record<string, unknown> = {},
) {
	return {
		contract: "execution",
		contractVersion: "1.0.0",
		callerRef: "caller:test",
		idempotencyKey: key,
		capability,
		input: capabilityInput,
		...extras,
	};
}

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "proflow-execution-runtime-"));
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({ name: "fixture" }),
	);
	await exec("git", ["init", "-q"], { cwd: root });
	const local = await createLocalExecutor({
		projectRoot: root,
		artifactRoot: join(root, ".artifacts"),
	});
	return { root, databasePath: join(root, ".proflow", "execution.db"), local };
}

function readResult(content = "ok"): LocalExecutionResult {
	return {
		result: {
			capability: "file.read",
			data: {
				path: "value.txt",
				content,
				bytes: Buffer.byteLength(content),
				hash: "sha256:test",
			},
		},
		evidence: [],
		artifacts: [],
		effectApplied: false,
		successful: true,
	};
}

function fakeExecutor(
	run: (
		invocation: Parameters<ExecutionExecutorPort["execute"]>[0],
	) => Promise<LocalExecutionResult>,
): ExecutionExecutorPort {
	return {
		execute: run,
		reconcile: async () => ({ state: "NOT_APPLIED", evidence: [] }),
		readArtifact: async () => ({
			chunk: "",
			nextOffset: 0,
			eof: true,
			bytes: 0,
		}),
	};
}

test("CP-EXE-RT-01 durable lifecycle and idempotency fingerprint", async () => {
	const { databasePath, local } = await fixture();
	const runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: fakeExecutor(async () => readResult()),
	});
	const record = await runtime.executeCapability(
		input("file.read", { path: "value.txt" }, "state"),
	);
	assert.equal(record.status, "SUCCEEDED");
	assert.equal(record.sideEffectState, "NOT_APPLIED");
	assert.doesNotThrow(() => parseExecutionRecord(record));
	const database = new DatabaseSync(databasePath, { readOnly: true });
	assert.equal(
		database.prepare("PRAGMA journal_mode").get()?.journal_mode,
		"wal",
	);
	assert.equal(
		database.prepare("PRAGMA integrity_check").get()?.integrity_check,
		"ok",
	);
	database.close();
	runtime.close();
	void local;
});

test("idempotency companion: same request is one effect and changed input conflicts", async () => {
	const { databasePath } = await fixture();
	let effects = 0;
	const executor = fakeExecutor(async () => {
		effects += 1;
		return readResult();
	});
	const runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: executor,
	});
	const first = await runtime.executeCapability(
		input("file.read", { path: "value.txt" }, "idem"),
	);
	const second = await runtime.executeCapability(
		input("file.read", { path: "value.txt" }, "idem"),
	);
	assert.equal(first.executionRef, second.executionRef);
	assert.equal(effects, 1);
	await assert.rejects(
		() =>
			runtime.executeCapability(
				input("file.read", { path: "other.txt" }, "idem"),
			),
		(error) =>
			error instanceof ExecutionRuntimeError &&
			error.code === "IDEMPOTENCY_CONFLICT",
	);
	assert.equal(effects, 1);
	runtime.close();
});

test("CP-EXE-RT-02 deterministic deny precedes model and approval cannot be overridden", async () => {
	const { databasePath } = await fixture();
	let modelCalls = 0;
	let executorCalls = 0;
	const runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: fakeExecutor(async () => {
			executorCalls += 1;
			return readResult();
		}),
		policy: {
			decide: (request) =>
				request.idempotencyKey === "hard-deny"
					? { decision: "DENY", decisionPath: "deterministic" }
					: {
							decision: "REVIEW",
							decisionPath: "reason",
							approvalRequired: true,
						},
		},
		modelDecision: {
			decide: async () => {
				modelCalls += 1;
				return { decision: "ALLOW", decisionPath: "reason" };
			},
		},
		approval: { validate: () => false },
	});
	assert.equal(
		(
			await runtime.executeCapability(
				input("file.read", { path: "x" }, "hard-deny"),
			)
		).error?.code,
		"POLICY_DENIED",
	);
	assert.equal(modelCalls, 0);
	assert.equal(
		(
			await runtime.executeCapability(
				input("file.read", { path: "x" }, "approval", {
					approvalRef: "approval:bad",
				}),
			)
		).error?.code,
		"APPROVAL_INVALID",
	);
	assert.equal(modelCalls, 1);
	assert.equal(executorCalls, 0);
	runtime.close();
});

test("CP-EXE-RT-03 persist STARTED then reconcile a real lost response without replay", async () => {
	const { root, databasePath, local } = await fixture();
	let effects = 0;
	let lastResult: LocalExecutionResult | undefined;
	const wrapper: ExecutionExecutorPort = {
		async execute(invocation) {
			effects += 1;
			lastResult = await local.execute(invocation);
			throw new Error("transport response lost");
		},
		async reconcile(request, precondition) {
			const reality = await local.reconcile(request, precondition);
			return {
				...reality,
				...(reality.state === "APPLIED" && lastResult
					? { result: lastResult.result }
					: {}),
			};
		},
		readArtifact: local.readArtifact,
	};
	const runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: wrapper,
	});
	const record = await runtime.executeCapability(
		input("file.write", { path: "real.txt", content: "once" }, "lost", {
			projectRoot: root,
		}),
	);
	assert.equal(record.status, "SUCCEEDED");
	assert.equal(record.sideEffectState, "APPLIED");
	assert.equal(await readFile(join(root, "real.txt"), "utf8"), "once");
	assert.equal(effects, 1);
	assert.equal(
		(
			await runtime.executeCapability(
				input("file.write", { path: "real.txt", content: "once" }, "lost", {
					projectRoot: root,
				}),
			)
		).executionRef,
		record.executionRef,
	);
	assert.equal(effects, 1);
	runtime.close();
});

test("CP-EXE-RT-04 persisted UNKNOWN later converges through its reality verifier", async () => {
	const { databasePath } = await fixture();
	let verifierState: "UNKNOWN" | "APPLIED" = "UNKNOWN";
	let result: ExecutionCapabilityResult | undefined;
	const executor: ExecutionExecutorPort = {
		async execute(invocation) {
			await invocation.onEffectStarted?.({
				kind: "opaque",
				capability: "file.write",
			});
			throw new Error("lost response");
		},
		async reconcile() {
			return verifierState === "UNKNOWN"
				? { state: "UNKNOWN", evidence: [] }
				: { state: "APPLIED", evidence: [], ...(result ? { result } : {}) };
		},
		readArtifact: async () => ({
			chunk: "",
			nextOffset: 0,
			eof: true,
			bytes: 0,
		}),
	};
	const runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: executor,
	});
	const unknown = await runtime.executeCapability(
		input("file.write", { path: "unknown.txt", content: "once" }, "unknown"),
	);
	assert.equal(unknown.status, "UNKNOWN");
	assert.equal(unknown.sideEffectState, "UNKNOWN");
	result = {
		capability: "file.write",
		data: { path: "unknown.txt", afterHash: "sha256:applied", bytes: 4 },
	};
	verifierState = "APPLIED";
	await runtime.recoverIncomplete();
	assert.equal(
		runtime.getExecution(unknown.executionRef as never).status,
		"SUCCEEDED",
	);
	runtime.close();
});

test("CP-EXE-RT-05 output evidence pagination and persisted secret redaction", async () => {
	const { root, databasePath } = await fixture();
	const local = await createLocalExecutor({
		projectRoot: root,
		artifactRoot: join(root, ".artifacts"),
		baseEnv: { API_SECRET_TOKEN: "do-not-persist" },
	});
	const runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: local,
	});
	const record = await runtime.executeCapability(
		input(
			"process.start",
			{
				mode: "one-shot",
				command: process.execPath,
				args: [
					"-e",
					"console.log(process.env.API_SECRET_TOKEN);console.log('abcdefgh')",
				],
			},
			"output",
			{
				projectRoot: root,
				correlationId: "correlation:output-proof",
				taskId: "task:output-proof",
				nodeId: "node:output-proof",
				runNo: 1,
				roleRef: "role:executor",
				workerRef: "worker:executor",
			},
		),
	);
	assert.equal(record.status, "SUCCEEDED");
	assert.ok(record.evidenceRefs && record.evidenceRefs.length > 0);
	const page = await runtime.readExecutionOutput({
		contract: "execution",
		contractVersion: "1.0.0",
		executionRef: record.executionRef,
		stream: "stdout",
		offset: 0,
		limit: 5,
	});
	assert.equal(page.chunk.length, 5);
	assert.equal(page.nextOffset, 5);
	assert.equal(page.eof, false);
	assert.equal(page.chunk.includes("do-not-persist"), false);
	const databaseBytes = await readFile(databasePath);
	assert.equal(databaseBytes.includes(Buffer.from("do-not-persist")), false);
	const logs = await readFile(runtime.logPath, "utf8");
	assert.equal(logs.includes("do-not-persist"), false);
	for (const field of [
		"executionRef",
		"correlationId",
		"taskId",
		"nodeId",
		"runNo",
		"roleRef",
		"workerRef",
		"capability",
		"component",
		"phase",
		"event",
	])
		assert.ok(logs.includes(`"${field}"`), field);
	runtime.close();
});

test("CP-EXE-RT-07 queue concurrency, cancellation signal and restart do not blind replay", async () => {
	const { databasePath } = await fixture();
	let active = 0;
	let peak = 0;
	let effects = 0;
	const executor = fakeExecutor(async (invocation) => {
		effects += 1;
		active += 1;
		peak = Math.max(peak, active);
		await new Promise<void>((resolveWait, rejectWait) => {
			let finished = false;
			const finish = (action: () => void) => {
				if (finished) return;
				finished = true;
				active -= 1;
				action();
			};
			const timer = setTimeout(() => finish(resolveWait), 80);
			invocation.signal?.addEventListener(
				"abort",
				() => {
					clearTimeout(timer);
					finish(() =>
						rejectWait(new ExecutionRuntimeError("CANCELLED", "cancelled")),
					);
				},
				{ once: true },
			);
		});
		return readResult();
	});
	const runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: executor,
		maxConcurrent: 1,
		maxQueued: 1,
		idFactory: (() => {
			let id = 0;
			return () => String(++id);
		})(),
	});
	const first = runtime.executeCapability(
		input("file.read", { path: "a" }, "a"),
	);
	const second = runtime.executeCapability(
		input("file.read", { path: "b" }, "b"),
	);
	const queueFull = runtime.executeCapability(
		input("file.read", { path: "full" }, "full"),
	);
	const [, , rejected] = await Promise.all([first, second, queueFull]);
	assert.equal(peak, 1);
	assert.equal(effects, 2);
	assert.equal(rejected.error?.code, "EXECUTOR_UNAVAILABLE");
	const timedOut = await runtime.executeCapability(
		input("file.read", { path: "timeout" }, "timeout", { timeoutMs: 20 }),
	);
	assert.equal(timedOut.error?.code, "TIMEOUT");
	const lateFixture = await fixture();
	const ignoresAlreadyAbortedSignal = fakeExecutor(async () => {
		await new Promise((resolveWait) => setTimeout(resolveWait, 40));
		return readResult("late");
	});
	const lateRuntime = await createExecutionRuntime({
		databasePath: lateFixture.databasePath,
		localExecutor: ignoresAlreadyAbortedSignal,
	});
	const lateResult = await lateRuntime.executeCapability(
		input("file.read", { path: "late" }, "late", { timeoutMs: 5 }),
	);
	assert.equal(lateResult.error?.code, "TIMEOUT");
	lateRuntime.close();
	const cancellable = runtime.executeCapability(
		input("file.read", { path: "c" }, "c", {
			executionRef: "execution:cancel",
		}),
	);
	await new Promise((resolveWait) => setTimeout(resolveWait, 10));
	runtime.cancelExecution({
		contract: "execution",
		contractVersion: "1.0.0",
		executionRef: "execution:cancel",
		callerRef: "caller:test",
		reason: "test",
	});
	assert.equal((await cancellable).error?.code, "CANCELLED");
	runtime.close();
	const beforeRestart = effects;
	const restarted = await createExecutionRuntime({
		databasePath,
		localExecutor: executor,
		maxConcurrent: 1,
	});
	assert.equal(effects, beforeRestart);
	restarted.close();
});

test("CP-EXE-RT-06 injected browser executor uses the same durable admission and record path", async () => {
	const { databasePath } = await fixture();
	let browserCalls = 0;
	const browser = fakeExecutor(async () => {
		browserCalls += 1;
		return {
			result: {
				capability: "browser.observe",
				data: {
					targetRef: "target:1",
					verified: true,
					observationRef: "observation:1",
				},
			} as ExecutionCapabilityResult,
			evidence: [],
			artifacts: [],
			effectApplied: false,
			successful: true,
		};
	});
	const runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: fakeExecutor(async () => readResult()),
		browserExecutor: browser,
	});
	const record = await runtime.executeCapability(
		input("browser.observe", { targetRef: "target:1" }, "browser"),
	);
	assert.equal(record.status, "SUCCEEDED");
	assert.equal(record.result?.capability, "browser.observe");
	assert.equal(browserCalls, 1);
	assert.equal(
		runtime.getExecution(record.executionRef as never).executionRef,
		record.executionRef,
	);
	runtime.close();
});

test("Execution Wave 3 modules each pass Foundation C1/C2/C3", async () => {
	const packagesRoot = join(import.meta.dirname, "..", "..");
	for (const name of [
		"execution-contracts",
		"execution-local",
		"execution-runtime",
	]) {
		const results = await runGeneratedPackageConformance(
			join(packagesRoot, name),
		);
		assert.deepEqual(
			results.map((result) => result.status),
			["PASS", "PASS", "PASS"],
			JSON.stringify({ name, results }),
		);
	}
});
