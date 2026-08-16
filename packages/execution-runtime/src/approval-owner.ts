import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
	EXECUTION_CONTRACT_VERSION,
	type ExecuteCapabilityRequest,
	type ExecutionApprovalRecord,
	parseDecideExecutionApproval,
	parseExecutionApprovalRecord,
	parseExecutionArtifactRecord,
	parseRequestExecutionApproval,
	parseRevokeExecutionApproval,
} from "@tomflow/proflow-execution-contracts";
import type { ExecutorPrecondition } from "./executor-port.ts";

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

type Row = Record<string, unknown>;

export class ExecutionApprovalOwnerError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = "ExecutionApprovalOwnerError";
		this.code = code;
	}
}

export function createExecutionApprovalOwner(input: {
	databasePath: string;
	now?: () => Date;
	idFactory?: () => string;
}) {
	const database = new DatabaseSync(input.databasePath);
	database.exec(
		"PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2500;",
	);
	database.exec(`
		CREATE TABLE IF NOT EXISTS execution_approvals (
			approval_ref TEXT PRIMARY KEY,
			execution_ref TEXT NOT NULL,
			record_json TEXT NOT NULL,
			created_at TEXT NOT NULL,
			FOREIGN KEY(execution_ref) REFERENCES executions(execution_ref)
		);
		CREATE INDEX IF NOT EXISTS execution_approvals_execution_idx
			ON execution_approvals(execution_ref, created_at);
	`);
	const now = input.now ?? (() => new Date());
	const idFactory = input.idFactory ?? randomUUID;
	const getRow = (approvalRef: string) =>
		database
			.prepare("SELECT * FROM execution_approvals WHERE approval_ref=?")
			.get(approvalRef) as Row | undefined;
	const getExecutionRow = (executionRef: string) =>
		database
			.prepare("SELECT * FROM executions WHERE execution_ref=?")
			.get(executionRef) as Row | undefined;
	const patchArtifactBinding = (request: ExecuteCapabilityRequest): unknown => {
		if (request.capability !== "patch.apply") return undefined;
		const row = database
			.prepare("SELECT record_json FROM artifact_registry WHERE artifact_ref=?")
			.get(request.input.artifactRef) as Row | undefined;
		if (!row)
			throw new ExecutionApprovalOwnerError(
				"ARTIFACT_NOT_FOUND",
				"patch approval requires the durable patch Artifact",
			);
		const artifact = parseExecutionArtifactRecord(
			JSON.parse(String(row.record_json)),
		);
		if (artifact.kind !== "patch-proposal")
			throw new ExecutionApprovalOwnerError(
				"ARTIFACT_KIND_INVALID",
				"patch approval requires a patch-proposal Artifact",
			);
		return {
			artifactRef: artifact.artifactRef,
			hash: artifact.hash,
			ownerCallerRef: artifact.ownerCallerRef,
			taskId: artifact.taskId,
			nodeId: artifact.nodeId,
			roleRef: artifact.roleRef,
			workerRef: artifact.workerRef,
			baseHash: artifact.metadata?.baseHash,
			baseRef: artifact.metadata?.baseRef,
		};
	};
	const approvalEffectFingerprint = (
		request: ExecuteCapabilityRequest,
		inputFingerprint: string,
	): string =>
		sha({
			capability: request.capability,
			inputFingerprint,
			projectRoot: request.projectRoot,
			patchArtifact: patchArtifactBinding(request),
		});
	const fromRow = (row: Row) =>
		parseExecutionApprovalRecord(JSON.parse(String(row.record_json)));
	const save = (record: ExecutionApprovalRecord) => {
		database
			.prepare(
				"UPDATE execution_approvals SET record_json=? WHERE approval_ref=?",
			)
			.run(JSON.stringify(record), record.approvalRef);
	};
	const listApprovals = (
		filter: { executionRef?: string; status?: string } = {},
	): ExecutionApprovalRecord[] => {
		const rows = filter.executionRef
			? (database
					.prepare(
						"SELECT * FROM execution_approvals WHERE execution_ref=? ORDER BY created_at, approval_ref",
					)
					.all(filter.executionRef) as Row[])
			: (database
					.prepare(
						"SELECT * FROM execution_approvals ORDER BY created_at, approval_ref",
					)
					.all() as Row[]);
		return rows
			.map((row) => get(String(row.approval_ref)))
			.filter((record) => !filter.status || record.status === filter.status);
	};
	const get = (approvalRef: string): ExecutionApprovalRecord => {
		const row = getRow(approvalRef);
		if (!row)
			throw new ExecutionApprovalOwnerError(
				"APPROVAL_NOT_FOUND",
				"approval was not found",
			);
		let record = fromRow(row);
		if (
			record.status === "APPROVED" &&
			Date.parse(record.expiresAt) <= now().getTime()
		) {
			record = parseExecutionApprovalRecord({
				...record,
				status: "EXPIRED",
				version: record.version + 1,
			});
			save(record);
		}
		return record;
	};
	const ensurePendingApproval = (value: {
		executionRef: string;
		actorRef: string;
		expiresAt: string;
		precondition?: ExecutorPrecondition;
	}): ExecutionApprovalRecord => {
		const executionRow = getExecutionRow(value.executionRef);
		if (!executionRow)
			throw new ExecutionApprovalOwnerError(
				"EXECUTION_NOT_FOUND",
				"execution was not found",
			);
		const inputFingerprint = String(executionRow.input_fingerprint);
		const existing = (
			database
				.prepare(
					"SELECT * FROM execution_approvals WHERE execution_ref=? ORDER BY created_at DESC",
				)
				.all(value.executionRef) as Row[]
		)
			.map(fromRow)
			.find(
				(record) =>
					record.status === "PENDING" &&
					record.inputFingerprint === inputFingerprint &&
					Date.parse(record.expiresAt) > now().getTime(),
			);
		if (existing) return existing;
		return requestApproval({
			contract: "execution.approval",
			contractVersion: EXECUTION_CONTRACT_VERSION,
			executionRef: value.executionRef,
			actorRef: value.actorRef,
			expiresAt: value.expiresAt,
			...(value.precondition
				? { preconditionFingerprint: sha(value.precondition) }
				: {}),
		});
	};
	const requestApproval = (value: unknown): ExecutionApprovalRecord => {
		const request = parseRequestExecutionApproval(value);
		if (Date.parse(request.expiresAt) <= now().getTime())
			throw new ExecutionApprovalOwnerError(
				"APPROVAL_EXPIRY_INVALID",
				"approval expiry must be in the future",
			);
		const executionRow = getExecutionRow(request.executionRef);
		if (!executionRow)
			throw new ExecutionApprovalOwnerError(
				"EXECUTION_NOT_FOUND",
				"execution was not found",
			);
		const executionRequest = JSON.parse(
			String(executionRow.request_json),
		) as ExecuteCapabilityRequest;
		const executionRecord = JSON.parse(
			String(executionRow.record_json),
		) as Record<string, unknown>;
		const inputFingerprint = String(executionRow.input_fingerprint);
		const stamp = now().toISOString();
		const record = parseExecutionApprovalRecord({
			contract: "execution.approval",
			contractVersion: EXECUTION_CONTRACT_VERSION,
			approvalRef: `approval:${idFactory()}`,
			executionRef: request.executionRef,
			callerRef: executionRequest.callerRef,
			...(executionRequest.taskId ? { taskId: executionRequest.taskId } : {}),
			...(executionRequest.nodeId ? { nodeId: executionRequest.nodeId } : {}),
			...(executionRequest.roleRef
				? { roleRef: executionRequest.roleRef }
				: {}),
			...(executionRequest.workerRef
				? { workerRef: executionRequest.workerRef }
				: {}),
			capability: executionRequest.capability,
			inputFingerprint,
			effectFingerprint: approvalEffectFingerprint(
				executionRequest,
				inputFingerprint,
			),
			scopeFingerprint: sha({
				callerRef: executionRequest.callerRef,
				taskId: executionRequest.taskId,
				nodeId: executionRequest.nodeId,
				roleRef: executionRequest.roleRef,
				workerRef: executionRequest.workerRef,
				projectRoot: executionRequest.projectRoot,
			}),
			...(request.preconditionFingerprint
				? { preconditionFingerprint: request.preconditionFingerprint }
				: {}),
			status: "PENDING",
			requestedByActorRef: request.actorRef,
			requestedAt: stamp,
			expiresAt: request.expiresAt,
			version: 1,
		});
		database
			.prepare("INSERT INTO execution_approvals VALUES (?, ?, ?, ?)")
			.run(
				record.approvalRef,
				record.executionRef,
				JSON.stringify(record),
				stamp,
			);
		void executionRecord;
		return record;
	};
	const decideApproval = (value: unknown): ExecutionApprovalRecord => {
		const request = parseDecideExecutionApproval(value);
		const current = get(request.approvalRef);
		if (current.version !== request.expectedVersion)
			throw new ExecutionApprovalOwnerError(
				"APPROVAL_VERSION_CONFLICT",
				"approval version changed",
			);
		if (current.status !== "PENDING")
			throw new ExecutionApprovalOwnerError(
				"APPROVAL_STATE_INVALID",
				"only PENDING approval may be decided",
			);
		const stamp = now().toISOString();
		const next = parseExecutionApprovalRecord({
			...current,
			status: request.decision === "ALLOW" ? "APPROVED" : "DENIED",
			decidedByActorRef: request.actorRef,
			...(request.reason ? { reason: request.reason } : {}),
			decidedAt: stamp,
			version: current.version + 1,
		});
		save(next);
		return next;
	};
	const revokeApproval = (value: unknown): ExecutionApprovalRecord => {
		const request = parseRevokeExecutionApproval(value);
		const current = get(request.approvalRef);
		if (current.version !== request.expectedVersion)
			throw new ExecutionApprovalOwnerError(
				"APPROVAL_VERSION_CONFLICT",
				"approval version changed",
			);
		if (current.status !== "PENDING" && current.status !== "APPROVED")
			throw new ExecutionApprovalOwnerError(
				"APPROVAL_STATE_INVALID",
				"approval cannot be revoked from current state",
			);
		const next = parseExecutionApprovalRecord({
			...current,
			status: "REVOKED",
			decidedByActorRef: request.actorRef,
			reason: request.reason,
			revokedAt: now().toISOString(),
			version: current.version + 1,
		});
		save(next);
		return next;
	};
	const validate = (value: {
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
	}): boolean => {
		const record = get(value.approvalRef);
		if (record.status !== "APPROVED") return false;
		if (
			record.executionRef !== value.executionRef ||
			record.callerRef !== value.callerRef ||
			record.capability !== value.capability ||
			record.inputFingerprint !== value.inputFingerprint
		)
			return false;
		if ((record.taskId ?? undefined) !== (value.taskId ?? undefined))
			return false;
		const effectFingerprint = approvalEffectFingerprint(
			value.request,
			value.inputFingerprint,
		);
		if (record.effectFingerprint !== effectFingerprint) return false;
		const scopeFingerprint = sha({
			callerRef: value.request.callerRef,
			taskId: value.request.taskId,
			nodeId: value.request.nodeId,
			roleRef: value.request.roleRef,
			workerRef: value.request.workerRef,
			projectRoot: value.request.projectRoot,
		});
		if (record.scopeFingerprint !== scopeFingerprint) return false;
		if (value.precondition && record.preconditionFingerprint) {
			if (record.preconditionFingerprint !== sha(value.precondition))
				return false;
		}
		return Date.parse(record.expiresAt) > Date.parse(value.now);
	};
	const consume = (approvalRef: string): ExecutionApprovalRecord => {
		const current = get(approvalRef);
		if (current.status !== "APPROVED")
			throw new ExecutionApprovalOwnerError(
				"APPROVAL_STATE_INVALID",
				"only APPROVED approval may be consumed",
			);
		const next = parseExecutionApprovalRecord({
			...current,
			status: "CONSUMED",
			consumedAt: now().toISOString(),
			version: current.version + 1,
		});
		save(next);
		return next;
	};
	return Object.freeze({
		requestApproval,
		ensurePendingApproval,
		decideApproval,
		revokeApproval,
		getApproval: get,
		listApprovals,
		validate,
		consume,
		close: () => database.close(),
	});
}
