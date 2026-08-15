import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
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
import { createLocalExecutorPort } from "../src/executors/local-adapter.ts";
import {
	createExecutionRuntime,
	type ExecutionExecutorPort,
	ExecutionRuntimeError,
	type ExecutorResult,
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
	const local = await createLocalExecutorPort({
		projectRoot: root,
		artifactRoot: join(root, ".artifacts"),
	});
	return { root, databasePath: join(root, ".proflow", "execution.db"), local };
}

function readResult(content = "ok"): ExecutorResult {
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
	) => Promise<ExecutorResult>,
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

test("carry-forward policy protects process and browser mutation and revalidates approval immediately before effect", async () => {
	const { databasePath } = await fixture();
	let effects = 0;
	let approvalChecks = 0;
	const runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: fakeExecutor(async () => {
			effects += 1;
			return readResult();
		}),
		modelDecision: {
			decide: async () => ({
				decision: "ALLOW",
				decisionPath: "reason",
				approvalRequired: true,
			}),
		},
		approval: {
			validate(value) {
				approvalChecks += 1;
				assert.equal(value.request.callerRef, "caller:test");
				return approvalChecks === 1;
			},
		},
	});
	const result = await runtime.executeCapability(
		input(
			"process.start",
			{ mode: "one-shot", command: process.execPath, args: ["-e", ""] },
			"approval-revalidation",
			{ approvalRef: "approval:expires-before-effect" },
		),
	);
	assert.equal(result.error?.code, "APPROVAL_INVALID");
	assert.equal(approvalChecks, 2);
	assert.equal(effects, 0);
	runtime.close();
});

test("carry-forward unsuccessful executor result never becomes SUCCEEDED", async () => {
	const { databasePath } = await fixture();
	const runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: fakeExecutor(async () => ({
			...readResult(),
			successful: false,
			effectApplied: false,
		})),
	});
	const record = await runtime.executeCapability(
		input("file.read", { path: "missing" }, "unsuccessful"),
	);
	assert.equal(record.status, "FAILED");
	assert.equal(record.sideEffectState, "NOT_APPLIED");
	assert.equal(record.error?.code, "EXECUTION_FAILED");
	runtime.close();
});

test("foreign library error codes cannot escape the frozen Execution error vocabulary", async () => {
	const { databasePath } = await fixture();
	const runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: fakeExecutor(async () => {
			throw Object.assign(new Error("foreign assertion failed"), {
				code: "ERR_ASSERTION",
			});
		}),
	});
	const record = await runtime.executeCapability(
		input("file.read", { path: "missing" }, "foreign-error-code"),
	);
	assert.equal(record.status, "FAILED");
	assert.equal(record.error?.code, "EXECUTION_FAILED");
	runtime.close();
});

test("carry-forward NOT_APPLIED failure can be explicitly redecided under the same execution", async () => {
	const { databasePath } = await fixture();
	let approvalValid = false;
	let effects = 0;
	const runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: fakeExecutor(async () => {
			effects += 1;
			return readResult();
		}),
		policy: {
			decide: () => ({
				decision: "ALLOW",
				decisionPath: "reason",
				approvalRequired: true,
			}),
		},
		approval: { validate: () => approvalValid },
	});
	const request = input("file.read", { path: "retry" }, "safe-redecision", {
		approvalRef: "approval:same",
	});
	const rejected = await runtime.executeCapability(request);
	assert.equal(rejected.status, "FAILED");
	assert.equal(rejected.sideEffectState, "NOT_APPLIED");
	approvalValid = true;
	const resumed = await runtime.executeCapability(request);
	assert.equal(resumed.executionRef, rejected.executionRef);
	assert.equal(resumed.status, "SUCCEEDED");
	assert.equal(resumed.attemptCount, 1);
	assert.equal(effects, 1);
	runtime.close();
});

test("carry-forward PENDING restart remains safely resumable under the same execution identity", async () => {
	const { databasePath } = await fixture();
	const first = await createExecutionRuntime({
		databasePath,
		localExecutor: fakeExecutor(async () => readResult()),
	});
	const database = new DatabaseSync(databasePath);
	const request = input("file.read", { path: "resume" }, "pending-restart", {
		executionRef: "execution:pending-restart",
		taskId: "task:resume",
		nodeId: "node:resume",
		workerRef: "worker:resume",
	});
	const createdAt = new Date().toISOString();
	const pending = parseExecutionRecord({
		contract: "execution",
		contractVersion: "1.0.0",
		executionRef: "execution:pending-restart",
		capability: "file.read",
		callerRef: "caller:test",
		idempotencyKey: "pending-restart",
		inputFingerprint: "placeholder",
		taskId: "task:resume",
		nodeId: "node:resume",
		workerRef: "worker:resume",
		status: "PENDING",
		sideEffectState: "NOT_STARTED",
		retryable: false,
		evidence: [],
		attemptCount: 0,
		createdAt,
		updatedAt: createdAt,
	});
	const existing = database
		.prepare("SELECT input_fingerprint FROM executions LIMIT 1")
		.get() as { input_fingerprint?: string } | undefined;
	void existing;
	database
		.prepare("INSERT INTO executions VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)")
		.run(
			pending.executionRef,
			pending.callerRef,
			pending.capability,
			pending.idempotencyKey,
			"placeholder",
			JSON.stringify(request),
			JSON.stringify(pending),
			createdAt,
		);
	database.close();
	first.close();
	const restarted = await createExecutionRuntime({
		databasePath,
		localExecutor: fakeExecutor(async () => readResult("resumed")),
	});
	const recovered = restarted.getExecution("execution:pending-restart");
	assert.equal(recovered.status, "PENDING");
	assert.equal(recovered.sideEffectState, "NOT_STARTED");
	const signals = restarted.listExecutionObserverSignals();
	assert.equal(signals.length, 1);
	assert.equal(signals[0]?.kind, "RECOVERY_RESUME");
	assert.equal(signals[0]?.executionRef, "execution:pending-restart");
	assert.equal(signals[0]?.taskId, pending.taskId);
	assert.equal(signals[0]?.workerRef, pending.workerRef);
	assert.equal(
		restarted.acknowledgeExecutionObserverSignal(
			signals[0]?.signalRef ?? "missing",
		).acknowledged,
		true,
	);
	assert.deepEqual(restarted.listExecutionObserverSignals(), []);
	restarted.close();

	const reopenedAgain = await createExecutionRuntime({
		databasePath,
		localExecutor: fakeExecutor(async () => readResult("resumed")),
	});
	assert.deepEqual(
		reopenedAgain.listExecutionObserverSignals(),
		[],
		"acknowledged deterministic recovery signal must not reappear after another restart",
	);
	reopenedAgain.close();
});

test("CP-EXE-RT-03 persist STARTED then reconcile a real lost response without replay", async () => {
	const { root, databasePath, local } = await fixture();
	let effects = 0;
	const wrapper: ExecutionExecutorPort = {
		async execute(invocation) {
			effects += 1;
			await local.execute(invocation);
			throw new Error("transport response lost");
		},
		async reconcile(request, precondition) {
			return local.reconcile(request, precondition);
		},
		readArtifact: local.readArtifact,
	};
	const runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: wrapper,
		modelDecision: {
			decide: async () => ({ decision: "ALLOW", decisionPath: "fast" }),
		},
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
		modelDecision: {
			decide: async () => ({ decision: "ALLOW", decisionPath: "fast" }),
		},
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
	assert.equal(runtime.getExecution(unknown.executionRef).status, "SUCCEEDED");
	runtime.close();
});

test("CP-EXE-RT-05 output evidence pagination and persisted secret redaction", async () => {
	const { root, databasePath } = await fixture();
	await writeFile(
		join(root, "output-proof.mjs"),
		"console.log(process.env.API_SECRET_TOKEN);console.log('abcdefgh');\n",
	);
	const local = await createLocalExecutorPort({
		projectRoot: root,
		artifactRoot: join(root, ".artifacts"),
		baseEnv: { API_SECRET_TOKEN: "do-not-persist" },
	});
	const runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: local,
		policy: {
			decide: () => ({
				decision: "ALLOW",
				decisionPath: "deterministic",
				approvalRequired: false,
			}),
		},
	});
	const record = await runtime.executeCapability(
		input(
			"process.start",
			{
				mode: "one-shot",
				command: process.execPath,
				args: ["output-proof.mjs"],
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
	await assert.rejects(
		runtime.readExecutionOutputForCaller(
			{
				contract: "execution",
				contractVersion: "1.0.0",
				executionRef: record.executionRef,
				stream: "stdout",
				offset: 0,
				limit: 5,
			},
			"role:other",
		),
		/only the bound caller may read execution/,
	);
	assert.throws(
		() =>
			runtime.getExecutionForCaller({
				executionRef: record.executionRef,
				callerRef: "role:other",
			}),
		/only the bound caller may read execution/,
	);
	const page = await runtime.readExecutionOutputForCaller(
		{
			contract: "execution",
			contractVersion: "1.0.0",
			executionRef: record.executionRef,
			stream: "stdout",
			offset: 0,
			limit: 5,
		},
		"caller:test",
	);
	assert.equal(page.chunk.length, 5);
	assert.equal(page.nextOffset, 5);
	assert.equal(page.eof, false);
	assert.ok(page.artifactRef.startsWith("output:"));
	assert.equal("evidenceRef" in page, false);
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

test("B1-EXE-05 argv, header, body and managed-registry secrets never persist at rest", async () => {
	const { root, databasePath } = await fixture();
	const secret = "UNIQUE-B1-EXE-05-9c41";
	await writeFile(
		join(root, "argv.mjs"),
		"console.log(process.argv.slice(2).join(' '));console.error(process.env.API_SECRET_TOKEN);\n",
	);
	await writeFile(
		join(root, "hold.mjs"),
		"console.log(process.argv.slice(2).join(' '));setInterval(()=>{},1000);\n",
	);
	const local = await createLocalExecutorPort({
		projectRoot: root,
		artifactRoot: join(root, ".artifacts"),
		baseEnv: { API_SECRET_TOKEN: secret },
	});
	const runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: local,
		policy: {
			decide: () => ({
				decision: "ALLOW",
				decisionPath: "fast",
				approvalRequired: false,
			}),
		},
	});

	// argv positional secret through a one-shot process (stdout + stderr echo).
	// The script path precedes the secret-bearing flag so `node` actually runs
	// the fixture (a leading unknown flag would make node reject the command).
	await runtime.executeCapability(
		input(
			"process.start",
			{
				mode: "one-shot",
				command: process.execPath,
				args: ["argv.mjs", "--token", secret],
			},
			"argv",
			{ projectRoot: root },
		),
	);

	// managed process: argv secret must not reach managed-processes.json.
	const managed = await runtime.executeCapability(
		input(
			"process.start",
			{
				mode: "managed",
				command: process.execPath,
				args: ["hold.mjs", "--token", secret],
			},
			"managed",
			{ projectRoot: root },
		),
	);

	// request-side redaction: Authorization header + JSON body secret.
	const server = createServer((_req, res) => {
		res.setHeader("content-type", "text/plain");
		res.end("ok");
	});
	await new Promise<void>((resolveListen) =>
		server.listen(0, "127.0.0.1", resolveListen),
	);
	const address = server.address();
	assert.ok(address && typeof address === "object");
	await runtime.executeCapability(
		input(
			"network.request",
			{
				url: `http://127.0.0.1:${address.port}/`,
				method: "POST",
				headers: { Authorization: `Bearer ${secret}` },
				body: JSON.stringify({ password: secret }),
			},
			"network",
			{ projectRoot: root },
		),
	);
	server.close();

	if (
		managed.result?.capability === "process.start" &&
		managed.result.data.mode === "managed"
	)
		await runtime.executeCapability(
			input(
				"process.stop",
				{ processRef: managed.result.data.processRef },
				"managed-stop",
				{ projectRoot: root },
			),
		);
	runtime.close();

	const databaseBytes = await readFile(databasePath);
	assert.equal(databaseBytes.includes(Buffer.from(secret)), false);
	const registry = await readFile(
		join(root, ".artifacts", "managed-processes.json"),
		"utf8",
	);
	assert.equal(registry.includes(secret), false);
	assert.equal(registry.includes("--token"), false);
	const logs = await readFile(runtime.logPath, "utf8");
	assert.equal(logs.includes(secret), false);
	for (const entry of await readdir(join(root, ".artifacts")))
		if (entry.endsWith(".log")) {
			const content = await readFile(join(root, ".artifacts", entry), "utf8");
			assert.equal(content.includes(secret), false, entry);
		}
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
	const records = await Promise.all([first, second, queueFull]);
	assert.equal(peak, 1);
	assert.equal(effects, 2);
	assert.deepEqual(
		records.map((record) => record.error?.code).sort(),
		[undefined, undefined, "EXECUTOR_UNAVAILABLE"].sort(),
	);
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
		runtime.getExecution(record.executionRef).executionRef,
		record.executionRef,
	);
	runtime.close();
});

test("B1-EXE-01 default policy routes ordinary mutations through FAST and read-only through deterministic", async () => {
	const { root, databasePath } = await fixture();
	let fastCalls = 0;
	const runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: fakeExecutor(async () => readResult()),
		modelDecision: {
			async decide() {
				fastCalls += 1;
				return { decision: "ALLOW", decisionPath: "fast" };
			},
		},
	});
	const mutation = await runtime.executeCapability(
		input("file.write", { path: "a.txt", content: "x" }, "fast-mut", {
			projectRoot: root,
		}),
	);
	assert.equal(mutation.decisionPath, "fast");
	const commit = await runtime.executeCapability(
		input(
			"git.commit",
			{ message: "chore: seed", paths: ["."] },
			"fast-commit",
			{ projectRoot: root },
		),
	);
	assert.equal(commit.decisionPath, "fast");
	assert.equal(fastCalls, 2);
	const read = await runtime.executeCapability(
		input("file.read", { path: "a.txt" }, "det-read", { projectRoot: root }),
	);
	assert.equal(read.decisionPath, "deterministic");
	assert.equal(fastCalls, 2);
	runtime.close();
});

test("B1-EXE-12 approval revalidates against the concrete effect-boundary precondition", async () => {
	const { databasePath } = await fixture();
	let checks = 0;
	let boundPrecondition: unknown;
	let boundExecutionRef: string | undefined;
	const runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: fakeExecutor(async (invocation) => {
			await invocation.onEffectStarted?.({
				kind: "process.start",
				capability: "process.start",
				processRef: "process:x",
				mode: "one-shot",
			});
			return {
				result: {
					capability: "process.start",
					data: {
						mode: "one-shot",
						output: {
							exitCode: 0,
							durationMs: 1,
							stdoutSummary: "",
							stderrSummary: "",
							stdoutRef: "output:x:stdout",
							stderrRef: "output:x:stderr",
						},
					},
				},
				evidence: [],
				artifacts: [],
				effectApplied: false,
				successful: true,
			};
		}),
		modelDecision: {
			decide: async () => ({
				decision: "ALLOW",
				decisionPath: "reason",
				approvalRequired: true,
			}),
		},
		approval: {
			validate(value) {
				checks += 1;
				boundExecutionRef = value.executionRef;
				if (value.precondition) boundPrecondition = value.precondition;
				return true;
			},
		},
	});
	const record = await runtime.executeCapability(
		input(
			"process.start",
			{ mode: "one-shot", command: process.execPath, args: ["-e", ""] },
			"approval-bind",
			{ approvalRef: "approval:bind" },
		),
	);
	assert.equal(record.status, "SUCCEEDED");
	assert.equal(boundExecutionRef, record.executionRef);
	assert.equal(checks, 3);
	assert.deepEqual(boundPrecondition, {
		kind: "process.start",
		capability: "process.start",
		processRef: "process:x",
		mode: "one-shot",
	});
	runtime.close();
});

test("B1-EXE-11 cancel racing the RUNNING transition never runs the executor", async () => {
	const { databasePath } = await fixture();
	let effects = 0;
	let checks = 0;
	let releaseSecond: (value: boolean) => void = () => {};
	const secondCheck = new Promise<boolean>((resolveWait) => {
		releaseSecond = resolveWait;
	});
	const runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: fakeExecutor(async () => {
			effects += 1;
			return readResult();
		}),
		modelDecision: {
			decide: async () => ({
				decision: "ALLOW",
				decisionPath: "reason",
				approvalRequired: true,
			}),
		},
		approval: {
			validate() {
				checks += 1;
				return checks === 2 ? secondCheck : true;
			},
		},
	});
	const execution = runtime.executeCapability(
		input(
			"process.start",
			{ mode: "one-shot", command: process.execPath, args: ["-e", ""] },
			"cas-cancel",
			{ approvalRef: "approval:cas", executionRef: "execution:cas" },
		),
	);
	await new Promise((resolveWait) => setTimeout(resolveWait, 20));
	const cancelled = await runtime.cancelExecution({
		contract: "execution",
		contractVersion: "1.0.0",
		executionRef: "execution:cas",
		callerRef: "caller:test",
		reason: "test",
	});
	assert.equal(cancelled.error?.code, "CANCELLED");
	releaseSecond(true);
	const record = await execution;
	assert.equal(record.error?.code, "CANCELLED");
	assert.equal(effects, 0);
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

test("PRESMOKE-B4-LOOKUP-01 uncertain lookup resolves durable intent without replay or executionRef", async () => {
	const { root, databasePath } = await fixture();
	let calls = 0;
	const runtime = await createExecutionRuntime({
		databasePath,
		localExecutor: fakeExecutor(async () => {
			calls += 1;
			return readResult("lookup-once");
		}),
	});
	const request = input("file.read", { path: "package.json" }, "lookup", {
		projectRoot: root,
	});
	const created = await runtime.executeCapability(request);
	const recovered = runtime.lookupExecutionIntent(request);
	assert.equal(recovered.executionRef, created.executionRef);
	assert.equal(calls, 1);
	assert.throws(
		() =>
			runtime.lookupExecutionIntent({
				...request,
				input: { path: "other.json" },
			}),
		/lookup input does not match durable input/,
	);
	runtime.close();
});
