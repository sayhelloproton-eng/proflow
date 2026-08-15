/**
 * Deterministic Task Observer.
 *
 * The Task Observer is a progression detector in the Extension application
 * layer. It reads the bounded read-only drive projection exposed by the Task
 * owner and, on a deterministic condition, requests a typed carrier action
 * such as WAKE or RESUME. It never writes Task or Node state itself; the
 * Worker performs formal work acceptance after being woken.
 */

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
};

export type TaskObserverResumeSignal = {
	trigger: "EXECUTION_RESULT_READY" | "PEER_REPLY_READY" | "RECOVERY_RESUME";
	ref: string;
	targetWorkerRef: string;
};

export type TaskObserverAnomalySignal = {
	kind: "FACT_CONFLICT" | "UNKNOWN_REALITY" | "STALLED" | "RECOVERY_FAILED";
	ref: string;
	facts: Record<string, string | number | boolean | null>;
};

export type TaskObserverDiagnosticAssessment = {
	finding: string;
	probableCause: string;
	confidence: number;
	recommendedNextObservation: string;
	recommendedRecoveryAction: string;
	needsHumanAttention: boolean;
};

export interface TaskObserverDiagnosticPort {
	assess(input: {
		taskId: string;
		nodeId: string;
		runNo: number;
		anomaly: TaskObserverAnomalySignal;
	}): Promise<TaskObserverDiagnosticAssessment>;
}

export interface TaskObserverOwnerPort {
	getTaskDriveProjection(taskId: string): Promise<TaskDriveProjection>;
}

export interface TaskObserverCarrierPort {
	requestWake(input: {
		taskId: string;
		nodeId: string;
		runNo: number;
		roleRef: string;
		workerRef: string;
		trigger: string;
		conversationLocator: string | null;
		underlyingRef?: string;
	}): Promise<unknown>;
}

export type TaskObserverDecision =
	| {
			kind: "WAKE";
			taskId: string;
			nodeId: string;
			runNo: number;
			roleRef: string;
			workerRef: string;
			trigger: string;
			conversationLocator: string | null;
	  }
	| {
			kind: "RESUME";
			taskId: string;
			nodeId: string;
			runNo: number;
			roleRef: string;
			workerRef: string;
			trigger: string;
			conversationLocator: string;
			underlyingRef: string;
	  }
	| {
			kind: "DIAGNOSTIC";
			taskId: string;
			nodeId: string;
			runNo: number;
			anomalyRef: string;
			assessment: TaskObserverDiagnosticAssessment;
	  }
	| { kind: "STOP_DRIVING"; taskId: string; reason: "TERMINAL" }
	| { kind: "NOOP"; taskId: string; reason: string };

const NODE_READY_TRIGGER = "NODE_READY";
const REOPEN_TRIGGER = "REOPEN";

export function createTaskObserver(options: {
	owner: TaskObserverOwnerPort;
	carrier: TaskObserverCarrierPort;
	diagnostic?: TaskObserverDiagnosticPort;
}) {
	const advance = async (
		taskId: string,
		resumeSignal?: TaskObserverResumeSignal,
		anomalySignal?: TaskObserverAnomalySignal,
	): Promise<TaskObserverDecision> => {
		const projection = await options.owner.getTaskDriveProjection(taskId);
		// Terminal Tasks stop driving; history and bindings are retained.
		if (projection.terminal || projection.currentNode === null)
			return { kind: "STOP_DRIVING", taskId, reason: "TERMINAL" };
		const node = projection.currentNode;
		if (anomalySignal) {
			if (!options.diagnostic)
				return { kind: "NOOP", taskId, reason: "DIAGNOSTIC_UNAVAILABLE" };
			const assessment = await options.diagnostic.assess({
				taskId,
				nodeId: node.nodeId,
				runNo: node.runNo,
				anomaly: anomalySignal,
			});
			return {
				kind: "DIAGNOSTIC",
				taskId,
				nodeId: node.nodeId,
				runNo: node.runNo,
				anomalyRef: anomalySignal.ref,
				assessment,
			};
		}
		const binding = projection.roleBinding;
		if (
			!projection.canDrive ||
			!binding?.workerRef ||
			!binding.conversationLocator
		)
			return { kind: "NOOP", taskId, reason: "BINDING_NOT_READY" };
		if (node.status === "READY") {
			// WAKE the correct Worker with a minimal trigger; the Worker then
			// performs formal work acceptance through the Task owner. A reopened
			// run reuses the same TaskRoleBinding/Conversation but keeps the reason
			// distinct from a first-run NODE_READY wake.
			return {
				kind: "WAKE",
				taskId,
				nodeId: node.nodeId,
				runNo: node.runNo,
				roleRef: binding.roleRef,
				workerRef: binding.workerRef,
				trigger: node.runNo > 1 ? REOPEN_TRIGGER : NODE_READY_TRIGGER,
				conversationLocator: binding.conversationLocator,
			};
		}
		if (resumeSignal) {
			if (resumeSignal.targetWorkerRef !== binding.workerRef)
				return {
					kind: "NOOP",
					taskId,
					reason: "RESUME_TARGET_NOT_CURRENT_WORKER",
				};
			return {
				kind: "RESUME",
				taskId,
				nodeId: node.nodeId,
				runNo: node.runNo,
				roleRef: binding.roleRef,
				workerRef: binding.workerRef,
				trigger: resumeSignal.trigger,
				conversationLocator: binding.conversationLocator,
				underlyingRef: resumeSignal.ref,
			};
		}
		return { kind: "NOOP", taskId, reason: "NO_NEXT_STEP" };
	};

	const drive = async (
		taskId: string,
		resumeSignal?: TaskObserverResumeSignal,
		anomalySignal?: TaskObserverAnomalySignal,
	): Promise<TaskObserverDecision> => {
		const decision = await advance(taskId, resumeSignal, anomalySignal);
		if (decision.kind === "WAKE" || decision.kind === "RESUME")
			await options.carrier.requestWake({
				taskId: decision.taskId,
				nodeId: decision.nodeId,
				runNo: decision.runNo,
				roleRef: decision.roleRef,
				workerRef: decision.workerRef,
				trigger: decision.trigger,
				conversationLocator: decision.conversationLocator,
				...(decision.kind === "RESUME"
					? { underlyingRef: decision.underlyingRef }
					: {}),
			});
		return decision;
	};

	return Object.freeze({ advance, drive });
}
