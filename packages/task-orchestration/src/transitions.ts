import type { NodeStatus, TaskGroupStatus, TaskStatus } from "./model.ts";

function assertTransition<T extends string>(
	from: T,
	to: T,
	allowed: Readonly<Record<T, readonly T[]>>,
): void {
	if (!allowed[from].includes(to))
		throw new Error(`illegal transition ${from} -> ${to}`);
}

const taskTransitions: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
	PENDING: ["READY", "TERMINATED"],
	READY: ["ACTIVE", "TERMINATED"],
	ACTIVE: ["WAITING", "PAUSED", "FAILED", "SUCCEEDED", "TERMINATED"],
	WAITING: ["ACTIVE", "PAUSED", "TERMINATED"],
	FAILED: ["PAUSED", "TERMINATED"],
	PAUSED: ["ACTIVE", "TERMINATED"],
	SUCCEEDED: [],
	TERMINATED: [],
};
const groupTransitions: Readonly<
	Record<TaskGroupStatus, readonly TaskGroupStatus[]>
> = { READY: ["ACTIVE"], ACTIVE: ["SUCCEEDED"], SUCCEEDED: [] };
const nodeTransitions: Readonly<Record<NodeStatus, readonly NodeStatus[]>> = {
	PENDING: ["READY", "TERMINATED"],
	READY: ["IN_PROGRESS", "TERMINATED"],
	IN_PROGRESS: ["WAITING", "FAILED", "SUCCEEDED", "TERMINATED"],
	WAITING: ["IN_PROGRESS", "TERMINATED"],
	FAILED: ["READY", "TERMINATED"],
	SUCCEEDED: [],
	TERMINATED: [],
};

export const assertTaskTransition = (from: TaskStatus, to: TaskStatus): void =>
	assertTransition(from, to, taskTransitions);
export const assertTaskGroupTransition = (
	from: TaskGroupStatus,
	to: TaskGroupStatus,
): void => assertTransition(from, to, groupTransitions);
export const assertNodeTransition = (from: NodeStatus, to: NodeStatus): void =>
	assertTransition(from, to, nodeTransitions);
