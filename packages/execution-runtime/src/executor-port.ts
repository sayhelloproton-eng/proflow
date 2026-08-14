import type {
	BrowserCapabilityId,
	ExecuteCapabilityRequest,
	ExecutionCapabilityId,
	ExecutionCapabilityResult,
	ExecutionEvidence,
} from "@tomflow/proflow-execution-contracts";

/**
 * Owner-neutral executor contract owned by `execution-runtime`.
 *
 * `execution-runtime` is the single backend Execution truth. Its Executor Port
 * must be able to carry both the local (in-process) executor and the browser
 * executor without importing a concrete executor's public types as the core
 * abstraction owner.
 */

export type ExecutorDecisionPath =
	| "deterministic"
	| "fast"
	| "reason"
	| "human";
export type ExecutorApprovalState = "NOT_REQUIRED" | "VALID";

export interface ExecutorAdmission {
	policy: "ALLOW";
	decisionPath: ExecutorDecisionPath;
	approval: ExecutorApprovalState;
}

/**
 * The concrete, durable precondition established by an executor at the
 * effect boundary. It is a semantic fingerprint: enough to revalidate an
 * Approval binding and to reality-reconcile after a lost response/restart.
 */
export type ExecutorPrecondition =
	| {
			kind: "file.write";
			capability: "file.write";
			path: string;
			beforeHash?: string;
			expectedAfterHash: string;
	  }
	| {
			kind: "git.commit";
			capability: "git.commit";
			beforeHead: string;
			beforeIndexHash: string;
			message: string;
			paths?: string[];
	  }
	| {
			kind: "install-dependency";
			capability: "project.installDependency";
			packageManager: "pnpm" | "npm" | "yarn";
			packageName: string;
			manifestPackageName?: string;
			receiptFile: string;
			requested: string;
			dev: boolean;
			beforeManifestHash: string;
			beforeLockHash?: string;
			beforeDeclaration?: string;
	  }
	| {
			kind: "process.start";
			capability: "process.start";
			processRef: string;
			mode: "one-shot" | "managed";
			readiness?:
				| { kind: "port"; port: number }
				| { kind: "http"; url: string }
				| { kind: "log"; pattern: string };
	  }
	| {
			kind: "process.stop";
			capability: "process.stop";
			processRef: string;
			pid?: number;
			birthIdentity?: string;
	  }
	| {
			kind: "browser";
			capability: BrowserCapabilityId;
			roleRef?: string;
			workerRef?: string;
			taskId?: string;
			targetRef?: string;
			fingerprint?: string;
			roleUrl?: string;
			conversationUrl?: string;
			messageRef?: string;
			expectedUrl?: string;
	  }
	| {
			kind: "opaque";
			capability: ExecutionCapabilityId;
	  };

export interface ExecutorArtifact {
	ref: string;
	path: string;
	bytes: number;
	stream: "stdout" | "stderr" | "report";
	kind?: "output" | "external-file" | "context-pack" | "patch-proposal";
	hash?: string;
	mime?: string;
}

export interface ExecutorResult {
	result: ExecutionCapabilityResult;
	evidence: ExecutionEvidence[];
	artifacts: ExecutorArtifact[];
	precondition?: ExecutorPrecondition;
	effectApplied: boolean;
	successful: boolean;
}

export interface ExecutorInvocation {
	request: ExecuteCapabilityRequest;
	admission: ExecutorAdmission;
	signal?: AbortSignal;
	onEffectStarted?: (
		precondition: ExecutorPrecondition,
	) => void | Promise<void>;
}

export interface ExecutorReconciliation {
	state: "APPLIED" | "NOT_APPLIED" | "UNKNOWN";
	evidence: ExecutionEvidence[];
	result?: ExecutionCapabilityResult;
}

export interface ExecutorArtifactRead {
	chunk: string;
	nextOffset: number;
	eof: boolean;
	bytes: number;
}

export interface ExecutionExecutorPort {
	execute(invocation: ExecutorInvocation): Promise<ExecutorResult>;
	reconcile(
		request: ExecuteCapabilityRequest,
		precondition: ExecutorPrecondition,
	): Promise<ExecutorReconciliation>;
	readArtifact(
		ref: string,
		offset?: number,
		limit?: number,
	): Promise<ExecutorArtifactRead>;
}
