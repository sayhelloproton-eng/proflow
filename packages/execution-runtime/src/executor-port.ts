/**
 * Compatibility re-export. The structural Executor Port contract is owned by
 * execution-contracts so concrete executors do not depend back on runtime.
 */
export type {
	ExecutionExecutorPort,
	ExecutorAdmission,
	ExecutorApprovalState,
	ExecutorArtifact,
	ExecutorArtifactRead,
	ExecutorDecisionPath,
	ExecutorInvocation,
	ExecutorPrecondition,
	ExecutorReconciliation,
	ExecutorResult,
} from "@tomflow/proflow-execution-contracts";
