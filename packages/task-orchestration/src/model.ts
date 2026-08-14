export type TaskGroupStatus = "READY" | "ACTIVE" | "SUCCEEDED";
export type TaskStatus =
	| "PENDING"
	| "READY"
	| "ACTIVE"
	| "WAITING"
	| "FAILED"
	| "PAUSED"
	| "SUCCEEDED"
	| "TERMINATED";
export type NodeStatus =
	| "PENDING"
	| "READY"
	| "IN_PROGRESS"
	| "WAITING"
	| "FAILED"
	| "SUCCEEDED"
	| "TERMINATED";

export interface TaskGroup {
	taskGroupId: string;
	title: string;
	objective: string | null;
	status: TaskGroupStatus;
	maxActiveTasks: 1;
	version: number;
	createdByRef: string;
	createdAt: string;
	updatedAt: string;
}

export interface Task {
	taskId: string;
	taskGroupId: string | null;
	sequenceNo: number | null;
	title: string;
	objective: string;
	status: TaskStatus;
	version: number;
	planVersion: number;
	currentNodeId: string | null;
	createdByRef: string;
	createdAt: string;
	startedAt: string | null;
	completedAt: string | null;
	updatedAt: string;
}

export interface TaskNode {
	nodeId: string;
	taskId: string;
	sequenceNo: number;
	title: string;
	objective: string;
	status: NodeStatus;
	version: number;
	runNo: number;
	requiredAgentPackageRef: string;
	workerRef: string | null;
	inputDocuments: string[];
	outputDocuments: string[];
	resultSummary: string | null;
	errorCode: string | null;
	errorMessage: string | null;
	errorRetryable: boolean | null;
	startedAt: string | null;
	completedAt: string | null;
	updatedAt: string;
}

export interface TaskRoleBinding {
	taskId: string;
	agentPackageRef: string;
	roleRef: string;
	workerRef: string | null;
	conversationLocator: string | null;
	version: number;
	createdAt: string;
	updatedAt: string;
}

export interface NodeExecutionHistory {
	executionId?: number;
	taskId: string;
	nodeId: string;
	runNo: number;
	workerRef: string | null;
	finalStatus: NodeStatus;
	resultSummary: string | null;
	errorCode: string | null;
	errorMessage: string | null;
	errorRetryable: boolean | null;
	inputDocuments: string[];
	outputDocuments: string[];
	startedAt: string | null;
	endedAt: string;
}

export interface TaskDocument {
	taskId: string;
	documentType: string;
	sourceNodeId: string | null;
	filePath: string;
	contentHash: string;
	updatedByRef: string;
	updatedAt: string;
}

export interface TaskMessage {
	messageId: string;
	taskId: string;
	nodeId: string | null;
	messageType: string;
	reasonCode: string;
	message: string;
	relatedRef: string | null;
	status: "PENDING" | "ACKNOWLEDGED";
	createdByRef: string;
	createdAt: string;
	acknowledgedByRef: string | null;
	acknowledgedAt: string | null;
	resolution: string | null;
}

export interface TaskEvent {
	eventId?: number;
	taskId: string;
	nodeId: string | null;
	eventType: string;
	actorRef: string;
	taskVersion: number | null;
	nodeVersion: number | null;
	payload: Record<string, unknown> | null;
	createdAt: string;
}

export interface IdempotencyRecord {
	idempotencyKey: string;
	operation: string;
	requestHash: string;
	responseJson: string;
	createdAt: string;
}

export interface TaskRepositories {
	taskGroups: {
		get(id: string): TaskGroup | undefined;
		insert(value: TaskGroup): void;
		update(value: TaskGroup): void;
		list(): TaskGroup[];
	};
	tasks: {
		get(id: string): Task | undefined;
		insert(value: Task): void;
		update(value: Task): void;
		list(groupId?: string): Task[];
	};
	nodes: {
		get(id: string): TaskNode | undefined;
		insert(value: TaskNode): void;
		update(value: TaskNode): void;
		listByTask(taskId: string): TaskNode[];
	};
	roleBindings: {
		get(taskId: string, agentPackageRef: string): TaskRoleBinding | undefined;
		upsert(value: TaskRoleBinding): void;
		listByTask(taskId: string): TaskRoleBinding[];
	};
	executionHistory: {
		insert(value: NodeExecutionHistory): void;
		listByTask(taskId: string): NodeExecutionHistory[];
	};
	documents: {
		get(taskId: string, type: string): TaskDocument | undefined;
		upsert(value: TaskDocument): void;
		listByTask(taskId: string): TaskDocument[];
	};
	messages: {
		get(id: string): TaskMessage | undefined;
		insert(value: TaskMessage): void;
		update(value: TaskMessage): void;
		listPending(): TaskMessage[];
	};
	events: {
		insert(value: TaskEvent): void;
		listByTask(taskId: string): TaskEvent[];
	};
	idempotency: {
		get(key: string): IdempotencyRecord | undefined;
		insert(value: IdempotencyRecord): void;
	};
}

export interface TaskStore {
	transaction<T>(work: (repositories: TaskRepositories) => T): T;
	read<T>(work: (repositories: TaskRepositories) => T): T;
}

export type TaskResult<T> =
	| {
			contract: "task-orchestration";
			contractVersion: "1.0.0";
			ok: true;
			data: T;
	  }
	| {
			contract: "task-orchestration";
			contractVersion: "1.0.0";
			ok: false;
			error: {
				code: string;
				message: string;
				retryable: boolean;
				correlationId: string;
				details?: Record<string, unknown>;
			};
	  };
