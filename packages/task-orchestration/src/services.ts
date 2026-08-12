import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { ZodError } from "zod";

import { type PublicOperationName, validatePublicInput } from "./contracts.ts";
import type {
	NodeStatus,
	Task,
	TaskDocument,
	TaskEvent,
	TaskGroup,
	TaskMessage,
	TaskNode,
	TaskRepositories,
	TaskResult,
	TaskRoleBinding,
	TaskStore,
} from "./model.ts";

const allowedDocumentTypes = [
	"REQUIREMENT",
	"PRD",
	"TECHNICAL_DESIGN",
	"TEST_PLAN",
	"TEST_RESULT",
	"RELEASE_RESULT",
] as const;
type DocumentType = (typeof allowedDocumentTypes)[number];

interface Controls {
	actorRef: string;
	idempotencyKey: string;
}
interface TaskControls extends Controls {
	taskId: string;
	expectedTaskVersion: number;
}
interface NodeControls extends TaskControls {
	nodeId: string;
	expectedNodeVersion: number;
}
interface CreateGroupInput extends Controls {
	taskGroupId?: string;
	title: string;
	objective?: string;
	maxActiveTasks: 1;
}
interface StartGroupInput extends Controls {
	taskGroupId: string;
	expectedGroupVersion: number;
}
interface PlanNodeInput {
	nodeId?: string;
	title: string;
	objective: string;
	requiredRoleRef: string;
	inputDocuments: string[];
	outputDocuments: string[];
}
interface CreateTaskInput extends Controls {
	taskId?: string;
	taskGroupId?: string;
	sequenceNo?: number;
	title: string;
	objective: string;
	plan: { nodes: PlanNodeInput[] };
	initialDocuments: Array<{ documentType: string; content: string }>;
	roleBindings: Array<{ roleRef: string; workerRef: string | null }>;
}
interface BindInput extends TaskControls {
	roleRef: string;
	workerRef: string;
}
interface ReasonInput extends TaskControls {
	reason: string;
}
interface CompleteInput extends NodeControls {
	resultSummary: string;
}
interface WaitInput extends NodeControls {
	waitType: string;
	reasonCode: string;
	message: string;
	relatedRef?: string;
}
interface FailInput extends NodeControls {
	errorCode: string;
	errorMessage: string;
	retryable: boolean;
}
interface ReopenInput extends TaskControls {
	nodeId: string;
	reason: string;
}
interface AckInput extends Controls {
	messageId: string;
	resolution?: string;
}
interface PutDocumentInput extends TaskControls {
	nodeId: string;
	documentType: string;
	content: string;
}

export interface TaskSummary extends Task {
	canStart: boolean;
	blockedReason: string | null;
}
export interface TaskView extends Task {
	nodes: TaskNode[];
	roleBindings: TaskRoleBinding[];
	executionHistory: ReturnType<
		TaskRepositories["executionHistory"]["listByTask"]
	>;
	documents: TaskDocument[];
}
export interface NodeResult {
	taskId: string;
	nodeId: string;
	taskVersion: number;
	nodeVersion: number;
	taskStatus: Task["status"];
	nodeStatus: NodeStatus;
	runNo: number;
	workerRef: string | null;
}
export interface DocumentResult {
	taskId: string;
	nodeId?: string;
	documentType: string;
	path: string;
	contentHash: string;
	sizeBytes: number;
	taskVersion: number;
	updatedAt: string;
	content?: string;
}

class DomainError extends Error {
	readonly code: string;
	readonly retryable: boolean;
	readonly details: Record<string, unknown> | undefined;
	constructor(
		code: string,
		message: string,
		retryable = false,
		details?: Record<string, unknown>,
	) {
		super(message);
		this.code = code;
		this.retryable = retryable;
		this.details = details;
	}
}

const success = <T>(data: T): TaskResult<T> => ({
	contract: "task-orchestration",
	contractVersion: "1.0.0",
	ok: true,
	data,
});
const failure = (error: unknown): TaskResult<never> => {
	const domain = error instanceof DomainError ? error : undefined;
	return {
		contract: "task-orchestration",
		contractVersion: "1.0.0",
		ok: false,
		error: {
			code:
				domain?.code ??
				(error instanceof ZodError ? "INVALID_REQUEST" : "INTERNAL_ERROR"),
			message:
				domain?.message ??
				(error instanceof Error ? error.message : "unexpected error"),
			category: domain?.code.endsWith("CONFLICT")
				? "CONFLICT"
				: error instanceof ZodError
					? "VALIDATION"
					: "DOMAIN",
			retryable: domain?.retryable ?? false,
			correlationId: `corr-${randomUUID()}`,
			...(domain?.details === undefined ? {} : { details: domain.details }),
		},
	};
};
function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value !== null && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, item]) => [key, canonical(item)]),
		);
	return value;
}
const hash = (value: unknown): string =>
	`sha256:${createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex")}`;
const contentHash = (value: string): string =>
	`sha256:${createHash("sha256").update(value).digest("hex")}`;
const auditEventTypes: Partial<Record<PublicOperationName, string>> = {
	authorizeTask: "TASK_AUTHORIZED",
	bindTaskWorker: "TASK_ROLE_BOUND",
	startTask: "TASK_STARTED",
	pauseTask: "TASK_PAUSED",
	resumeTask: "TASK_RESUMED",
	terminateTask: "TASK_TERMINATED",
	startNode: "NODE_STARTED",
	completeNode: "NODE_COMPLETED",
	waitNode: "NODE_WAITING",
	failNode: "NODE_FAILED",
};

function requireTask(tx: TaskRepositories, id: string): Task {
	const value = tx.tasks.get(id);
	if (!value)
		throw new DomainError("TASK_NOT_FOUND", `Task ${id} was not found.`);
	return value;
}
function requireNode(
	tx: TaskRepositories,
	taskId: string,
	nodeId: string,
): TaskNode {
	const value = tx.nodes.get(nodeId);
	if (!value || value.taskId !== taskId)
		throw new DomainError("NODE_NOT_FOUND", `Node ${nodeId} was not found.`);
	return value;
}
function checkVersion(actual: number, expected: number, code: string): void {
	if (actual !== expected)
		throw new DomainError(code, "Version does not match.", true, {
			expected,
			actual,
		});
}
function event(
	tx: TaskRepositories,
	value: Omit<TaskEvent, "createdAt">,
	now: string,
): void {
	tx.events.insert({ ...value, createdAt: now });
}
function nodeResult(task: Task, node: TaskNode): NodeResult {
	return {
		taskId: task.taskId,
		nodeId: node.nodeId,
		taskVersion: task.version,
		nodeVersion: node.version,
		taskStatus: task.status,
		nodeStatus: node.status,
		runNo: node.runNo,
		workerRef: node.workerRef,
	};
}

export function createTaskServices(options: {
	store: TaskStore;
	workspaceRoot: string;
	now?: () => string;
	createId?: (prefix: string) => string;
}) {
	const { store, workspaceRoot } = options;
	const now = options.now ?? (() => new Date().toISOString());
	const createId =
		options.createId ?? ((prefix: string) => `${prefix}-${randomUUID()}`);

	function command<I, O>(
		operation: PublicOperationName,
		raw: unknown,
		work: (tx: TaskRepositories, input: I, timestamp: string) => O,
	): TaskResult<O> {
		try {
			const input = validatePublicInput(operation, raw) as I;
			const controls = input as I & Controls;
			return store.transaction((tx) => {
				const requestHash = hash(input);
				const prior = tx.idempotency.get(controls.idempotencyKey);
				if (prior) {
					if (
						prior.operation !== operation ||
						prior.requestHash !== requestHash
					)
						throw new DomainError(
							"IDEMPOTENCY_CONFLICT",
							"Idempotency key has a different request fingerprint.",
						);
					return JSON.parse(prior.responseJson) as TaskResult<O>;
				}
				const timestamp = now();
				const data = work(tx, input, timestamp);
				const auditEventType = auditEventTypes[operation];
				if (auditEventType && typeof input === "object" && input !== null) {
					const taskId = Reflect.get(input, "taskId");
					const nodeId = Reflect.get(input, "nodeId");
					if (typeof taskId === "string") {
						const task = tx.tasks.get(taskId);
						const node =
							typeof nodeId === "string" ? tx.nodes.get(nodeId) : undefined;
						event(
							tx,
							{
								taskId,
								nodeId: typeof nodeId === "string" ? nodeId : null,
								eventType: auditEventType,
								actorRef: controls.actorRef,
								taskVersion: task?.version ?? null,
								nodeVersion: node?.version ?? null,
								payload: null,
							},
							timestamp,
						);
					}
				}
				const result = success(data);
				tx.idempotency.insert({
					idempotencyKey: controls.idempotencyKey,
					operation,
					requestHash,
					responseJson: JSON.stringify(result),
					createdAt: timestamp,
				});
				return result;
			});
		} catch (error) {
			return failure(error);
		}
	}

	function query<I, O>(
		operation: PublicOperationName,
		raw: unknown,
		work: (tx: TaskRepositories, input: I) => O,
	): TaskResult<O> {
		try {
			const input = validatePublicInput(operation, raw) as I;
			return success(store.read((tx) => work(tx, input)));
		} catch (error) {
			return failure(error);
		}
	}

	const view = (tx: TaskRepositories, task: Task): TaskView => ({
		...task,
		nodes: tx.nodes.listByTask(task.taskId),
		roleBindings: tx.roleBindings.listByTask(task.taskId),
		executionHistory: tx.executionHistory.listByTask(task.taskId),
		documents: tx.documents.listByTask(task.taskId),
	});
	const relativeDocumentPath = (taskId: string, type: DocumentType): string =>
		`.proflow/tasks/${/^[A-Za-z0-9_-]+$/.test(taskId) ? taskId : `id-${createHash("sha256").update(taskId).digest("hex")}`}/documents/${type.toLowerCase().replaceAll("_", "-")}.md`;
	const ensureType = (value: string): DocumentType => {
		if (!allowedDocumentTypes.includes(value as DocumentType))
			throw new DomainError(
				"DOCUMENT_TYPE_NOT_ALLOWED",
				`Document type ${value} is not allowed.`,
			);
		return value as DocumentType;
	};
	const atomicWrite = (relativePath: string, content: string): void => {
		const path = join(workspaceRoot, relativePath);
		const directory = dirname(path);
		mkdirSync(directory, { recursive: true });
		const temporary = `${path}.tmp-${randomUUID()}`;
		writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
		const descriptor = openSync(temporary, "r");
		try {
			fsyncSync(descriptor);
		} finally {
			closeSync(descriptor);
		}
		renameSync(temporary, path);
		const directoryDescriptor = openSync(directory, "r");
		try {
			fsyncSync(directoryDescriptor);
		} finally {
			closeSync(directoryDescriptor);
		}
	};

	const commands = {
		createTaskGroup: (raw: unknown): TaskResult<TaskGroup> =>
			command<CreateGroupInput, TaskGroup>(
				"createTaskGroup",
				raw,
				(tx, input, timestamp) => {
					const taskGroupId = input.taskGroupId ?? createId("task-group");
					if (tx.taskGroups.get(taskGroupId))
						throw new DomainError(
							"TASK_GROUP_ALREADY_EXISTS",
							"TaskGroup already exists.",
						);
					const value: TaskGroup = {
						taskGroupId,
						title: input.title,
						objective: input.objective ?? null,
						status: "READY",
						maxActiveTasks: 1,
						version: 1,
						createdByRef: input.actorRef,
						createdAt: timestamp,
						updatedAt: timestamp,
					};
					tx.taskGroups.insert(value);
					return value;
				},
			),
		startTaskGroup: (
			raw: unknown,
		): TaskResult<TaskGroup & { firstEligibleTaskId: string | null }> =>
			command<
				StartGroupInput,
				TaskGroup & { firstEligibleTaskId: string | null }
			>("startTaskGroup", raw, (tx, input, timestamp) => {
				const group = tx.taskGroups.get(input.taskGroupId);
				if (!group)
					throw new DomainError(
						"TASK_GROUP_NOT_FOUND",
						"TaskGroup was not found.",
					);
				checkVersion(
					group.version,
					input.expectedGroupVersion,
					"TASK_GROUP_VERSION_CONFLICT",
				);
				if (group.status !== "READY")
					throw new DomainError(
						"TASK_GROUP_STATE_CONFLICT",
						"TaskGroup is not READY.",
					);
				const first = tx.tasks
					.list(group.taskGroupId)
					.find((item) => item.status === "PENDING");
				const updated = {
					...group,
					status: "ACTIVE" as const,
					version: group.version + 1,
					updatedAt: timestamp,
				};
				tx.taskGroups.update(updated);
				if (first)
					tx.tasks.update({
						...first,
						status: "READY",
						version: first.version + 1,
						updatedAt: timestamp,
					});
				return { ...updated, firstEligibleTaskId: first?.taskId ?? null };
			}),
		createTask: (raw: unknown): TaskResult<Task> => {
			try {
				const input = validatePublicInput("createTask", raw) as CreateTaskInput;
				for (const document of input.initialDocuments)
					ensureType(document.documentType);
				for (const node of input.plan.nodes)
					for (const documentType of [
						...node.inputDocuments,
						...node.outputDocuments,
					])
						ensureType(documentType);
				if (
					new Set(input.initialDocuments.map((item) => item.documentType))
						.size !== input.initialDocuments.length
				)
					throw new DomainError(
						"INVALID_REQUEST",
						"Initial documentType values must be unique.",
					);
				if (
					new Set(input.roleBindings.map((item) => item.roleRef)).size !==
					input.roleBindings.length
				)
					throw new DomainError(
						"INVALID_REQUEST",
						"Task role bindings must be unique by roleRef.",
					);
			} catch (error) {
				return failure(error);
			}
			return command<CreateTaskInput, Task>(
				"createTask",
				raw,
				(tx, validated, timestamp) => {
					const taskId = validated.taskId ?? createId("task");
					if (tx.tasks.get(taskId))
						throw new DomainError(
							"TASK_ALREADY_EXISTS",
							"Task already exists.",
						);
					if (
						validated.taskGroupId &&
						!tx.taskGroups.get(validated.taskGroupId)
					)
						throw new DomainError(
							"TASK_GROUP_NOT_FOUND",
							"TaskGroup was not found.",
						);
					const value: Task = {
						taskId,
						taskGroupId: validated.taskGroupId ?? null,
						sequenceNo: validated.sequenceNo ?? null,
						title: validated.title,
						objective: validated.objective,
						status: "PENDING",
						version: 1,
						planVersion: 1,
						currentNodeId: null,
						createdByRef: validated.actorRef,
						authorizedByRef: null,
						authorizedAt: null,
						createdAt: timestamp,
						startedAt: null,
						completedAt: null,
						updatedAt: timestamp,
					};
					tx.tasks.insert(value);
					validated.plan.nodes.forEach((item, index) => {
						tx.nodes.insert({
							nodeId: item.nodeId ?? createId("node"),
							taskId,
							sequenceNo: index + 1,
							title: item.title,
							objective: item.objective,
							status: "PENDING",
							version: 1,
							runNo: 1,
							requiredRoleRef: item.requiredRoleRef,
							workerRef: null,
							inputDocuments: item.inputDocuments,
							outputDocuments: item.outputDocuments,
							resultSummary: null,
							errorCode: null,
							errorMessage: null,
							errorRetryable: null,
							startedAt: null,
							completedAt: null,
							updatedAt: timestamp,
						});
					});
					for (const item of validated.roleBindings)
						tx.roleBindings.upsert({
							taskId,
							roleRef: item.roleRef,
							workerRef: item.workerRef,
							version: 1,
							createdAt: timestamp,
							updatedAt: timestamp,
						});
					for (const item of validated.initialDocuments) {
						const path = relativeDocumentPath(
							taskId,
							item.documentType as DocumentType,
						);
						atomicWrite(path, item.content);
						tx.documents.upsert({
							taskId,
							documentType: item.documentType,
							sourceNodeId: null,
							filePath: path,
							contentHash: contentHash(item.content),
							updatedByRef: validated.actorRef,
							updatedAt: timestamp,
						});
					}
					event(
						tx,
						{
							taskId,
							nodeId: null,
							eventType: "TASK_CREATED",
							actorRef: validated.actorRef,
							taskVersion: 1,
							nodeVersion: null,
							payload: null,
						},
						timestamp,
					);
					return value;
				},
			);
		},
		authorizeTask: (raw: unknown): TaskResult<Task> =>
			command<TaskControls, Task>(
				"authorizeTask",
				raw,
				(tx, input, timestamp) => {
					const task = requireTask(tx, input.taskId);
					checkVersion(
						task.version,
						input.expectedTaskVersion,
						"TASK_VERSION_CONFLICT",
					);
					if (task.taskGroupId)
						throw new DomainError(
							"TASK_AUTHORIZATION_NOT_ALLOWED",
							"Grouped Tasks are authorized by their active group.",
						);
					if (task.status !== "PENDING")
						throw new DomainError(
							"TASK_STATE_CONFLICT",
							"Task is not PENDING.",
						);
					const updated = {
						...task,
						status: "READY" as const,
						version: task.version + 1,
						authorizedByRef: input.actorRef,
						authorizedAt: timestamp,
						updatedAt: timestamp,
					};
					tx.tasks.update(updated);
					return updated;
				},
			),
		bindTaskWorker: (raw: unknown): TaskResult<Task> =>
			command<BindInput, Task>(
				"bindTaskWorker",
				raw,
				(tx, input, timestamp) => {
					const task = requireTask(tx, input.taskId);
					checkVersion(
						task.version,
						input.expectedTaskVersion,
						"TASK_VERSION_CONFLICT",
					);
					if (["SUCCEEDED", "TERMINATED"].includes(task.status))
						throw new DomainError("TASK_TERMINAL", "Task is terminal.");
					const old = tx.roleBindings.get(task.taskId, input.roleRef);
					if (!old)
						throw new DomainError(
							"TASK_ROLE_NOT_FOUND",
							"Role is not declared by the Task.",
						);
					if (old.workerRef === input.workerRef) return task;
					if (old.workerRef !== null)
						throw new DomainError(
							"TASK_ROLE_BINDING_CONFLICT",
							"Role is already bound.",
						);
					tx.roleBindings.upsert({
						...old,
						workerRef: input.workerRef,
						version: old.version + 1,
						updatedAt: timestamp,
					});
					const updated = {
						...task,
						version: task.version + 1,
						updatedAt: timestamp,
					};
					tx.tasks.update(updated);
					return updated;
				},
			),
		startTask: (raw: unknown): TaskResult<Task> =>
			command<TaskControls, Task>("startTask", raw, (tx, input, timestamp) => {
				const task = requireTask(tx, input.taskId);
				checkVersion(
					task.version,
					input.expectedTaskVersion,
					"TASK_VERSION_CONFLICT",
				);
				if (task.status !== "READY")
					throw new DomainError("TASK_STATE_CONFLICT", "Task is not READY.");
				const requiredRoles = new Set(
					tx.nodes.listByTask(task.taskId).map((item) => item.requiredRoleRef),
				);
				const bindings = tx.roleBindings
					.listByTask(task.taskId)
					.filter((item) => requiredRoles.has(item.roleRef));
				if (
					bindings.length !== requiredRoles.size ||
					bindings.some((item) => item.workerRef === null)
				)
					throw new DomainError(
						"TASK_BINDING_INCOMPLETE",
						"Every required role must be bound.",
					);
				if (task.taskGroupId) {
					const group = tx.taskGroups.get(task.taskGroupId);
					if (group?.status !== "ACTIVE")
						throw new DomainError(
							"TASK_GROUP_NOT_ACTIVE",
							"TaskGroup is not ACTIVE.",
						);
					const siblings = tx.tasks.list(task.taskGroupId);
					if (
						siblings.some(
							(item) =>
								(item.sequenceNo ?? 0) < (task.sequenceNo ?? 0) &&
								item.status !== "SUCCEEDED",
						)
					)
						throw new DomainError(
							"TASK_PREDECESSOR_NOT_SUCCEEDED",
							"A predecessor is not SUCCEEDED.",
						);
					if (
						siblings.some(
							(item) =>
								item.taskId !== task.taskId &&
								["ACTIVE", "WAITING", "FAILED", "PAUSED"].includes(item.status),
						)
					)
						throw new DomainError(
							"TASK_GROUP_BUSY",
							"Another Task blocks the group.",
						);
				}
				const nodes = tx.nodes.listByTask(task.taskId);
				const first = nodes[0];
				if (!first)
					throw new DomainError("TASK_PLAN_EMPTY", "Task has no nodes.");
				const ready = {
					...first,
					status: "READY" as const,
					version: first.version + 1,
					updatedAt: timestamp,
				};
				tx.nodes.update(ready);
				const updated = {
					...task,
					status: "ACTIVE" as const,
					version: task.version + 1,
					currentNodeId: first.nodeId,
					startedAt: timestamp,
					updatedAt: timestamp,
				};
				tx.tasks.update(updated);
				return updated;
			}),
		pauseTask: (raw: unknown): TaskResult<Task> =>
			command<ReasonInput, Task>("pauseTask", raw, (tx, input, timestamp) => {
				const task = requireTask(tx, input.taskId);
				checkVersion(
					task.version,
					input.expectedTaskVersion,
					"TASK_VERSION_CONFLICT",
				);
				if (!["ACTIVE", "WAITING", "FAILED"].includes(task.status))
					throw new DomainError(
						"TASK_STATE_CONFLICT",
						"Task cannot be paused.",
					);
				const updated = {
					...task,
					status: "PAUSED" as const,
					version: task.version + 1,
					updatedAt: timestamp,
				};
				tx.tasks.update(updated);
				return updated;
			}),
		resumeTask: (raw: unknown): TaskResult<Task> =>
			command<TaskControls, Task>("resumeTask", raw, (tx, input, timestamp) => {
				const task = requireTask(tx, input.taskId);
				checkVersion(
					task.version,
					input.expectedTaskVersion,
					"TASK_VERSION_CONFLICT",
				);
				if (!["WAITING", "PAUSED"].includes(task.status))
					throw new DomainError(
						"TASK_STATE_CONFLICT",
						"Task cannot be resumed.",
					);
				const current = task.currentNodeId
					? tx.nodes.get(task.currentNodeId)
					: undefined;
				if (current?.status === "WAITING")
					tx.nodes.update({
						...current,
						status: "IN_PROGRESS",
						version: current.version + 1,
						updatedAt: timestamp,
					});
				const updated = {
					...task,
					status: "ACTIVE" as const,
					version: task.version + 1,
					updatedAt: timestamp,
				};
				tx.tasks.update(updated);
				return updated;
			}),
		terminateTask: (raw: unknown): TaskResult<Task> =>
			command<ReasonInput, Task>(
				"terminateTask",
				raw,
				(tx, input, timestamp) => {
					const task = requireTask(tx, input.taskId);
					checkVersion(
						task.version,
						input.expectedTaskVersion,
						"TASK_VERSION_CONFLICT",
					);
					if (["SUCCEEDED", "TERMINATED"].includes(task.status))
						throw new DomainError("TASK_TERMINAL", "Task is terminal.");
					for (const item of tx.nodes.listByTask(task.taskId))
						if (!["SUCCEEDED", "TERMINATED"].includes(item.status))
							tx.nodes.update({
								...item,
								status: "TERMINATED",
								version: item.version + 1,
								completedAt: timestamp,
								updatedAt: timestamp,
							});
					const updated = {
						...task,
						status: "TERMINATED" as const,
						version: task.version + 1,
						completedAt: timestamp,
						updatedAt: timestamp,
					};
					tx.tasks.update(updated);
					return updated;
				},
			),
		startNode: (raw: unknown): TaskResult<NodeResult> =>
			command<NodeControls, NodeResult>(
				"startNode",
				raw,
				(tx, input, timestamp) => {
					const task = requireTask(tx, input.taskId);
					const node = requireNode(tx, input.taskId, input.nodeId);
					checkVersion(
						task.version,
						input.expectedTaskVersion,
						"TASK_VERSION_CONFLICT",
					);
					checkVersion(
						node.version,
						input.expectedNodeVersion,
						"NODE_VERSION_CONFLICT",
					);
					if (
						task.status !== "ACTIVE" ||
						node.status !== "READY" ||
						task.currentNodeId !== node.nodeId
					)
						throw new DomainError(
							"NODE_STATE_CONFLICT",
							"Node is not READY/current.",
						);
					const binding = tx.roleBindings.get(
						task.taskId,
						node.requiredRoleRef,
					);
					if (!binding?.workerRef)
						throw new DomainError(
							"TASK_BINDING_INCOMPLETE",
							"Node role is not bound.",
						);
					const updatedNode = {
						...node,
						status: "IN_PROGRESS" as const,
						workerRef: binding.workerRef,
						version: node.version + 1,
						startedAt: timestamp,
						updatedAt: timestamp,
					};
					const updatedTask = {
						...task,
						version: task.version + 1,
						updatedAt: timestamp,
					};
					tx.nodes.update(updatedNode);
					tx.tasks.update(updatedTask);
					return nodeResult(updatedTask, updatedNode);
				},
			),
		completeNode: (raw: unknown): TaskResult<NodeResult> =>
			command<CompleteInput, NodeResult>(
				"completeNode",
				raw,
				(tx, input, timestamp) => {
					const task = requireTask(tx, input.taskId);
					const node = requireNode(tx, input.taskId, input.nodeId);
					checkVersion(
						task.version,
						input.expectedTaskVersion,
						"TASK_VERSION_CONFLICT",
					);
					checkVersion(
						node.version,
						input.expectedNodeVersion,
						"NODE_VERSION_CONFLICT",
					);
					if (
						task.status !== "ACTIVE" ||
						node.status !== "IN_PROGRESS" ||
						node.workerRef !== input.actorRef
					)
						throw new DomainError(
							"NODE_ACTOR_OR_STATE_CONFLICT",
							"Only the bound running Worker may complete the Node.",
						);
					for (const type of node.outputDocuments) {
						const doc = tx.documents.get(task.taskId, type);
						if (!doc || !existsSync(join(workspaceRoot, doc.filePath)))
							throw new DomainError(
								"NODE_OUTPUT_MISSING",
								"A required output document is missing.",
							);
						if (
							contentHash(
								readFileSync(join(workspaceRoot, doc.filePath), "utf8"),
							) !== doc.contentHash
						)
							throw new DomainError(
								"DOCUMENT_INDEX_MISMATCH",
								"A required output document does not match its index.",
							);
					}
					const completedNode = {
						...node,
						status: "SUCCEEDED" as const,
						version: node.version + 1,
						resultSummary: input.resultSummary,
						completedAt: timestamp,
						updatedAt: timestamp,
					};
					tx.nodes.update(completedNode);
					tx.executionHistory.insert({
						taskId: task.taskId,
						nodeId: node.nodeId,
						runNo: node.runNo,
						workerRef: node.workerRef,
						finalStatus: "SUCCEEDED",
						resultSummary: input.resultSummary,
						errorCode: null,
						errorMessage: null,
						errorRetryable: null,
						inputDocuments: node.inputDocuments,
						outputDocuments: node.outputDocuments,
						startedAt: node.startedAt,
						endedAt: timestamp,
					});
					const nodes = tx.nodes.listByTask(task.taskId);
					const next = nodes.find(
						(item) =>
							item.sequenceNo > node.sequenceNo && item.status === "PENDING",
					);
					let updatedTask: Task;
					if (next) {
						tx.nodes.update({
							...next,
							status: "READY",
							version: next.version + 1,
							updatedAt: timestamp,
						});
						updatedTask = {
							...task,
							version: task.version + 1,
							currentNodeId: next.nodeId,
							updatedAt: timestamp,
						};
					} else {
						updatedTask = {
							...task,
							status: "SUCCEEDED",
							version: task.version + 1,
							currentNodeId: null,
							completedAt: timestamp,
							updatedAt: timestamp,
						};
					}
					tx.tasks.update(updatedTask);
					if (updatedTask.status === "SUCCEEDED" && task.taskGroupId) {
						const group = tx.taskGroups.get(task.taskGroupId);
						if (group) {
							const groupTasks = tx.tasks.list(group.taskGroupId);
							const nextTask = groupTasks.find(
								(item) =>
									(item.sequenceNo ?? 0) > (task.sequenceNo ?? 0) &&
									item.status === "PENDING",
							);
							if (nextTask)
								tx.tasks.update({
									...nextTask,
									status: "READY",
									version: nextTask.version + 1,
									updatedAt: timestamp,
								});
							const allDone = groupTasks
								.filter((item) => item.taskId !== task.taskId)
								.every((item) => item.status === "SUCCEEDED");
							tx.taskGroups.update({
								...group,
								status: allDone ? "SUCCEEDED" : group.status,
								version: group.version + 1,
								updatedAt: timestamp,
							});
						}
					}
					return nodeResult(updatedTask, completedNode);
				},
			),
		waitNode: (raw: unknown): TaskResult<Task> =>
			command<WaitInput, Task>("waitNode", raw, (tx, input, timestamp) => {
				const task = requireTask(tx, input.taskId);
				const node = requireNode(tx, input.taskId, input.nodeId);
				checkVersion(
					task.version,
					input.expectedTaskVersion,
					"TASK_VERSION_CONFLICT",
				);
				checkVersion(
					node.version,
					input.expectedNodeVersion,
					"NODE_VERSION_CONFLICT",
				);
				if (node.status !== "IN_PROGRESS" || node.workerRef !== input.actorRef)
					throw new DomainError(
						"NODE_ACTOR_OR_STATE_CONFLICT",
						"Node cannot wait.",
					);
				tx.nodes.update({
					...node,
					status: "WAITING",
					version: node.version + 1,
					updatedAt: timestamp,
				});
				const updated = {
					...task,
					status: "WAITING" as const,
					version: task.version + 1,
					updatedAt: timestamp,
				};
				tx.tasks.update(updated);
				tx.messages.insert({
					messageId: createId("message"),
					taskId: task.taskId,
					nodeId: node.nodeId,
					messageType: input.waitType,
					reasonCode: input.reasonCode,
					message: input.message,
					relatedRef: input.relatedRef ?? null,
					status: "PENDING",
					createdByRef: input.actorRef,
					createdAt: timestamp,
					acknowledgedByRef: null,
					acknowledgedAt: null,
					resolution: null,
				});
				return updated;
			}),
		failNode: (raw: unknown): TaskResult<Task> =>
			command<FailInput, Task>("failNode", raw, (tx, input, timestamp) => {
				const task = requireTask(tx, input.taskId);
				const node = requireNode(tx, input.taskId, input.nodeId);
				checkVersion(
					task.version,
					input.expectedTaskVersion,
					"TASK_VERSION_CONFLICT",
				);
				checkVersion(
					node.version,
					input.expectedNodeVersion,
					"NODE_VERSION_CONFLICT",
				);
				if (!["IN_PROGRESS", "WAITING"].includes(node.status))
					throw new DomainError("NODE_STATE_CONFLICT", "Node cannot fail.");
				tx.nodes.update({
					...node,
					status: "FAILED",
					version: node.version + 1,
					errorCode: input.errorCode,
					errorMessage: input.errorMessage,
					errorRetryable: input.retryable,
					completedAt: timestamp,
					updatedAt: timestamp,
				});
				const updated = {
					...task,
					status: "FAILED" as const,
					version: task.version + 1,
					updatedAt: timestamp,
				};
				tx.tasks.update(updated);
				return updated;
			}),
		reopenNode: (raw: unknown): TaskResult<NodeResult> =>
			command<ReopenInput, NodeResult>(
				"reopenNode",
				raw,
				(tx, input, timestamp) => {
					const task = requireTask(tx, input.taskId);
					const target = requireNode(tx, input.taskId, input.nodeId);
					checkVersion(
						task.version,
						input.expectedTaskVersion,
						"TASK_VERSION_CONFLICT",
					);
					if (!["SUCCEEDED", "FAILED"].includes(target.status))
						throw new DomainError(
							"NODE_STATE_CONFLICT",
							"Only completed or failed Nodes can reopen.",
						);
					const existing = tx.executionHistory
						.listByTask(task.taskId)
						.some(
							(item) =>
								item.nodeId === target.nodeId && item.runNo === target.runNo,
						);
					if (!existing)
						tx.executionHistory.insert({
							taskId: task.taskId,
							nodeId: target.nodeId,
							runNo: target.runNo,
							workerRef: target.workerRef,
							finalStatus: target.status,
							resultSummary: target.resultSummary,
							errorCode: target.errorCode,
							errorMessage: target.errorMessage,
							errorRetryable: target.errorRetryable,
							inputDocuments: target.inputDocuments,
							outputDocuments: target.outputDocuments,
							startedAt: target.startedAt,
							endedAt: timestamp,
						});
					const reopened = {
						...target,
						status: "READY" as const,
						version: target.version + 1,
						runNo: target.runNo + 1,
						workerRef: null,
						resultSummary: null,
						errorCode: null,
						errorMessage: null,
						errorRetryable: null,
						startedAt: null,
						completedAt: null,
						updatedAt: timestamp,
					};
					tx.nodes.update(reopened);
					for (const later of tx.nodes.listByTask(task.taskId))
						if (later.sequenceNo > target.sequenceNo)
							tx.nodes.update({
								...later,
								status: "PENDING",
								version: later.version + 1,
								workerRef: null,
								resultSummary: null,
								errorCode: null,
								errorMessage: null,
								errorRetryable: null,
								startedAt: null,
								completedAt: null,
								updatedAt: timestamp,
							});
					const updated = {
						...task,
						status: "ACTIVE" as const,
						version: task.version + 1,
						currentNodeId: target.nodeId,
						completedAt: null,
						updatedAt: timestamp,
					};
					tx.tasks.update(updated);
					event(
						tx,
						{
							taskId: task.taskId,
							nodeId: target.nodeId,
							eventType: "NODE_REOPENED",
							actorRef: input.actorRef,
							taskVersion: updated.version,
							nodeVersion: reopened.version,
							payload: { reason: input.reason },
						},
						timestamp,
					);
					return nodeResult(updated, reopened);
				},
			),
		acknowledgeMessage: (raw: unknown): TaskResult<TaskMessage> =>
			command<AckInput, TaskMessage>(
				"acknowledgeMessage",
				raw,
				(tx, input, timestamp) => {
					const message = tx.messages.get(input.messageId);
					if (!message)
						throw new DomainError(
							"MESSAGE_NOT_FOUND",
							"Message was not found.",
						);
					if (message.status === "ACKNOWLEDGED") return message;
					const updated = {
						...message,
						status: "ACKNOWLEDGED" as const,
						acknowledgedByRef: input.actorRef,
						acknowledgedAt: timestamp,
						resolution: input.resolution ?? null,
					};
					tx.messages.update(updated);
					const task = tx.tasks.get(message.taskId);
					event(
						tx,
						{
							taskId: message.taskId,
							nodeId: message.nodeId,
							eventType: "MESSAGE_ACKNOWLEDGED",
							actorRef: input.actorRef,
							taskVersion: task?.version ?? null,
							nodeVersion: message.nodeId
								? (tx.nodes.get(message.nodeId)?.version ?? null)
								: null,
							payload: { messageId: message.messageId },
						},
						timestamp,
					);
					return updated;
				},
			),
	};

	const queries = {
		getTaskGroup: (
			raw: unknown,
		): TaskResult<
			TaskGroup & { currentTaskId: string | null; tasks: Task[] }
		> =>
			query<
				{ taskGroupId: string },
				TaskGroup & { currentTaskId: string | null; tasks: Task[] }
			>("getTaskGroup", raw, (tx, input) => {
				const group = tx.taskGroups.get(input.taskGroupId);
				if (!group)
					throw new DomainError(
						"TASK_GROUP_NOT_FOUND",
						"TaskGroup was not found.",
					);
				const tasks = tx.tasks.list(group.taskGroupId);
				return {
					...group,
					currentTaskId:
						tasks.find((item) =>
							["READY", "ACTIVE", "WAITING", "FAILED", "PAUSED"].includes(
								item.status,
							),
						)?.taskId ?? null,
					tasks,
				};
			}),
		listTasks: (raw: unknown): TaskResult<{ tasks: TaskSummary[] }> =>
			query<
				{ taskGroupId?: string; status?: string },
				{ tasks: TaskSummary[] }
			>("listTasks", raw, (tx, input) => {
				const tasks = tx.tasks
					.list(input.taskGroupId)
					.filter((item) => !input.status || item.status === input.status);
				return {
					tasks: tasks.map((item) => {
						let blockedReason: string | null = null;
						if (item.status !== "READY") blockedReason = "TASK_NOT_READY";
						if (blockedReason === null) {
							const requiredRoles = new Set(
								tx.nodes
									.listByTask(item.taskId)
									.map((node) => node.requiredRoleRef),
							);
							const bindings = tx.roleBindings
								.listByTask(item.taskId)
								.filter((binding) => requiredRoles.has(binding.roleRef));
							if (
								bindings.length !== requiredRoles.size ||
								bindings.some((binding) => binding.workerRef === null)
							)
								blockedReason = "TASK_ROLE_BINDING_REQUIRED";
						}
						if (item.taskGroupId) {
							const siblings = tx.tasks.list(item.taskGroupId);
							if (
								siblings.some(
									(other) =>
										(other.sequenceNo ?? 0) < (item.sequenceNo ?? 0) &&
										other.status !== "SUCCEEDED",
								)
							)
								blockedReason = "PREDECESSOR_NOT_SUCCEEDED";
							else if (
								siblings.some(
									(other) =>
										other.taskId !== item.taskId &&
										["ACTIVE", "WAITING", "FAILED", "PAUSED"].includes(
											other.status,
										),
								)
							)
								blockedReason = "TASK_GROUP_BUSY";
						}
						return { ...item, canStart: blockedReason === null, blockedReason };
					}),
				};
			}),
		getTask: (raw: unknown): TaskResult<TaskView> =>
			query<{ taskId: string }, TaskView>("getTask", raw, (tx, input) =>
				view(tx, requireTask(tx, input.taskId)),
			),
		getNodeContext: (
			raw: unknown,
		): TaskResult<{ task: Task; node: TaskNode; documents: TaskDocument[] }> =>
			query<
				{ taskId: string; nodeId: string },
				{ task: Task; node: TaskNode; documents: TaskDocument[] }
			>("getNodeContext", raw, (tx, input) => {
				const task = requireTask(tx, input.taskId);
				const node = requireNode(tx, input.taskId, input.nodeId);
				const documents = node.inputDocuments
					.map((type) => tx.documents.get(task.taskId, type))
					.filter((item): item is TaskDocument => item !== undefined);
				return { task, node, documents };
			}),
		listPendingMessages: (
			raw: unknown,
		): TaskResult<{ messages: TaskMessage[] }> =>
			query<{ taskId?: string }, { messages: TaskMessage[] }>(
				"listPendingMessages",
				raw,
				(tx, input) => ({
					messages: tx.messages
						.listPending()
						.filter((item) => !input.taskId || item.taskId === input.taskId),
				}),
			),
		listTaskEvents: (raw: unknown): TaskResult<{ events: TaskEvent[] }> =>
			query<{ taskId: string }, { events: TaskEvent[] }>(
				"listTaskEvents",
				raw,
				(tx, input) => ({ events: tx.events.listByTask(input.taskId) }),
			),
	};

	const documents = {
		putTaskDocument: (raw: unknown): TaskResult<DocumentResult> => {
			let input: PutDocumentInput;
			try {
				input = validatePublicInput("putTaskDocument", raw) as PutDocumentInput;
				const replay = store.read((tx) =>
					tx.idempotency.get(input.idempotencyKey),
				);
				if (replay) {
					if (
						replay.operation !== "putTaskDocument" ||
						replay.requestHash !== hash(input)
					)
						throw new DomainError(
							"IDEMPOTENCY_CONFLICT",
							"Idempotency key has a different request fingerprint.",
						);
					return JSON.parse(replay.responseJson) as TaskResult<DocumentResult>;
				}
				store.read((tx) =>
					checkVersion(
						requireTask(tx, input.taskId).version,
						input.expectedTaskVersion,
						"TASK_VERSION_CONFLICT",
					),
				);
				const type = ensureType(input.documentType);
				atomicWrite(relativeDocumentPath(input.taskId, type), input.content);
			} catch (error) {
				return failure(error);
			}
			const result = command<PutDocumentInput, DocumentResult>(
				"putTaskDocument",
				raw,
				(tx, validated, timestamp) => {
					const task = requireTask(tx, validated.taskId);
					checkVersion(
						task.version,
						validated.expectedTaskVersion,
						"TASK_VERSION_CONFLICT",
					);
					const type = ensureType(validated.documentType);
					const path = relativeDocumentPath(task.taskId, type);
					const updated = {
						...task,
						version: task.version + 1,
						updatedAt: timestamp,
					};
					tx.tasks.update(updated);
					tx.documents.upsert({
						taskId: task.taskId,
						documentType: type,
						sourceNodeId: validated.nodeId,
						filePath: path,
						contentHash: contentHash(validated.content),
						updatedByRef: validated.actorRef,
						updatedAt: timestamp,
					});
					event(
						tx,
						{
							taskId: task.taskId,
							nodeId: validated.nodeId,
							eventType: "TASK_DOCUMENT_PUT",
							actorRef: validated.actorRef,
							taskVersion: updated.version,
							nodeVersion: null,
							payload: { documentType: type },
						},
						timestamp,
					);
					return {
						taskId: task.taskId,
						nodeId: validated.nodeId,
						documentType: type,
						path,
						contentHash: contentHash(validated.content),
						sizeBytes: Buffer.byteLength(validated.content),
						taskVersion: updated.version,
						updatedAt: timestamp,
					};
				},
			);
			if (!result.ok && result.error.code === "INTERNAL_ERROR")
				return failure(
					new DomainError("DOCUMENT_WRITE_FAILED", result.error.message, true),
				);
			return result;
		},
		getTaskDocument: (raw: unknown): TaskResult<DocumentResult> =>
			query<{ taskId: string; documentType: string }, DocumentResult>(
				"getTaskDocument",
				raw,
				(tx, input) => {
					const type = ensureType(input.documentType);
					const document = tx.documents.get(input.taskId, type);
					if (!document)
						throw new DomainError(
							"DOCUMENT_NOT_FOUND",
							"Document was not found.",
						);
					const content = readFileSync(
						join(workspaceRoot, document.filePath),
						"utf8",
					);
					const task = requireTask(tx, input.taskId);
					return {
						taskId: input.taskId,
						documentType: type,
						path: document.filePath,
						contentHash: document.contentHash,
						sizeBytes: statSync(join(workspaceRoot, document.filePath)).size,
						taskVersion: task.version,
						updatedAt: document.updatedAt,
						content,
					};
				},
			),
		reconcileDocumentIndex: (input: {
			taskId: string;
			actorRef: string;
		}): TaskResult<{ reconciled: number }> => {
			try {
				const result = store.transaction((tx) => {
					requireTask(tx, input.taskId);
					let reconciled = 0;
					for (const type of allowedDocumentTypes) {
						const path = relativeDocumentPath(input.taskId, type);
						const absolute = join(workspaceRoot, path);
						if (!existsSync(absolute)) continue;
						const content = readFileSync(absolute, "utf8");
						const current = tx.documents.get(input.taskId, type);
						const digest = contentHash(content);
						if (!current || current.contentHash !== digest) {
							tx.documents.upsert({
								taskId: input.taskId,
								documentType: type,
								sourceNodeId: current?.sourceNodeId ?? null,
								filePath: path,
								contentHash: digest,
								updatedByRef: input.actorRef,
								updatedAt: now(),
							});
							reconciled++;
						}
					}
					return { reconciled };
				});
				return success(result);
			} catch (error) {
				return failure(error);
			}
		},
	};
	return { commands, queries, documents };
}
