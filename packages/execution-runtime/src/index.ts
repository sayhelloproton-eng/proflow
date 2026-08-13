import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
	browserCapabilityIds,
	EXECUTION_CONTRACT_VERSION,
	type ExecuteCapabilityRequest,
	type ExecutionCapabilityResult,
	type ExecutionErrorCode,
	type ExecutionRecord,
	type ExecutionRef,
	parseCancelExecutionRequest,
	parseExecuteCapabilityRequest,
	parseExecutionRecord,
	parseExecutionRef,
	parseReadExecutionOutputRequest,
	type ReadExecutionOutputResponse,
} from "@tomflow/proflow-execution-contracts";
import type {
	LocalExecutionResult,
	LocalExecutorInvocation,
	LocalPrecondition,
	LocalReconciliation,
} from "@tomflow/proflow-execution-local";

export const moduleRef = "execution-runtime" as const;

type MaybePromise<Value> = Value | Promise<Value>;
type AdmissionDecision = {
	decision: "ALLOW" | "DENY" | "REVIEW";
	decisionPath: "deterministic" | "fast" | "reason";
	approvalRequired?: boolean;
	reason?: string;
};

export interface ExecutionPolicyPort {
	decide(request: ExecuteCapabilityRequest): MaybePromise<AdmissionDecision>;
}
export interface ExecutionModelDecisionPort {
	decide(request: ExecuteCapabilityRequest): Promise<{
		decision: "ALLOW" | "DENY";
		decisionPath: "fast" | "reason";
		reason?: string;
	}>;
}
export interface ExecutionApprovalPort {
	validate(input: {
		approvalRef: string;
		callerRef: string;
		capability: string;
		inputFingerprint: string;
		request: ExecuteCapabilityRequest;
		projectRoot?: string;
		now: string;
	}): MaybePromise<boolean>;
}

export interface ExecutionIdentityPort {
	authorize(request: ExecuteCapabilityRequest): MaybePromise<boolean>;
}
export interface ExecutionExecutorPort {
	execute(invocation: LocalExecutorInvocation): Promise<LocalExecutionResult>;
	reconcile(
		request: ExecuteCapabilityRequest,
		precondition: LocalPrecondition,
	): Promise<LocalReconciliation & { result?: ExecutionCapabilityResult }>;
	readArtifact(
		ref: string,
		offset?: number,
		limit?: number,
	): Promise<{
		chunk: string;
		nextOffset: number;
		eof: boolean;
		bytes: number;
	}>;
}

export interface ExecutionRuntimeOptions {
	databasePath: string;
	localExecutor: ExecutionExecutorPort;
	browserExecutor?: ExecutionExecutorPort;
	policy?: ExecutionPolicyPort;
	modelDecision?: ExecutionModelDecisionPort;
	approval?: ExecutionApprovalPort;
	identity?: ExecutionIdentityPort;
	maxConcurrent?: number;
	maxQueued?: number;
	now?: () => Date;
	idFactory?: () => string;
}

export class ExecutionRuntimeError extends Error {
	readonly code: ExecutionErrorCode;
	readonly retryable: boolean;
	constructor(code: ExecutionErrorCode, message: string, retryable = false) {
		super(message);
		this.name = "ExecutionRuntimeError";
		this.code = code;
		this.retryable = retryable;
	}
}

type Row = Record<string, unknown>;
const sensitive =
	/(?:authorization|bearer|api[_-]?key|token|password|cookie|private[_-]?key|secret)/i;
const browserIds = new Set<string>(browserCapabilityIds);

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (typeof value !== "object" || value === null) return value;
	return Object.fromEntries(
		Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => [key, canonical(item)]),
	);
}
function sha(value: unknown): string {
	return `sha256:${createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex")}`;
}
function protectedValue(value: unknown, key = ""): unknown {
	if (sensitive.test(key)) return `[SECRET_REF:${sha(value)}]`;
	if (Array.isArray(value)) return value.map((item) => protectedValue(item));
	if (typeof value !== "object" || value === null) return value;
	return Object.fromEntries(
		Object.entries(value).map(([childKey, item]) => [
			childKey,
			protectedValue(item, childKey),
		]),
	);
}
function fingerprint(request: ExecuteCapabilityRequest): string {
	return sha({
		capability: request.capability,
		input: protectedValue(request.input),
		callerRef: request.callerRef,
		taskId: request.taskId,
		nodeId: request.nodeId,
		roleRef: request.roleRef,
		workerRef: request.workerRef,
		projectRoot: request.projectRoot,
	});
}
function runtimeError(error: unknown): ExecutionRuntimeError {
	if (error instanceof ExecutionRuntimeError) return error;
	if (typeof error === "object" && error !== null) {
		const code = Reflect.get(error, "code");
		const message = Reflect.get(error, "message");
		const retryable = Reflect.get(error, "retryable");
		if (typeof code === "string" && typeof message === "string")
			return new ExecutionRuntimeError(
				code as ExecutionErrorCode,
				message,
				retryable === true,
			);
	}
	return new ExecutionRuntimeError(
		"EXECUTION_FAILED",
		error instanceof Error ? error.message : "execution failed",
	);
}

const defaultPolicy: ExecutionPolicyPort = {
	decide(request) {
		if (
			request.capability === "git.push" ||
			request.capability === "project.installDependency" ||
			request.capability === "shell.run" ||
			request.capability === "process.start" ||
			request.capability === "process.stop" ||
			(request.capability === "network.request" &&
				request.input.method !== "GET" &&
				request.input.method !== "HEAD") ||
			request.capability === "browser.navigate" ||
			request.capability === "browser.input" ||
			request.capability === "browser.click" ||
			request.capability === "browser.upload" ||
			request.capability === "browser.submit" ||
			request.capability === "worker.create" ||
			request.capability === "worker.wake" ||
			request.capability === "collaboration.deliver"
		) {
			return {
				decision: "REVIEW",
				decisionPath: "reason",
				approvalRequired: true,
			};
		}
		return {
			decision: "ALLOW",
			decisionPath: "deterministic",
			approvalRequired: false,
		};
	},
};

class Semaphore {
	#available: number;
	readonly #maxQueued: number;
	#waiters: Array<() => void> = [];
	constructor(count: number, maxQueued: number) {
		this.#available = count;
		this.#maxQueued = maxQueued;
	}
	async acquire(): Promise<() => void> {
		if (this.#available > 0) this.#available -= 1;
		else {
			if (this.#waiters.length >= this.#maxQueued)
				throw new ExecutionRuntimeError(
					"EXECUTOR_UNAVAILABLE",
					"execution queue is full",
					true,
				);
			await new Promise<void>((resolveWait) => this.#waiters.push(resolveWait));
		}
		return () => {
			const next = this.#waiters.shift();
			if (next) next();
			else this.#available += 1;
		};
	}
}

export async function createExecutionRuntime(options: ExecutionRuntimeOptions) {
	await mkdir(dirname(options.databasePath), { recursive: true, mode: 0o700 });
	const database = new DatabaseSync(options.databasePath);
	database.exec(
		"PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2500;",
	);
	database.exec(`
		CREATE TABLE IF NOT EXISTS executions (
			execution_ref TEXT PRIMARY KEY, caller_ref TEXT NOT NULL, capability TEXT NOT NULL,
			idempotency_key TEXT NOT NULL, input_fingerprint TEXT NOT NULL, request_json TEXT NOT NULL,
			record_json TEXT NOT NULL, precondition_json TEXT, created_at TEXT NOT NULL,
			UNIQUE(caller_ref, capability, idempotency_key)
		);
		CREATE TABLE IF NOT EXISTS execution_artifacts (
			execution_ref TEXT NOT NULL, artifact_ref TEXT NOT NULL, stream TEXT NOT NULL, path TEXT NOT NULL,
			PRIMARY KEY(execution_ref, artifact_ref), FOREIGN KEY(execution_ref) REFERENCES executions(execution_ref)
		);
	`);
	const now = options.now ?? (() => new Date());
	const idFactory = options.idFactory ?? randomUUID;
	const semaphore = new Semaphore(
		Math.max(1, options.maxConcurrent ?? 4),
		Math.max(0, options.maxQueued ?? 100),
	);
	const controllers = new Map<string, AbortController>();
	const logPath = join(
		dirname(options.databasePath),
		"logs",
		"execution-runtime",
		"events.jsonl",
	);
	await mkdir(dirname(logPath), { recursive: true, mode: 0o700 });
	let closed = false;
	const log = async (
		record: ExecutionRecord,
		event: string,
		errorCode?: ExecutionErrorCode,
	) => {
		await appendFile(
			logPath,
			`${JSON.stringify({ timestamp: now().toISOString(), component: "execution-runtime", executionRef: record.executionRef, correlationId: record.correlationId, taskId: record.taskId, nodeId: record.nodeId, runNo: record.runNo, roleRef: record.roleRef, workerRef: record.workerRef, capability: record.capability, phase: record.status, event, ...(errorCode ? { errorCode } : {}) })}\n`,
			{ mode: 0o600 },
		);
	};

	const getRow = (executionRef: string): Row | undefined =>
		database
			.prepare("SELECT * FROM executions WHERE execution_ref=?")
			.get(executionRef) as Row | undefined;
	const fromRow = (row: Row): ExecutionRecord =>
		parseExecutionRecord(JSON.parse(String(row.record_json)));
	const save = (record: ExecutionRecord, precondition?: LocalPrecondition) => {
		database
			.prepare(
				"UPDATE executions SET record_json=?, precondition_json=COALESCE(?, precondition_json) WHERE execution_ref=?",
			)
			.run(
				JSON.stringify(record),
				precondition === undefined
					? null
					: JSON.stringify(protectedValue(precondition)),
				record.executionRef,
			);
	};
	const failRecord = (
		record: ExecutionRecord,
		error: ExecutionRuntimeError,
		sideEffectState: "NOT_APPLIED" | "UNKNOWN" = "NOT_APPLIED",
	): ExecutionRecord =>
		parseExecutionRecord({
			...record,
			status: sideEffectState === "UNKNOWN" ? "UNKNOWN" : "FAILED",
			sideEffectState,
			retryable: sideEffectState === "UNKNOWN" ? false : error.retryable,
			error: {
				code:
					sideEffectState === "UNKNOWN" ? "UNKNOWN_SIDE_EFFECT" : error.code,
				message: error.message,
				retryable: sideEffectState === "UNKNOWN" ? false : error.retryable,
			},
			finishedAt: now().toISOString(),
			updatedAt: now().toISOString(),
		});

	async function admit(
		request: ExecuteCapabilityRequest,
		inputFingerprint: string,
	) {
		if (options.identity && !(await options.identity.authorize(request)))
			throw new ExecutionRuntimeError(
				"IDENTITY_INVALID",
				"caller, Task, Agent, workspace, or Browser identity is not authoritative",
			);
		const policy = await (options.policy ?? defaultPolicy).decide(request);
		if (policy.decision === "DENY")
			throw new ExecutionRuntimeError(
				"POLICY_DENIED",
				policy.reason ?? "deterministic policy denied execution",
			);
		let decisionPath = policy.decisionPath;
		if (policy.decision === "REVIEW") {
			if (!options.modelDecision)
				throw new ExecutionRuntimeError(
					"DECISION_UNRESOLVED",
					"review requires a model decision",
				);
			const model = await options.modelDecision.decide(request);
			decisionPath = model.decisionPath;
			if (model.decision === "DENY")
				throw new ExecutionRuntimeError(
					"POLICY_DENIED",
					model.reason ?? "model decision denied execution",
				);
		}
		const validateApproval = async () => {
			if (!policy.approvalRequired) return;
			if (!request.approvalRef)
				throw new ExecutionRuntimeError(
					"APPROVAL_REQUIRED",
					"bound approval is required",
				);
			if (
				!options.approval ||
				!(await options.approval.validate({
					approvalRef: request.approvalRef,
					callerRef: request.callerRef,
					capability: request.capability,
					inputFingerprint,
					request,
					...(request.projectRoot ? { projectRoot: request.projectRoot } : {}),
					now: now().toISOString(),
				}))
			)
				throw new ExecutionRuntimeError(
					"APPROVAL_INVALID",
					"approval binding, expiry or status is invalid",
				);
		};
		await validateApproval();
		return {
			policy: "ALLOW" as const,
			decisionPath,
			approval: policy.approvalRequired
				? ("VALID" as const)
				: ("NOT_REQUIRED" as const),
			validateApproval,
		};
	}

	function createPending(
		request: ExecuteCapabilityRequest,
		inputFingerprint: string,
	): ExecutionRecord {
		const stamp = now().toISOString();
		return parseExecutionRecord({
			contract: "execution",
			contractVersion: EXECUTION_CONTRACT_VERSION,
			executionRef: request.executionRef ?? `execution:${idFactory()}`,
			capability: request.capability,
			callerRef: request.callerRef,
			...(request.correlationId
				? { correlationId: request.correlationId }
				: {}),
			...(request.taskId ? { taskId: request.taskId } : {}),
			...(request.nodeId ? { nodeId: request.nodeId } : {}),
			...(request.runNo ? { runNo: request.runNo } : {}),
			...(request.roleRef ? { roleRef: request.roleRef } : {}),
			...(request.workerRef ? { workerRef: request.workerRef } : {}),
			idempotencyKey: request.idempotencyKey,
			inputFingerprint,
			status: "PENDING",
			sideEffectState: "NOT_STARTED",
			retryable: false,
			evidence: [],
			attemptCount: 0,
			createdAt: stamp,
			updatedAt: stamp,
		});
	}

	async function executeCapability(input: unknown): Promise<ExecutionRecord> {
		if (closed)
			throw new ExecutionRuntimeError(
				"EXECUTOR_UNAVAILABLE",
				"execution runtime is closed",
			);
		const request = parseExecuteCapabilityRequest(input);
		const inputFingerprint = fingerprint(request);
		const existing = database
			.prepare(
				"SELECT * FROM executions WHERE caller_ref=? AND capability=? AND idempotency_key=?",
			)
			.get(request.callerRef, request.capability, request.idempotencyKey) as
			| Row
			| undefined;
		let record: ExecutionRecord;
		if (existing) {
			if (String(existing.input_fingerprint) !== inputFingerprint)
				throw new ExecutionRuntimeError(
					"IDEMPOTENCY_CONFLICT",
					"idempotency key was already used with different critical input",
				);
			const prior = fromRow(existing);
			const safelyResumable =
				(prior.status === "PENDING" &&
					prior.sideEffectState === "NOT_STARTED") ||
				(prior.status === "FAILED" && prior.sideEffectState === "NOT_APPLIED");
			if (!safelyResumable) return prior;
			const {
				error: _error,
				result: _result,
				finishedAt: _finishedAt,
				startedAt: _startedAt,
				effectStartedAt: _effectStartedAt,
				decisionPath: _decisionPath,
				approvalRef: _approvalRef,
				...resumable
			} = prior;
			record = parseExecutionRecord({
				...resumable,
				status: "PENDING",
				sideEffectState: "NOT_STARTED",
				retryable: false,
				updatedAt: now().toISOString(),
			});
			database
				.prepare(
					"UPDATE executions SET request_json=?, record_json=?, precondition_json=NULL WHERE execution_ref=?",
				)
				.run(
					JSON.stringify(protectedValue(request)),
					JSON.stringify(record),
					record.executionRef,
				);
			await log(record, "EXECUTION_REDECISION_REQUESTED");
		} else {
			record = createPending(request, inputFingerprint);
			try {
				database
					.prepare(
						"INSERT INTO executions VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)",
					)
					.run(
						record.executionRef,
						request.callerRef,
						request.capability,
						request.idempotencyKey,
						inputFingerprint,
						JSON.stringify(protectedValue(request)),
						JSON.stringify(record),
						record.createdAt,
					);
				await log(record, "INTENT_PERSISTED");
			} catch {
				const raced = database
					.prepare(
						"SELECT * FROM executions WHERE caller_ref=? AND capability=? AND idempotency_key=?",
					)
					.get(request.callerRef, request.capability, request.idempotencyKey) as
					| Row
					| undefined;
				if (!raced || String(raced.input_fingerprint) !== inputFingerprint)
					throw new ExecutionRuntimeError(
						"IDEMPOTENCY_CONFLICT",
						"concurrent idempotency conflict",
					);
				return fromRow(raced);
			}
		}
		let admission: Awaited<ReturnType<typeof admit>>;
		try {
			admission = await admit(request, inputFingerprint);
		} catch (error) {
			record = failRecord(record, runtimeError(error));
			save(record);
			await log(record, "ADMISSION_REJECTED", record.error?.code);
			return record;
		}
		let release: () => void;
		try {
			release = await semaphore.acquire();
		} catch (error) {
			record = failRecord(record, runtimeError(error));
			save(record);
			await log(record, "QUEUE_REJECTED", record.error?.code);
			return record;
		}
		const admittedRow = getRow(record.executionRef);
		if (admittedRow) {
			const admittedRecord = fromRow(admittedRow);
			if (admittedRecord.status !== "PENDING") {
				release();
				return admittedRecord;
			}
		}
		const controller = new AbortController();
		controllers.set(record.executionRef, controller);
		let timedOut = false;
		const runtimeTimeout =
			request.timeoutMs === undefined
				? undefined
				: setTimeout(() => {
						timedOut = true;
						controller.abort();
					}, request.timeoutMs);
		try {
			await admission.validateApproval();
			record = parseExecutionRecord({
				...record,
				status: "RUNNING",
				sideEffectState: "NOT_STARTED",
				decisionPath: admission.decisionPath,
				...(request.approvalRef ? { approvalRef: request.approvalRef } : {}),
				attemptCount: record.attemptCount + 1,
				startedAt: now().toISOString(),
				updatedAt: now().toISOString(),
			});
			save(record);
			await log(record, "EXECUTION_STARTED");
			const executor = browserIds.has(request.capability)
				? options.browserExecutor
				: options.localExecutor;
			if (!executor)
				throw new ExecutionRuntimeError(
					"EXECUTOR_UNAVAILABLE",
					"no executor is registered for capability",
				);
			let precondition: LocalPrecondition | undefined;
			const result = await executor.execute({
				request,
				admission,
				signal: controller.signal,
				async onEffectStarted(value) {
					precondition = value;
					record = parseExecutionRecord({
						...record,
						status: "RUNNING",
						sideEffectState: "STARTED",
						effectStartedAt: now().toISOString(),
						updatedAt: now().toISOString(),
					});
					save(record, value);
					await log(record, "EFFECT_STARTED");
				},
			});
			if (controller.signal.aborted)
				throw new ExecutionRuntimeError(
					timedOut ? "TIMEOUT" : "CANCELLED",
					timedOut
						? "execution runtime timeout elapsed"
						: "execution was cancelled",
				);
			if (!result.successful)
				throw new ExecutionRuntimeError(
					"EXECUTION_FAILED",
					"executor reported an unsuccessful result",
				);
			for (const artifact of result.artifacts)
				database
					.prepare(
						"INSERT OR REPLACE INTO execution_artifacts VALUES (?, ?, ?, ?)",
					)
					.run(
						record.executionRef,
						artifact.ref,
						artifact.stream,
						artifact.path,
					);
			record = parseExecutionRecord({
				...record,
				status: "SUCCEEDED",
				sideEffectState: result.effectApplied ? "APPLIED" : "NOT_APPLIED",
				retryable: false,
				result: result.result,
				evidence: result.evidence,
				evidenceRefs: result.evidence.map((item) => item.evidenceRef),
				finishedAt: now().toISOString(),
				updatedAt: now().toISOString(),
			});
			save(record, precondition);
			await log(record, "EXECUTION_SUCCEEDED");
			return record;
		} catch (error) {
			const failure = timedOut
				? new ExecutionRuntimeError(
						"TIMEOUT",
						"execution runtime timeout elapsed",
					)
				: runtimeError(error);
			const row = getRow(record.executionRef);
			if (row) record = fromRow(row);
			if (record.sideEffectState === "STARTED") {
				const executor = browserIds.has(request.capability)
					? options.browserExecutor
					: options.localExecutor;
				const preconditionRaw = row?.precondition_json;
				if (executor && preconditionRaw) {
					try {
						const reconciliation = await executor.reconcile(
							request,
							JSON.parse(String(preconditionRaw)) as LocalPrecondition,
						);
						if (reconciliation.state === "NOT_APPLIED")
							record = failRecord(record, failure);
						else if (
							reconciliation.state === "APPLIED" &&
							reconciliation.result
						)
							record = parseExecutionRecord({
								...record,
								status: "SUCCEEDED",
								sideEffectState: "APPLIED",
								retryable: false,
								result: reconciliation.result,
								evidence: reconciliation.evidence,
								evidenceRefs: reconciliation.evidence.map(
									(item) => item.evidenceRef,
								),
								finishedAt: now().toISOString(),
								updatedAt: now().toISOString(),
							});
						else
							record = failRecord(
								record,
								new ExecutionRuntimeError(
									"UNKNOWN_SIDE_EFFECT",
									"effect started but reality could not be reconstructed",
								),
								"UNKNOWN",
							);
					} catch {
						record = failRecord(
							record,
							new ExecutionRuntimeError(
								"UNKNOWN_SIDE_EFFECT",
								"effect reconciliation failed",
							),
							"UNKNOWN",
						);
					}
				} else
					record = failRecord(
						record,
						new ExecutionRuntimeError(
							"UNKNOWN_SIDE_EFFECT",
							"effect executor unavailable during reconciliation",
						),
						"UNKNOWN",
					);
			} else record = failRecord(record, failure);
			save(record);
			await log(record, "EXECUTION_TERMINATED", record.error?.code);
			return record;
		} finally {
			if (runtimeTimeout !== undefined) clearTimeout(runtimeTimeout);
			controllers.delete(record.executionRef);
			release();
		}
	}

	function getExecution(input: unknown): ExecutionRecord {
		const executionRef = parseExecutionRef(input);
		const row = getRow(executionRef);
		if (!row)
			throw new ExecutionRuntimeError(
				"INVALID_REQUEST",
				"execution was not found",
			);
		return fromRow(row);
	}

	async function readExecutionOutput(
		input: unknown,
	): Promise<ReadExecutionOutputResponse> {
		const request = parseReadExecutionOutputRequest(input);
		const row = database
			.prepare(
				"SELECT artifact_ref FROM execution_artifacts WHERE execution_ref=? AND stream=? ORDER BY artifact_ref LIMIT 1",
			)
			.get(request.executionRef, request.stream) as Row | undefined;
		if (!row)
			throw new ExecutionRuntimeError(
				"INVALID_REQUEST",
				"execution output stream was not found",
			);
		const record = getExecution(request.executionRef as ExecutionRef);
		const executor = browserIds.has(record.capability)
			? options.browserExecutor
			: options.localExecutor;
		if (!executor)
			throw new ExecutionRuntimeError(
				"EXECUTOR_UNAVAILABLE",
				"output executor is unavailable",
			);
		const offset = request.offset ?? 0;
		const output = await executor.readArtifact(
			String(row.artifact_ref),
			offset,
			request.limit ?? 16_384,
		);
		return {
			contract: "execution",
			contractVersion: EXECUTION_CONTRACT_VERSION,
			executionRef: request.executionRef,
			stream: request.stream,
			chunk: output.chunk,
			offset,
			nextOffset: output.nextOffset,
			eof: output.eof,
			evidenceRef: String(row.artifact_ref),
		};
	}

	async function cancelExecution(input: unknown): Promise<ExecutionRecord> {
		const request = parseCancelExecutionRequest(input);
		let record = getExecution(request.executionRef as ExecutionRef);
		if (record.callerRef !== request.callerRef)
			throw new ExecutionRuntimeError(
				"IDENTITY_INVALID",
				"only the bound caller may cancel execution",
			);
		controllers.get(request.executionRef)?.abort();
		if (record.status === "PENDING") {
			record = failRecord(
				record,
				new ExecutionRuntimeError("CANCELLED", request.reason),
			);
			save(record);
			await log(record, "EXECUTION_CANCELLED", "CANCELLED");
		}
		return record;
	}

	async function recoverIncomplete(): Promise<void> {
		const rows = database.prepare("SELECT * FROM executions").all() as Row[];
		for (const row of rows) {
			let record = fromRow(row);
			if (
				record.status !== "PENDING" &&
				record.status !== "RUNNING" &&
				record.status !== "UNKNOWN"
			)
				continue;
			if (
				record.status === "PENDING" &&
				record.sideEffectState === "NOT_STARTED"
			) {
				await log(record, "RECOVERY_PENDING_REQUIRES_REDECISION");
				continue;
			}
			if (record.status !== "UNKNOWN" && record.sideEffectState !== "STARTED") {
				record = failRecord(
					record,
					new ExecutionRuntimeError(
						"CANCELLED",
						"runtime restarted before effect start",
					),
				);
				save(record);
				await log(record, "RECOVERY_RECONCILED", record.error?.code);
				continue;
			}
			const request = parseExecuteCapabilityRequest(
				JSON.parse(String(row.request_json)),
			);
			const executor = browserIds.has(request.capability)
				? options.browserExecutor
				: options.localExecutor;
			if (!executor || !row.precondition_json) {
				record = failRecord(
					record,
					new ExecutionRuntimeError(
						"UNKNOWN_SIDE_EFFECT",
						"restart recovery lacks verifier",
					),
					"UNKNOWN",
				);
				save(record);
				await log(record, "RECOVERY_RECONCILED", record.error?.code);
				continue;
			}
			try {
				const reconciled = await executor.reconcile(
					request,
					JSON.parse(String(row.precondition_json)) as LocalPrecondition,
				);
				if (reconciled.state === "NOT_APPLIED")
					record = failRecord(
						record,
						new ExecutionRuntimeError(
							"EXECUTION_FAILED",
							"recovery verified no effect",
						),
					);
				else if (reconciled.state === "APPLIED" && reconciled.result) {
					const { error: _previousError, ...recoverable } = record;
					record = parseExecutionRecord({
						...recoverable,
						status: "SUCCEEDED",
						sideEffectState: "APPLIED",
						retryable: false,
						result: reconciled.result,
						evidence: reconciled.evidence,
						evidenceRefs: reconciled.evidence.map((item) => item.evidenceRef),
						finishedAt: now().toISOString(),
						updatedAt: now().toISOString(),
					});
				} else
					record = failRecord(
						record,
						new ExecutionRuntimeError(
							"UNKNOWN_SIDE_EFFECT",
							"restart reconciliation unresolved",
						),
						"UNKNOWN",
					);
			} catch {
				record = failRecord(
					record,
					new ExecutionRuntimeError(
						"UNKNOWN_SIDE_EFFECT",
						"restart verifier failed",
					),
					"UNKNOWN",
				);
			}
			save(record);
			await log(record, "RECOVERY_RECONCILED", record.error?.code);
		}
	}

	await recoverIncomplete();
	return Object.freeze({
		executeCapability,
		getExecution,
		readExecutionOutput,
		cancelExecution,
		recoverIncomplete,
		databasePath: options.databasePath,
		logPath,
		close() {
			closed = true;
			for (const controller of controllers.values()) controller.abort();
			database.close();
		},
	});
}
