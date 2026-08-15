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

export interface TaskObserverOwnerPort {
	getTaskDriveProjection(taskId: string): Promise<TaskDriveProjection>;
}

export interface TaskObserverCarrierPort {
	requestWake(input: {
		taskId: string;
		nodeId: string;
		runNo: number;
		workerRef: string;
		trigger: string;
		conversationLocator: string | null;
	}): Promise<unknown>;
}

export type TaskObserverDecision =
	| {
			kind: "WAKE";
			taskId: string;
			nodeId: string;
			runNo: number;
			workerRef: string;
			trigger: string;
			conversationLocator: string | null;
	  }
	| {
			kind: "RESUME";
			taskId: string;
			nodeId: string;
			runNo: number;
			workerRef: string;
			trigger: string;
	  }
	| { kind: "STOP_DRIVING"; taskId: string; reason: "TERMINAL" }
	| { kind: "NOOP"; taskId: string; reason: string };

const NODE_READY_TRIGGER = "NODE_READY";

export function createTaskObserver(options: {
	owner: TaskObserverOwnerPort;
	carrier: TaskObserverCarrierPort;
}) {
	const advance = async (taskId: string): Promise<TaskObserverDecision> => {
		const projection = await options.owner.getTaskDriveProjection(taskId);
		// Terminal Tasks stop driving; history and bindings are retained.
		if (projection.terminal || projection.currentNode === null)
			return { kind: "STOP_DRIVING", taskId, reason: "TERMINAL" };
		const node = projection.currentNode;
		const binding = projection.roleBinding;
		if (!projection.canDrive || !binding?.workerRef || !binding.conversationLocator)
			return { kind: "NOOP", taskId, reason: "BINDING_NOT_READY" };
		if (node.status === "READY") {
			// WAKE the correct Worker with a minimal trigger; the Worker then
			// performs formal work acceptance through the Task owner.
			return {
				kind: "WAKE",
				taskId,
				nodeId: node.nodeId,
				runNo: node.runNo,
				workerRef: binding.workerRef,
				trigger: NODE_READY_TRIGGER,
				conversationLocator: binding.conversationLocator,
			};
		}
		return { kind: "NOOP", taskId, reason: "NO_NEXT_STEP" };
	};

	const drive = async (taskId: string): Promise<TaskObserverDecision> => {
		const decision = await advance(taskId);
		if (decision.kind === "WAKE")
			await options.carrier.requestWake({
				taskId: decision.taskId,
				nodeId: decision.nodeId,
				runNo: decision.runNo,
				workerRef: decision.workerRef,
				trigger: decision.trigger,
				conversationLocator: decision.conversationLocator,
			});
		return decision;
	};

	return Object.freeze({ advance, drive });
}
