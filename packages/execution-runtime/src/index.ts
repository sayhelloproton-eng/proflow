import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
	browserCapabilityIds,
	EXECUTION_CONTRACT_VERSION,
	type ExecuteCapabilityRequest,
	type ExecutionArtifactRecord,
	type ExecutionErrorCode,
	type ExecutionRecord,
	type ExecutionRef,
	executionErrorCodes,
	parseCancelExecutionRequest,
	parseExecuteCapabilityRequest,
	parseExecutionArtifactRecord,
	parseExecutionRecord,
	parseExecutionRef,
	parseReadExecutionOutputRequest,
	type ReadExecutionOutputResponse,
} from "@tomflow/proflow-execution-contracts";
import { createExecutionApprovalOwner } from "./approval-owner.ts";
import type {
	ExecutionExecutorPort,
	ExecutorArtifact,
	ExecutorPrecondition,
} from "./executor-port.ts";

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
	decide(
		request: ExecuteCapabilityRequest,
		context?: { executionRef: string; inputFingerprint: string },
	): Promise<{
		decision: "ALLOW" | "DENY";
		decisionPath: "fast" | "reason";
		approvalRequired?: boolean;
		reason?: string;
	}>;
}
export interface ExecutionApprovalPort {
	validate(input: {
		approvalRef: string;
		executionRef: string;
		callerRef: string;
		taskId?: string;
		capability: string;
		inputFingerprint: string;
		request: ExecuteCapabilityRequest;
		projectRoot?: string;
		precondition?: ExecutorPrecondition;
		now: string;
	}): MaybePromise<boolean>;
}

export interface ExecutionIdentityPort {
	authorize(request: ExecuteCapabilityRequest): MaybePromise<boolean>;
}
export type {
	ExecutionExecutorPort,
	ExecutorAdmission,
	ExecutorArtifact,
	ExecutorArtifactRead,
	ExecutorDecisionPath,
	ExecutorInvocation,
	ExecutorPrecondition,
	ExecutorReconciliation,
	ExecutorResult,
} from "./executor-port.ts";

export interface ExecutionRuntimeOptions {
	databasePath: string;
	localExecutor: ExecutionExecutorPort;
	browserExecutor?: ExecutionExecutorPort;
	policy?: ExecutionPolicyPort;
	modelDecision?: ExecutionModelDecisionPort;
	approval?: ExecutionApprovalPort;
	approvalDraftTtlMs?: number;
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
const secretFlagArg =
	/^--?(?:token|password|api[_-]?key|authorization|bearer|cookie|secret|private[_-]?key)(?:=(.*))?$/i;

/** Scrubs credential-shaped fragments inside plain strings (JSON bodies, headers). */
function scrubEmbeddedSecrets(value: string): string {
	return value
		.replace(/Bearer\s+([A-Za-z0-9._~+/-]+=*)/gi, (_match, token) =>
			typeof token === "string" ? `Bearer [SECRET_REF:${sha(token)}]` : _match,
		)
		.replace(
			/((?:authorization|api[_-]?key|token|password|cookie|secret|private[_-]?key)\s*[:=]\s*)([^\s,;"'}]+)/gi,
			(_match, prefix, secretValue) =>
				typeof prefix === "string" && typeof secretValue === "string"
					? `${prefix}[SECRET_REF:${sha(secretValue)}]`
					: _match,
		)
		.replace(
			/("(?:password|token|secret|api[_-]?key|authorization|cookie|private[_-]?key)"\s*:\s*")((?:[^"\\]|\\.)*)(")/gi,
			(_match, prefix, secretValue, suffix) =>
				typeof prefix === "string" &&
				typeof secretValue === "string" &&
				typeof suffix === "string"
					? `${prefix}[SECRET_REF:${sha(secretValue)}]${suffix}`
					: _match,
		);
}

function protectedValue(value: unknown, key = ""): unknown {
	if (sensitive.test(key)) return `[SECRET_REF:${sha(value)}]`;
	if (Array.isArray(value)) {
		const items: unknown[] = [];
		for (let i = 0; i < value.length; i++) {
			const item = value[i];
			if (typeof item !== "string") {
				items.push(protectedValue(item));
				continue;
			}
			const flag = secretFlagArg.exec(item);
			if (!flag) {
				items.push(protectedValue(item));
				continue;
			}
			if (flag[1] !== undefined && flag[1].length > 0) {
				// `--token=value` — keep the flag, hash the value.
				items.push(
					`${item.slice(0, item.length - flag[1].length)}[SECRET_REF:${sha(flag[1])}]`,
				);
			} else {
				items.push(item);
				if (i + 1 < value.length) {
					// `--token value` — the following positional arg is the secret.
					items.push(`[SECRET_REF:${sha(value[i + 1])}]`);
					i++;
				}
			}
		}
		return items;
	}
	if (typeof value !== "object" || value === null) {
		return typeof value === "string" ? scrubEmbeddedSecrets(value) : value;
	}
	return Object.fromEntries(
		Object.entries(value).map(([childKey, item]) => [
			childKey,
			protectedValue(item, childKey),
		]),
	);
}
export function executionInputFingerprint(input: unknown): string {
	const request = parseExecuteCapabilityRequest(input);
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
function materializeArtifactRefs(
	artifacts: readonly ExecutorArtifact[],
): Array<{
	ref: string;
	kind: "output" | "external-file" | "context-pack" | "patch-proposal";
	hash?: string;
	mime?: string;
	bytes: number;
}> {
	return artifacts.map((artifact) => ({
		ref: artifact.ref,
		kind: artifact.kind ?? "output",
		bytes: artifact.bytes,
		...(artifact.hash === undefined ? {} : { hash: artifact.hash }),
		...(artifact.mime === undefined ? {} : { mime: artifact.mime }),
	}));
}
function runtimeError(error: unknown): ExecutionRuntimeError {
	if (error instanceof ExecutionRuntimeError) return error;
	if (typeof error === "object" && error !== null) {
		const code = Reflect.get(error, "code");
		const message = Reflect.get(error, "message");
		const retryable = Reflect.get(error, "retryable");
		if (
			typeof code === "string" &&
			(executionErrorCodes as readonly string[]).includes(code) &&
			typeof message === "string"
		)
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
		const readOnly =
			request.capability === "file.read" ||
			request.capability === "file.searchText" ||
			request.capability === "artifact.external-file.materialize" ||
			request.capability === "artifact.context-pack.materialize" ||
			request.capability === "artifact.patch-proposal.materialize" ||
			request.capability === "git.status" ||
			request.capability === "git.diff" ||
			request.capability === "project.info" ||
			request.capability === "code.findSymbol" ||
			request.capability === "code.findReferences" ||
			request.capability === "process.status" ||
			request.capability === "browser.observe" ||
			request.capability === "browser.screenshot" ||
			request.capability === "browser.verify" ||
			(request.capability === "network.request" &&
				(request.input.method === "GET" || request.input.method === "HEAD"));
		if (readOnly)
			return {
				decision: "ALLOW",
				decisionPath: "deterministic",
				approvalRequired: false,
			};

		// Frozen policy: every ordinary real side effect is semantically judged by
		// FAST first. REASON/Human are escalation paths, never a blanket gate.
		return {
			decision: "REVIEW",
			decisionPath: "fast",
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
		CREATE TABLE IF NOT EXISTS artifact_registry (
			artifact_ref TEXT PRIMARY KEY, kind TEXT NOT NULL, owner_caller_ref TEXT NOT NULL,
			task_id TEXT, node_id TEXT, role_ref TEXT, worker_ref TEXT, path TEXT NOT NULL,
			record_json TEXT NOT NULL, created_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS artifact_registry_scope_idx ON artifact_registry(task_id, owner_caller_ref, created_at);
		CREATE TABLE IF NOT EXISTS execution_observer_signals (
			signal_ref TEXT PRIMARY KEY, execution_ref TEXT NOT NULL, kind TEXT NOT NULL,
			record_json TEXT NOT NULL, created_at TEXT NOT NULL, acknowledged_at TEXT,
			FOREIGN KEY(execution_ref) REFERENCES executions(execution_ref)
		);
		CREATE INDEX IF NOT EXISTS execution_observer_signals_pending_idx
			ON execution_observer_signals(acknowledged_at, created_at);
	`);
	const now = options.now ?? (() => new Date());
	const idFactory = options.idFactory ?? randomUUID;
	const approvalOwner = createExecutionApprovalOwner({
		databasePath: options.databasePath,
		...(options.now ? { now: options.now } : {}),
		...(options.idFactory ? { idFactory: options.idFactory } : {}),
	});
	const approvalDraftTtlMs = options.approvalDraftTtlMs ?? 15 * 60_000;
	if (!Number.isInteger(approvalDraftTtlMs) || approvalDraftTtlMs < 60_000)
		throw new TypeError("approvalDraftTtlMs must be an integer >= 60000");
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

	type ExecutionObserverSignal = {
		signalRef: string;
		kind: "RECOVERY_RESUME" | "UNKNOWN_REALITY";
		executionRef: string;
		taskId: string;
		nodeId: string;
		runNo?: number;
		roleRef?: string;
		workerRef: string;
		status: ExecutionRecord["status"];
		sideEffectState: ExecutionRecord["sideEffectState"];
		errorCode?: string;
		createdAt: string;
	};
	const emitObserverSignal = (
		record: ExecutionRecord,
		kind: ExecutionObserverSignal["kind"],
	) => {
		if (!record.taskId || !record.nodeId || !record.workerRef) return;
		const signalRef = `execution-signal:${createHash("sha256")
			.update(
				JSON.stringify({
					executionRef: record.executionRef,
					kind,
					status: record.status,
					sideEffectState: record.sideEffectState,
				}),
			)
			.digest("hex")}`;
		const signal: ExecutionObserverSignal = {
			signalRef,
			kind,
			executionRef: record.executionRef,
			taskId: record.taskId,
			nodeId: record.nodeId,
			...(record.runNo === undefined ? {} : { runNo: record.runNo }),
			...(record.roleRef === undefined ? {} : { roleRef: record.roleRef }),
			workerRef: record.workerRef,
			status: record.status,
			sideEffectState: record.sideEffectState,
			...(record.error?.code === undefined
				? {}
				: { errorCode: record.error.code }),
			createdAt: now().toISOString(),
		};
		database
			.prepare(
				"INSERT OR IGNORE INTO execution_observer_signals(signal_ref, execution_ref, kind, record_json, created_at, acknowledged_at) VALUES (?, ?, ?, ?, ?, NULL)",
			)
			.run(
				signalRef,
				record.executionRef,
				kind,
				JSON.stringify(signal),
				signal.createdAt,
			);
	};
	const listExecutionObserverSignals = (
		limit = 50,
	): ExecutionObserverSignal[] => {
		const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
		return (
			database
				.prepare(
					"SELECT record_json FROM execution_observer_signals WHERE acknowledged_at IS NULL ORDER BY created_at, signal_ref LIMIT ?",
				)
				.all(bounded) as Row[]
		).map(
			(row) => JSON.parse(String(row.record_json)) as ExecutionObserverSignal,
		);
	};
	const acknowledgeExecutionObserverSignal = (signalRef: string) => {
		const result = database
			.prepare(
				"UPDATE execution_observer_signals SET acknowledged_at=? WHERE signal_ref=? AND acknowledged_at IS NULL",
			)
			.run(now().toISOString(), signalRef);
		return { acknowledged: result.changes === 1 };
	};

	const getRow = (executionRef: string): Row | undefined =>
		database
			.prepare("SELECT * FROM executions WHERE execution_ref=?")
			.get(executionRef) as Row | undefined;
	const fromRow = (row: Row): ExecutionRecord =>
		parseExecutionRecord(JSON.parse(String(row.record_json)));
	const save = (
		record: ExecutionRecord,
		precondition?: ExecutorPrecondition,
	) => {
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
		executionRef: string,
	) {
		if (options.identity && !(await options.identity.authorize(request)))
			throw new ExecutionRuntimeError(
				"IDENTITY_INVALID",
				"caller, Task, Agent, workspace, or Browser identity is not authoritative",
			);
		const policy = options.policy ?? defaultPolicy;
		const policyDecision = await policy.decide(request);
		if (policyDecision.decision === "DENY")
			throw new ExecutionRuntimeError(
				"POLICY_DENIED",
				policyDecision.reason ?? "deterministic policy denied execution",
			);
		let decisionPath: "deterministic" | "fast" | "reason" | "human" =
			policyDecision.decisionPath;
		let approvalRequired = policyDecision.approvalRequired === true;
		if (policyDecision.decision === "REVIEW") {
			if (!options.modelDecision)
				throw new ExecutionRuntimeError(
					"DECISION_UNRESOLVED",
					"review requires a model decision",
				);
			const model = options.modelDecision;
			const modelDecision = await model.decide(request, {
				executionRef,
				inputFingerprint,
			});
			decisionPath = modelDecision.decisionPath;
			approvalRequired =
				approvalRequired || modelDecision.approvalRequired === true;
			if (approvalRequired) decisionPath = "human";
			if (modelDecision.decision === "DENY")
				throw new ExecutionRuntimeError(
					"POLICY_DENIED",
					modelDecision.reason ?? "model decision denied execution",
				);
		}
		const validateApproval = async (precondition?: ExecutorPrecondition) => {
			if (!approvalRequired) return;
			if (!request.approvalRef)
				throw new ExecutionRuntimeError(
					"APPROVAL_REQUIRED",
					"bound approval is required",
				);
			const approval = options.approval ?? approvalOwner;
			if (
				!(await approval.validate({
					approvalRef: request.approvalRef,
					executionRef,
					callerRef: request.callerRef,
					...(request.taskId ? { taskId: request.taskId } : {}),
					capability: request.capability,
					inputFingerprint,
					request,
					...(request.projectRoot ? { projectRoot: request.projectRoot } : {}),
					...(precondition ? { precondition } : {}),
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
			approval: approvalRequired
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

	function registerArtifact(input: {
		record: unknown;
		path: string;
	}): ExecutionArtifactRecord {
		const record = parseExecutionArtifactRecord(input.record);
		const existing = database
			.prepare(
				"SELECT record_json, path FROM artifact_registry WHERE artifact_ref=?",
			)
			.get(record.artifactRef) as Row | undefined;
		if (existing) {
			const existingRecord = parseExecutionArtifactRecord(
				JSON.parse(String(existing.record_json)),
			);
			if (
				JSON.stringify(existingRecord) !== JSON.stringify(record) ||
				String(existing.path) !== input.path
			)
				throw new ExecutionRuntimeError(
					"IDEMPOTENCY_CONFLICT",
					"artifactRef is immutable and was already registered with different content",
				);
			return existingRecord;
		}
		database
			.prepare(`INSERT INTO artifact_registry
			(artifact_ref, kind, owner_caller_ref, task_id, node_id, role_ref, worker_ref, path, record_json, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
			.run(
				record.artifactRef,
				record.kind,
				record.ownerCallerRef,
				record.taskId ?? null,
				record.nodeId ?? null,
				record.roleRef ?? null,
				record.workerRef ?? null,
				input.path,
				JSON.stringify(record),
				record.createdAt,
			);
		return record;
	}

	function getArtifactStorage(artifactRef: string): {
		record: ExecutionArtifactRecord;
		path: string;
	} {
		const row = database
			.prepare(
				"SELECT record_json, path FROM artifact_registry WHERE artifact_ref=?",
			)
			.get(artifactRef) as Row | undefined;
		if (!row)
			throw new ExecutionRuntimeError(
				"INVALID_REQUEST",
				"artifact was not found",
			);
		return {
			record: parseExecutionArtifactRecord(JSON.parse(String(row.record_json))),
			path: String(row.path),
		};
	}

	function getArtifactRecordInternal(
		artifactRef: string,
	): ExecutionArtifactRecord {
		return getArtifactStorage(artifactRef).record;
	}

	function getArtifactRecord(input: {
		artifactRef: string;
		callerRef: string;
		taskId?: string;
		nodeId?: string;
		roleRef?: string;
		workerRef?: string;
	}): ExecutionArtifactRecord {
		const artifact = getArtifactRecordInternal(input.artifactRef);
		if (artifact.ownerCallerRef !== input.callerRef)
			throw new ExecutionRuntimeError(
				"IDENTITY_INVALID",
				"caller does not own the Artifact",
			);
		for (const [label, expected, actual] of [
			["task", artifact.taskId, input.taskId],
			["node", artifact.nodeId, input.nodeId],
			["role", artifact.roleRef, input.roleRef],
			["worker", artifact.workerRef, input.workerRef],
		] as const) {
			if (expected !== undefined && expected !== actual)
				throw new ExecutionRuntimeError(
					"SCOPE_DENIED",
					`Artifact ${label} scope does not match the read request`,
				);
		}
		return artifact;
	}

	function assertPatchArtifactScope(request: ExecuteCapabilityRequest): void {
		if (request.capability !== "patch.apply") return;
		const artifact = getArtifactRecordInternal(request.input.artifactRef);
		if (artifact.kind !== "patch-proposal")
			throw new ExecutionRuntimeError(
				"PRECONDITION_FAILED",
				"patch.apply requires a durable patch-proposal Artifact",
			);
		if (artifact.ownerCallerRef !== request.callerRef)
			throw new ExecutionRuntimeError(
				"IDENTITY_INVALID",
				"caller does not own the patch proposal Artifact",
			);
		for (const [label, expected, actual] of [
			["task", artifact.taskId, request.taskId],
			["node", artifact.nodeId, request.nodeId],
			["role", artifact.roleRef, request.roleRef],
			["worker", artifact.workerRef, request.workerRef],
		] as const) {
			if (expected !== undefined && expected !== actual)
				throw new ExecutionRuntimeError(
					"SCOPE_DENIED",
					`patch proposal ${label} scope does not match the Execution Request`,
				);
		}
	}

	options.localExecutor.bindPatchArtifactResolver?.(async (artifactRef) => {
		try {
			const { record, path } = getArtifactStorage(artifactRef);
			if (record.kind !== "patch-proposal") return undefined;
			const baseHash = record.metadata?.baseHash;
			const baseRef = record.metadata?.baseRef;
			const hash = record.hash;
			if (
				typeof baseHash !== "string" ||
				typeof baseRef !== "string" ||
				typeof hash !== "string"
			)
				return undefined;
			return {
				artifactRef: record.artifactRef,
				kind: "patch-proposal",
				path,
				hash,
				baseHash,
				baseRef,
			};
		} catch {
			return undefined;
		}
	});

	function lookupExecutionIntent(input: unknown): ExecutionRecord {
		const request = parseExecuteCapabilityRequest(input);
		const row = database
			.prepare(
				"SELECT * FROM executions WHERE caller_ref=? AND capability=? AND idempotency_key=?",
			)
			.get(request.callerRef, request.capability, request.idempotencyKey) as
			| Row
			| undefined;
		if (!row)
			throw new ExecutionRuntimeError(
				"INVALID_REQUEST",
				"execution intent was not found",
			);
		if (String(row.input_fingerprint) !== executionInputFingerprint(request))
			throw new ExecutionRuntimeError(
				"IDEMPOTENCY_CONFLICT",
				"execution intent lookup input does not match durable input",
			);
		return fromRow(row);
	}

	async function executeCapability(input: unknown): Promise<ExecutionRecord> {
		if (closed)
			throw new ExecutionRuntimeError(
				"EXECUTOR_UNAVAILABLE",
				"execution runtime is closed",
			);
		const request = parseExecuteCapabilityRequest(input);
		assertPatchArtifactScope(request);
		const inputFingerprint = executionInputFingerprint(request);
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
			admission = await admit(request, inputFingerprint, record.executionRef);
		} catch (error) {
			const admissionError = runtimeError(error);
			if (
				admissionError.code === "APPROVAL_REQUIRED" &&
				!request.approvalRef &&
				!options.approval
			) {
				const approval = approvalOwner.ensurePendingApproval({
					executionRef: record.executionRef,
					actorRef: "execution-runtime:policy",
					expiresAt: new Date(
						now().getTime() + approvalDraftTtlMs,
					).toISOString(),
				});
				record = parseExecutionRecord({
					...record,
					approvalRef: approval.approvalRef,
					updatedAt: now().toISOString(),
				});
			}
			record = failRecord(record, admissionError);
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
			if (controller.signal.aborted)
				throw new ExecutionRuntimeError(
					timedOut ? "TIMEOUT" : "CANCELLED",
					timedOut
						? "execution runtime timeout elapsed during admission"
						: "execution was cancelled during admission",
				);
			// CAS: only transition to RUNNING if the record is still PENDING.
			// A concurrent cancel/timeout finalizes PENDING records, so a
			// stale RUNNING write would silently resurrect a cancelled intent.
			const casRow = getRow(record.executionRef);
			if (casRow) {
				const casRecord = fromRow(casRow);
				if (casRecord.status !== "PENDING") return casRecord;
			}
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
			let precondition: ExecutorPrecondition | undefined;
			const result = await executor.execute({
				request,
				admission,
				signal: controller.signal,
				async onEffectStarted(value) {
					if (controller.signal.aborted)
						throw new ExecutionRuntimeError(
							timedOut ? "TIMEOUT" : "CANCELLED",
							timedOut
								? "execution runtime timeout elapsed before effect"
								: "execution was cancelled before effect",
						);
					await admission.validateApproval(value);
					if (controller.signal.aborted)
						throw new ExecutionRuntimeError(
							timedOut ? "TIMEOUT" : "CANCELLED",
							"execution was cancelled while revalidating approval before effect",
						);
					if (request.approvalRef && !options.approval)
						approvalOwner.consume(request.approvalRef);
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
			if (!result.successful && result.effectApplied)
				throw new ExecutionRuntimeError(
					"EXECUTION_FAILED",
					"effectful executor reported an unsuccessful result",
				);
			database.exec("BEGIN IMMEDIATE");
			try {
				for (const artifact of result.artifacts) {
					registerArtifact({
						path: artifact.path,
						record: {
							contract: "execution.artifact",
							contractVersion: EXECUTION_CONTRACT_VERSION,
							artifactRef: artifact.ref,
							kind: artifact.kind ?? "output",
							ownerCallerRef: request.callerRef,
							...(request.taskId ? { taskId: request.taskId } : {}),
							...(request.nodeId ? { nodeId: request.nodeId } : {}),
							...(request.roleRef ? { roleRef: request.roleRef } : {}),
							...(request.workerRef ? { workerRef: request.workerRef } : {}),
							...(artifact.hash ? { hash: artifact.hash } : {}),
							...(artifact.mime ? { mime: artifact.mime } : {}),
							bytes: artifact.bytes,
							metadata: {
								stream: artifact.stream,
								executionRef: record.executionRef,
								...(artifact.metadata ?? {}),
							},
							createdAt: now().toISOString(),
						},
					});
					const existingRelation = database
						.prepare(
							"SELECT stream, path FROM execution_artifacts WHERE execution_ref=? AND artifact_ref=?",
						)
						.get(record.executionRef, artifact.ref) as Row | undefined;
					if (existingRelation) {
						if (
							String(existingRelation.stream) !== artifact.stream ||
							String(existingRelation.path) !== artifact.path
						)
							throw new ExecutionRuntimeError(
								"IDEMPOTENCY_CONFLICT",
								"Execution Artifact relation is immutable",
							);
					} else
						database
							.prepare("INSERT INTO execution_artifacts VALUES (?, ?, ?, ?)")
							.run(
								record.executionRef,
								artifact.ref,
								artifact.stream,
								artifact.path,
							);
				}
				database.exec("COMMIT");
			} catch (error) {
				database.exec("ROLLBACK");
				throw error;
			}
			if (!result.successful) {
				const resultData = result.result.data as Record<string, unknown>;
				const exitCode =
					typeof resultData.exitCode === "number"
						? resultData.exitCode
						: undefined;
				record = parseExecutionRecord({
					...record,
					status: "FAILED",
					sideEffectState: "NOT_APPLIED",
					retryable: false,
					evidence: result.evidence,
					evidenceRefs: result.evidence.map((item) => item.evidenceRef),
					artifactRefs: materializeArtifactRefs(result.artifacts).map(
						(item) => item.ref,
					),
					error: {
						code: "EXECUTION_FAILED",
						message:
							exitCode !== undefined
								? `verification command exited with code ${exitCode}`
								: "verification command returned a known non-zero result",
						retryable: false,
					},
					finishedAt: now().toISOString(),
					updatedAt: now().toISOString(),
				});
				save(record);
				await log(record, "EXECUTION_FAILED", "EXECUTION_FAILED");
				return record;
			}
			record = parseExecutionRecord({
				...record,
				status: "SUCCEEDED",
				sideEffectState: result.effectApplied ? "APPLIED" : "NOT_APPLIED",
				retryable: false,
				result: result.result,
				evidence: result.evidence,
				evidenceRefs: result.evidence.map((item) => item.evidenceRef),
				artifactRefs: materializeArtifactRefs(result.artifacts).map(
					(item) => item.ref,
				),
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
							JSON.parse(String(preconditionRaw)) as ExecutorPrecondition,
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

	function getExecutionRecord(executionRef: ExecutionRef): ExecutionRecord {
		const row = getRow(executionRef);
		if (!row)
			throw new ExecutionRuntimeError(
				"INVALID_REQUEST",
				"execution was not found",
			);
		return fromRow(row);
	}

	function getExecution(input: unknown): ExecutionRecord {
		return getExecutionRecord(parseExecutionRef(input));
	}

	function getExecutionForCaller(input: {
		executionRef: unknown;
		callerRef: string;
	}): ExecutionRecord {
		const record = getExecutionRecord(parseExecutionRef(input.executionRef));
		if (record.callerRef !== input.callerRef)
			throw new ExecutionRuntimeError(
				"IDENTITY_INVALID",
				"only the bound caller may read execution",
			);
		return record;
	}

	async function readExecutionOutputRecord(
		input: unknown,
		record: ExecutionRecord,
	): Promise<ReadExecutionOutputResponse> {
		const request = parseReadExecutionOutputRequest(input);
		if (record.executionRef !== request.executionRef)
			throw new ExecutionRuntimeError(
				"INVALID_REQUEST",
				"execution output scope mismatch",
			);
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
			artifactRef: String(row.artifact_ref),
		};
	}

	async function readExecutionOutput(
		input: unknown,
	): Promise<ReadExecutionOutputResponse> {
		const request = parseReadExecutionOutputRequest(input);
		return readExecutionOutputRecord(
			request,
			getExecutionRecord(request.executionRef as ExecutionRef),
		);
	}

	async function readExecutionOutputForCaller(
		input: unknown,
		callerRef: string,
	): Promise<ReadExecutionOutputResponse> {
		const request = parseReadExecutionOutputRequest(input);
		return readExecutionOutputRecord(
			request,
			getExecutionForCaller({ executionRef: request.executionRef, callerRef }),
		);
	}

	async function cancelExecution(input: unknown): Promise<ExecutionRecord> {
		const request = parseCancelExecutionRequest(input);
		let record = getExecutionRecord(request.executionRef as ExecutionRef);
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
				emitObserverSignal(record, "RECOVERY_RESUME");
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
				emitObserverSignal(record, "RECOVERY_RESUME");
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
				emitObserverSignal(record, "UNKNOWN_REALITY");
				continue;
			}
			try {
				const reconciled = await executor.reconcile(
					request,
					JSON.parse(String(row.precondition_json)) as ExecutorPrecondition,
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
			emitObserverSignal(
				record,
				record.status === "UNKNOWN" ? "UNKNOWN_REALITY" : "RECOVERY_RESUME",
			);
		}
	}

	await recoverIncomplete();
	return Object.freeze({
		executeCapability,
		lookupExecutionIntent,
		listExecutionObserverSignals,
		acknowledgeExecutionObserverSignal,
		getExecution,
		getExecutionForCaller,
		readExecutionOutput,
		readExecutionOutputForCaller,
		cancelExecution,
		requestExecutionApproval: approvalOwner.requestApproval,
		decideExecutionApproval: approvalOwner.decideApproval,
		revokeExecutionApproval: approvalOwner.revokeApproval,
		getExecutionApproval: approvalOwner.getApproval,
		listExecutionApprovals: approvalOwner.listApprovals,
		registerArtifact,
		getArtifactRecord,
		recoverIncomplete,
		databasePath: options.databasePath,
		logPath,
		close() {
			closed = true;
			for (const controller of controllers.values()) controller.abort();
			approvalOwner.close();
			database.close();
		},
	});
}

export {
	createExecutionApprovalOwner,
	ExecutionApprovalOwnerError,
} from "./approval-owner.ts";
