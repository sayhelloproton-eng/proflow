export type TaskDriveProjection = {
	taskId: string;
	taskStatus: string;
	taskVersion: number;
	terminal: boolean;
	currentNode: {
		nodeId: string;
		status: string;
		version: number;
		runNo: number;
		requiredAgentPackageRef: string;
	} | null;
	roleBinding: {
		agentPackageRef: string;
		roleRef: string;
		workerRef: string | null;
		conversationLocator: string | null;
	} | null;
	canDrive: boolean;
	blockedReason: string | null;
	resumeSignalRef: string | null;
};

export type TaskResumeSignal = {
	trigger:
		| "EXECUTION_RESULT_READY"
		| "PEER_REPLY_READY"
		| "RECOVERY_RESUME"
		| "TASK_RESUMED";
	ref: string;
	targetWorkerRef: string;
	nodeId: string;
	runNo: number;
};
export type TaskProgressionDecision =
	| {
			kind: "WAKE";
			taskId: string;
			nodeId: string;
			runNo: number;
			roleRef: string;
			workerRef: string;
			trigger: string;
			conversationLocator: string;
			underlyingRef?: string;
	  }
	| { kind: "STOP_DRIVING"; taskId: string; reason: "TERMINAL" }
	| { kind: "NOOP"; taskId: string; reason: string };

export function decideTaskProgression(
	projection: TaskDriveProjection,
	resumeSignal?: TaskResumeSignal,
): TaskProgressionDecision {
	if (projection.terminal)
		return {
			kind: "STOP_DRIVING",
			taskId: projection.taskId,
			reason: "TERMINAL",
		};
	if (projection.currentNode === null)
		return {
			kind: "NOOP",
			taskId: projection.taskId,
			reason: "NO_CURRENT_NODE",
		};
	const node = projection.currentNode;
	const binding = projection.roleBinding;
	if (
		!binding?.workerRef ||
		!binding.conversationLocator ||
		binding.agentPackageRef !== node.requiredAgentPackageRef
	)
		return {
			kind: "NOOP",
			taskId: projection.taskId,
			reason: "BINDING_NOT_READY",
		};
	if (node.status === "READY") {
		if (!projection.canDrive)
			return {
				kind: "NOOP",
				taskId: projection.taskId,
				reason: "BINDING_NOT_READY",
			};
		return {
			kind: "WAKE",
			taskId: projection.taskId,
			nodeId: node.nodeId,
			runNo: node.runNo,
			roleRef: binding.roleRef,
			workerRef: binding.workerRef,
			trigger: node.runNo > 1 ? "REOPEN" : "NODE_READY",
			conversationLocator: binding.conversationLocator,
		};
	}
	const effectiveResumeSignal =
		resumeSignal ??
		(projection.resumeSignalRef &&
		projection.taskStatus === "ACTIVE" &&
		node.status === "IN_PROGRESS"
			? {
					trigger: "TASK_RESUMED" as const,
					ref: projection.resumeSignalRef,
					targetWorkerRef: binding.workerRef,
					nodeId: node.nodeId,
					runNo: node.runNo,
				}
			: undefined);
	if (!effectiveResumeSignal)
		return {
			kind: "NOOP",
			taskId: projection.taskId,
			reason: "NO_PROGRESS_INTENT",
		};
	if (projection.taskStatus !== "ACTIVE" || node.status !== "IN_PROGRESS")
		return {
			kind: "NOOP",
			taskId: projection.taskId,
			reason: "BINDING_NOT_READY",
		};
	if (
		effectiveResumeSignal.nodeId !== node.nodeId ||
		effectiveResumeSignal.runNo !== node.runNo
	)
		return {
			kind: "NOOP",
			taskId: projection.taskId,
			reason: "RESUME_GENERATION_MISMATCH",
		};
	if (effectiveResumeSignal.targetWorkerRef !== binding.workerRef)
		return {
			kind: "NOOP",
			taskId: projection.taskId,
			reason: "RESUME_TARGET_NOT_CURRENT_WORKER",
		};
	return {
		kind: "WAKE",
		taskId: projection.taskId,
		nodeId: node.nodeId,
		runNo: node.runNo,
		roleRef: binding.roleRef,
		workerRef: binding.workerRef,
		trigger: effectiveResumeSignal.trigger,
		conversationLocator: binding.conversationLocator,
		underlyingRef: effectiveResumeSignal.ref,
	};
}
