import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
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
	TaskStore,
} from "./model.ts";
import { requiredTaskAgentPackageRefs } from "./model.ts";

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
	nodeId: string;
	title: string;
	objective: string;
	requiredAgentPackageRef: string;
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
	roleBindings: Array<{
		agentPackageRef: string;
		roleRef: string;
		workerRef: string | null;
		conversationLocator: string | null;
	}>;
}
interface BindInput extends TaskControls {
	agentPackageRef: string;
	roleRef: string;
	workerRef: string;
	conversationLocator: string;
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
	nodeId: string | null;
	documentType: string;
	content: string;
}

export interface TaskSummary extends Task {
	canStart: boolean;
	blockedReason: string | null;
}
export interface TaskView {
	taskId: string;
	taskGroupId: string | null;
	sequenceNo: number | null;
	title: string;
	objective: string;
	status: Task["status"];
	version: number;
	planVersion: number;
	currentNodeId: string | null;
	roleBindings: Array<{
		agentPackageRef: string;
		roleRef: string;
		workerRef: string | null;
		conversationLocator: string | null;
	}>;
	nodes: Array<{
		nodeId: string;
		title: string;
		status: NodeStatus;
		runNo: number;
		requiredAgentPackageRef: string;
		workerRef: string | null;
		version: number;
	}>;
	pendingMessages: TaskMessage[];
	readiness?: {
		ready: boolean;
	};
}
export interface NodeResult {
	taskId: string;
	nodeId: string;
	status: NodeStatus;
	runNo: number;
	workerRef: string | null;
	taskVersion: number;
	nodeVersion: number;
	startedAt: string | null;
}
export interface CreateTaskResult {
	taskId: string;
	taskGroupId: string | null;
	status: Task["status"];
	version: number;
	planVersion: number;
	currentNodeId: string | null;
	roleBindings: Array<{
		agentPackageRef: string;
		roleRef: string;
		workerRef: string | null;
		conversationLocator: string | null;
	}>;
}
export interface BindTaskWorkerResult {
	taskId: string;
	version: number;
	roleBinding: {
		agentPackageRef: string;
		roleRef: string;
		workerRef: string;
		conversationLocator: string;
	};
}
export interface CompleteNodeResult {
	nodeId: string;
	status: "SUCCEEDED";
	runNo: number;
	completedAt: string;
	taskStatus: Task["status"];
	taskVersion: number;
	nextNodeId: string | null;
}
export interface DocumentResult {
	taskId: string;
	nodeId: string | null;
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
function preserveRunHistory(
	tx: TaskRepositories,
	node: TaskNode,
	finalStatus: NodeStatus,
	endedAt: string,
): void {
	if (node.startedAt === null && node.workerRef === null) return;
	if (
		tx.executionHistory
			.listByTask(node.taskId)
			.some((item) => item.nodeId === node.nodeId && item.runNo === node.runNo)
	)
		return;
	tx.executionHistory.insert({
		taskId: node.taskId,
		nodeId: node.nodeId,
		runNo: node.runNo,
		workerRef: node.workerRef,
		finalStatus,
		resultSummary: node.resultSummary,
		errorCode: node.errorCode,
		errorMessage: node.errorMessage,
		errorRetryable: node.errorRetryable,
		inputDocuments: node.inputDocuments,
		outputDocuments: node.outputDocuments,
		startedAt: node.startedAt,
		endedAt,
	});
}
function nodeResult(task: Task, node: TaskNode): NodeResult {
	return {
		taskId: task.taskId,
		nodeId: node.nodeId,
		status: node.status,
		runNo: node.runNo,
		workerRef: node.workerRef,
		taskVersion: task.version,
		nodeVersion: node.version,
		startedAt: node.startedAt,
	};
}

function readinessBlockedReason(
	tx: TaskRepositories,
	task: Task,
): string | null {
	if (!tx.documents.get(task.taskId, "REQUIREMENT"))
		return "TASK_REQUIREMENT_REQUIRED";

	const bindings = tx.roleBindings.listByTask(task.taskId);
	if (bindings.length !== requiredTaskAgentPackageRefs.length)
		return "TASK_ROLE_BINDING_REQUIRED";
	if (
		tx.nodes
			.listByTask(task.taskId)
			.some(
				(node) =>
					!requiredTaskAgentPackageRefs.includes(
						node.requiredAgentPackageRef as (typeof requiredTaskAgentPackageRefs)[number],
					),
			)
	)
		return "TASK_NODE_AGENT_PACKAGE_INVALID";
	for (const agentPackageRef of requiredTaskAgentPackageRefs) {
		const binding = bindings.find(
			(item) => item.agentPackageRef === agentPackageRef,
		);
		if (!binding) return "TASK_ROLE_BINDING_REQUIRED";
		if (binding.workerRef === null || binding.conversationLocator === null)
			return "TASK_ROLE_BINDING_INCOMPLETE";
	}

	if (task.taskGroupId !== null) {
		const group = tx.taskGroups.get(task.taskGroupId);
		if (group?.status !== "ACTIVE") return "TASK_GROUP_NOT_ACTIVE";
		const siblings = tx.tasks.list(task.taskGroupId);
		if (
			siblings.some(
				(item) =>
					(item.sequenceNo ?? 0) < (task.sequenceNo ?? 0) &&
					item.status !== "SUCCEEDED",
			)
		)
			return "PREDECESSOR_NOT_SUCCEEDED";
		if (
			siblings.some(
				(item) =>
					item.taskId !== task.taskId &&
					["READY", "ACTIVE", "WAITING", "FAILED", "PAUSED"].includes(
						item.status,
					),
			)
		)
			return "TASK_GROUP_BUSY";
	}

	return null;
}

function recomputeReadiness(
	tx: TaskRepositories,
	task: Task,
	timestamp: string,
): Task {
	if (task.status !== "PENDING") return task;
	if (readinessBlockedReason(tx, task) !== null) return task;
	return {
		...task,
		status: "READY" as const,
		version: task.version + 1,
		updatedAt: timestamp,
	};
}
function matchesWorker(actorRef: string, workerRef: string | null): boolean {
	return workerRef !== null && actorRef === `worker:${workerRef}`;
}

export function createTaskServices(options: {
	store: TaskStore;
	workspaceRoot: string;
	now?: () => string;
	createId?: (prefix: string) => string;
	writeDocument?: (relativePath: string, content: string) => void;
	promoteDocument?: (
		stagedRelativePath: string,
		finalRelativePath: string,
	) => void;
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
		taskId: task.taskId,
		taskGroupId: task.taskGroupId,
		sequenceNo: task.sequenceNo,
		title: task.title,
		objective: task.objective,
		status: task.status,
		version: task.version,
		planVersion: task.planVersion,
		currentNodeId: task.currentNodeId,
		nodes: tx.nodes.listByTask(task.taskId).map((node) => ({
			nodeId: node.nodeId,
			title: node.title,
			status: node.status,
			runNo: node.runNo,
			requiredAgentPackageRef: node.requiredAgentPackageRef,
			workerRef: node.workerRef,
			version: node.version,
		})),
		roleBindings: tx.roleBindings.listByTask(task.taskId).map((binding) => ({
			agentPackageRef: binding.agentPackageRef,
			roleRef: binding.roleRef,
			workerRef: binding.workerRef,
			conversationLocator: binding.conversationLocator,
		})),
		pendingMessages: tx.messages
			.listPending()
			.filter((message) => message.taskId === task.taskId),
		readiness: {
			ready:
				task.status === "READY" && readinessBlockedReason(tx, task) === null,
		},
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
	const writeDocument = options.writeDocument ?? atomicWrite;
	const promoteDocument =
		options.promoteDocument ??
		((stagedRelativePath: string, finalRelativePath: string): void => {
			const staged = join(workspaceRoot, stagedRelativePath);
			const final = join(workspaceRoot, finalRelativePath);
			mkdirSync(dirname(final), { recursive: true });
			renameSync(staged, final);
			const directoryDescriptor = openSync(dirname(final), "r");
			try {
				fsyncSync(directoryDescriptor);
			} finally {
				closeSync(directoryDescriptor);
			}
		});
	const safeTaskId = (taskId: string): string =>
		/^[A-Za-z0-9_-]+$/.test(taskId)
			? taskId
			: `id-${createHash("sha256").update(taskId).digest("hex")}`;
	const stageDocumentPath = (taskId: string, type: DocumentType): string =>
		`.proflow/recovery/task-create/${safeTaskId(taskId)}/${type.toLowerCase().replaceAll("_", "-")}.md`;
	const documentUpdateRecoveryRoot = (
		taskId: string,
		type: DocumentType,
	): string =>
		`.proflow/recovery/task-document/${safeTaskId(taskId)}/${type.toLowerCase().replaceAll("_", "-")}`;
	const documentUpdateRecoveryPath = (
		taskId: string,
		type: DocumentType,
		idempotencyKey: string,
	): string =>
		`${documentUpdateRecoveryRoot(taskId, type)}/${createHash("sha256").update(idempotencyKey).digest("hex")}`;
	type DocumentUpdateRecoveryState = {
		previousHash: string | null;
		requestHash: string;
	};
	const recoverPendingDocumentUpdates = (
		taskId: string,
		type: DocumentType,
	): void => {
		const recoveryRoot = documentUpdateRecoveryRoot(taskId, type);
		const recoveryRootAbsolute = join(workspaceRoot, recoveryRoot);
		if (!existsSync(recoveryRootAbsolute)) return;
		const canonicalPath = relativeDocumentPath(taskId, type);
		const canonicalAbsolute = join(workspaceRoot, canonicalPath);
		const currentMetadata = store.read((tx) => tx.documents.get(taskId, type));
		const databaseHash = currentMetadata?.contentHash ?? null;
		for (const entry of readdirSync(recoveryRootAbsolute, {
			withFileTypes: true,
		})) {
			if (!entry.isDirectory()) continue;
			const attemptAbsolute = join(recoveryRootAbsolute, entry.name);
			const stateAbsolute = join(attemptAbsolute, "state.json");
			if (!existsSync(stateAbsolute)) {
				rmSync(attemptAbsolute, { recursive: true, force: true });
				continue;
			}
			let state: DocumentUpdateRecoveryState;
			try {
				state = JSON.parse(
					readFileSync(stateAbsolute, "utf8"),
				) as DocumentUpdateRecoveryState;
			} catch {
				throw new DomainError(
					"DOCUMENT_RECOVERY_REQUIRED",
					"Task document recovery journal is unreadable.",
				);
			}
			const canonicalHash = existsSync(canonicalAbsolute)
				? contentHash(readFileSync(canonicalAbsolute, "utf8"))
				: null;
			if (canonicalHash === databaseHash) {
				rmSync(attemptAbsolute, { recursive: true, force: true });
				continue;
			}
			if (state.previousHash !== databaseHash)
				throw new DomainError(
					"DOCUMENT_RECOVERY_REQUIRED",
					"Task document recovery state does not match durable metadata.",
				);
			if (state.previousHash === null) {
				rmSync(canonicalAbsolute, { force: true });
			} else {
				const previousAbsolute = join(attemptAbsolute, "previous.md");
				if (!existsSync(previousAbsolute))
					throw new DomainError(
						"DOCUMENT_RECOVERY_REQUIRED",
						"Task document recovery backup is missing.",
					);
				const previousContent = readFileSync(previousAbsolute, "utf8");
				if (contentHash(previousContent) !== state.previousHash)
					throw new DomainError(
						"DOCUMENT_RECOVERY_REQUIRED",
						"Task document recovery backup hash does not match metadata.",
					);
				atomicWrite(canonicalPath, previousContent);
			}
			rmSync(attemptAbsolute, { recursive: true, force: true });
		}
		if (readdirSync(recoveryRootAbsolute).length === 0)
			rmSync(recoveryRootAbsolute, { recursive: true, force: true });
	};
	const cleanupCreateStage = (taskId: string): void => {
		rmSync(
			join(
				workspaceRoot,
				`.proflow/recovery/task-create/${safeTaskId(taskId)}`,
			),
			{ recursive: true, force: true },
		);
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
						"TASK_GROUP_INVALID_STATE",
						"TaskGroup is not READY.",
					);
				const updated = {
					...group,
					status: "ACTIVE" as const,
					version: group.version + 1,
					updatedAt: timestamp,
				};
				tx.taskGroups.update(updated);

				let firstEligibleTaskId: string | null = null;
				const members = [...tx.tasks.list(group.taskGroupId)].sort(
					(left, right) => (left.sequenceNo ?? 0) - (right.sequenceNo ?? 0),
				);
				for (const member of members) {
					const readied = recomputeReadiness(tx, member, timestamp);
					if (readied.status !== member.status) tx.tasks.update(readied);
					if (firstEligibleTaskId === null && readied.status === "READY")
						firstEligibleTaskId = readied.taskId;
				}
				return { ...updated, firstEligibleTaskId };
			}),
		createTask: (raw: unknown): TaskResult<CreateTaskResult> => {
			let normalized: CreateTaskInput;
			let stagedTaskId = "";
			try {
				const input = validatePublicInput("createTask", raw) as CreateTaskInput;
				stagedTaskId =
					input.taskId ??
					`task-${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 24)}`;
				normalized = { ...input, taskId: stagedTaskId };
				for (const document of normalized.initialDocuments)
					ensureType(document.documentType);
				for (const node of normalized.plan.nodes)
					for (const documentType of [
						...node.inputDocuments,
						...node.outputDocuments,
					])
						ensureType(documentType);
				if (
					new Set(normalized.initialDocuments.map((item) => item.documentType))
						.size !== normalized.initialDocuments.length
				)
					throw new DomainError(
						"INVALID_REQUEST",
						"Initial documentType values must be unique.",
					);
				if (
					new Set(normalized.roleBindings.map((item) => item.agentPackageRef))
						.size !== normalized.roleBindings.length
				)
					throw new DomainError(
						"INVALID_REQUEST",
						"Task role bindings must be unique by agentPackageRef.",
					);
				const declaredAgentPackageRefs = new Set(
					normalized.roleBindings.map((item) => item.agentPackageRef),
				);
				if (
					declaredAgentPackageRefs.size !==
						requiredTaskAgentPackageRefs.length ||
					requiredTaskAgentPackageRefs.some(
						(agentPackageRef) => !declaredAgentPackageRefs.has(agentPackageRef),
					)
				)
					throw new DomainError(
						"INVALID_REQUEST",
						"Task must declare exactly the fixed Product, Controller/Dev, and Test/Ops agent packages.",
					);
				for (const document of normalized.initialDocuments) {
					const type = document.documentType as DocumentType;
					const stagedPath = stageDocumentPath(stagedTaskId, type);
					const stagedAbsolute = join(workspaceRoot, stagedPath);
					if (existsSync(stagedAbsolute)) {
						if (
							contentHash(readFileSync(stagedAbsolute, "utf8")) !==
							contentHash(document.content)
						)
							throw new DomainError(
								"DOCUMENT_WRITE_FAILED",
								"Staged document content does not match the retried request.",
							);
					} else {
						writeDocument(stagedPath, document.content);
					}
				}
			} catch (error) {
				if (typeof stagedTaskId === "string") cleanupCreateStage(stagedTaskId);
				return failure(error);
			}
			const result = command<CreateTaskInput, CreateTaskResult>(
				"createTask",
				normalized,
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
							requiredAgentPackageRef: item.requiredAgentPackageRef,
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
							agentPackageRef: item.agentPackageRef,
							roleRef: item.roleRef,
							workerRef: item.workerRef,
							conversationLocator: item.conversationLocator,
							version: 1,
							createdAt: timestamp,
							updatedAt: timestamp,
						});
					for (const item of validated.initialDocuments) {
						const path = relativeDocumentPath(
							taskId,
							item.documentType as DocumentType,
						);
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
					return {
						taskId: value.taskId,
						taskGroupId: value.taskGroupId,
						status: value.status,
						version: value.version,
						planVersion: value.planVersion,
						currentNodeId: value.currentNodeId,
						roleBindings: validated.roleBindings.map((binding) => ({
							agentPackageRef: binding.agentPackageRef,
							roleRef: binding.roleRef,
							workerRef: binding.workerRef,
							conversationLocator: binding.conversationLocator,
						})),
					};
				},
			);
			if (!result.ok) {
				cleanupCreateStage(stagedTaskId);
				return result;
			}
			try {
				for (const document of normalized.initialDocuments) {
					const type = document.documentType as DocumentType;
					promoteDocument(
						stageDocumentPath(stagedTaskId, type),
						relativeDocumentPath(stagedTaskId, type),
					);
				}
				cleanupCreateStage(stagedTaskId);
				return result;
			} catch (error) {
				return failure(
					new DomainError(
						"DOCUMENT_WRITE_FAILED",
						error instanceof Error
							? error.message
							: "document promotion failed",
						true,
					),
				);
			}
		},
		bindTaskWorker: (raw: unknown): TaskResult<BindTaskWorkerResult> =>
			command<BindInput, BindTaskWorkerResult>(
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
						throw new DomainError("TASK_INVALID_STATE", "Task is terminal.");
					const old = tx.roleBindings.get(task.taskId, input.agentPackageRef);
					if (!old)
						throw new DomainError(
							"AGENT_PACKAGE_NOT_ELIGIBLE",
							"Agent package is not declared by the Task.",
						);
					if (old.roleRef !== input.roleRef)
						throw new DomainError(
							"ROLE_BINDING_MISMATCH",
							"RoleRef does not match the declared binding.",
						);
					if (
						old.workerRef === input.workerRef &&
						old.conversationLocator === input.conversationLocator
					)
						return {
							taskId: task.taskId,
							version: task.version,
							roleBinding: {
								agentPackageRef: old.agentPackageRef,
								roleRef: old.roleRef,
								workerRef: input.workerRef,
								conversationLocator: input.conversationLocator,
							},
						};
					if (old.workerRef !== null && old.workerRef !== input.workerRef)
						throw new DomainError(
							"TASK_ROLE_BINDING_CONFLICT",
							"Role is already bound to a different Worker.",
						);
					if (
						old.conversationLocator !== null &&
						old.conversationLocator !== input.conversationLocator
					)
						throw new DomainError(
							"TASK_ROLE_BINDING_CONFLICT",
							"Role is already bound to a different Conversation locator.",
						);
					tx.roleBindings.upsert({
						...old,
						workerRef: input.workerRef,
						conversationLocator: input.conversationLocator,
						version: old.version + 1,
						updatedAt: timestamp,
					});
					const updated = {
						...task,
						version: task.version + 1,
						updatedAt: timestamp,
					};
					tx.tasks.update(updated);
					const readied = recomputeReadiness(tx, updated, timestamp);
					if (readied.status !== updated.status) tx.tasks.update(readied);
					return {
						taskId: readied.taskId,
						version: readied.version,
						roleBinding: {
							agentPackageRef: old.agentPackageRef,
							roleRef: old.roleRef,
							workerRef: input.workerRef,
							conversationLocator: input.conversationLocator,
						},
					};
				},
			),
		startTask: (raw: unknown): TaskResult<TaskView> =>
			command<TaskControls, TaskView>(
				"startTask",
				raw,
				(tx, input, timestamp) => {
					const task = requireTask(tx, input.taskId);
					checkVersion(
						task.version,
						input.expectedTaskVersion,
						"TASK_VERSION_CONFLICT",
					);
					if (task.status !== "READY")
						throw new DomainError("TASK_INVALID_STATE", "Task is not READY.");
					const blockedReason = readinessBlockedReason(tx, task);
					if (blockedReason !== null)
						throw new DomainError(
							"TASK_BLOCKED",
							`Task readiness prerequisite failed: ${blockedReason}.`,
							false,
							{ blockedReason },
						);
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
					return view(tx, updated);
				},
			),
		pauseTask: (raw: unknown): TaskResult<Task> =>
			command<ReasonInput, Task>("pauseTask", raw, (tx, input, timestamp) => {
				const task = requireTask(tx, input.taskId);
				checkVersion(
					task.version,
					input.expectedTaskVersion,
					"TASK_VERSION_CONFLICT",
				);
				if (!["ACTIVE", "WAITING"].includes(task.status))
					throw new DomainError("TASK_INVALID_STATE", "Task cannot be paused.");
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
						"TASK_INVALID_STATE",
						"Task cannot be resumed.",
					);
				const current = task.currentNodeId
					? tx.nodes.get(task.currentNodeId)
					: undefined;
				if (current?.status === "FAILED")
					throw new DomainError(
						"TASK_INVALID_STATE",
						"A failed Node must be explicitly reopened before resume.",
					);
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
						throw new DomainError("TASK_INVALID_STATE", "Task is terminal.");
					for (const item of tx.nodes.listByTask(task.taskId))
						if (!["SUCCEEDED", "TERMINATED"].includes(item.status)) {
							preserveRunHistory(tx, item, "TERMINATED", timestamp);
							tx.nodes.update({
								...item,
								status: "TERMINATED",
								version: item.version + 1,
								completedAt: timestamp,
								updatedAt: timestamp,
							});
						}
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
							"NODE_INVALID_STATE",
							"Node is not READY/current.",
						);
					const binding = tx.roleBindings.get(
						task.taskId,
						node.requiredAgentPackageRef,
					);
					if (!binding?.workerRef || !binding.conversationLocator)
						throw new DomainError(
							"TASK_ROLE_BINDING_REQUIRED",
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
		completeNode: (raw: unknown): TaskResult<CompleteNodeResult> =>
			command<CompleteInput, CompleteNodeResult>(
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
						!matchesWorker(input.actorRef, node.workerRef)
					)
						throw new DomainError(
							!matchesWorker(input.actorRef, node.workerRef)
								? "WORKER_MISMATCH"
								: "NODE_INVALID_STATE",
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
							if (nextTask) {
								const readied = recomputeReadiness(tx, nextTask, timestamp);
								if (readied.status !== nextTask.status)
									tx.tasks.update(readied);
							}
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
					return {
						nodeId: completedNode.nodeId,
						status: "SUCCEEDED",
						runNo: completedNode.runNo,
						completedAt: timestamp,
						taskStatus: updatedTask.status,
						taskVersion: updatedTask.version,
						nextNodeId: updatedTask.currentNodeId,
					};
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
				if (task.status !== "ACTIVE")
					throw new DomainError(
						"TASK_INVALID_STATE",
						"Task must be ACTIVE before a Node can wait.",
					);
				if (
					node.status !== "IN_PROGRESS" ||
					!matchesWorker(input.actorRef, node.workerRef)
				)
					throw new DomainError(
						!matchesWorker(input.actorRef, node.workerRef)
							? "WORKER_MISMATCH"
							: "NODE_INVALID_STATE",
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
				if (!["ACTIVE", "WAITING"].includes(task.status))
					throw new DomainError(
						"TASK_INVALID_STATE",
						"Task cannot accept a Node failure in its current state.",
					);
				if (!["IN_PROGRESS", "WAITING"].includes(node.status))
					throw new DomainError("NODE_INVALID_STATE", "Node cannot fail.");
				const failedNode: TaskNode = {
					...node,
					status: "FAILED",
					version: node.version + 1,
					errorCode: input.errorCode,
					errorMessage: input.errorMessage,
					errorRetryable: input.retryable,
					completedAt: timestamp,
					updatedAt: timestamp,
				};
				tx.nodes.update(failedNode);
				preserveRunHistory(tx, failedNode, "FAILED", timestamp);
				const updated = {
					...task,
					status: "FAILED" as const,
					version: task.version + 1,
					updatedAt: timestamp,
				};
				tx.tasks.update(updated);
				return updated;
			}),
		reopenNode: (
			raw: unknown,
		): TaskResult<NodeResult & { currentNodeId: string }> =>
			command<ReopenInput, NodeResult & { currentNodeId: string }>(
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
							"NODE_INVALID_STATE",
							"Only completed or failed Nodes can reopen.",
						);
					preserveRunHistory(tx, target, target.status, timestamp);
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
						if (later.sequenceNo > target.sequenceNo) {
							preserveRunHistory(tx, later, later.status, timestamp);
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
						}
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
					return {
						...nodeResult(updated, reopened),
						currentNodeId: target.nodeId,
					};
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
				{ taskGroupId?: string; statuses?: string[] },
				{ tasks: TaskSummary[] }
			>("listTasks", raw, (tx, input) => {
				const tasks = tx.tasks
					.list(input.taskGroupId)
					.filter(
						(item) =>
							input.statuses === undefined ||
							input.statuses.includes(item.status),
					);
				return {
					tasks: tasks.map((item) => {
						let blockedReason = readinessBlockedReason(tx, item);
						if (item.status !== "READY" && blockedReason === null)
							blockedReason = "TASK_NOT_READY";
						return {
							...item,
							canStart: item.status === "READY" && blockedReason === null,
							blockedReason,
						};
					}),
				};
			}),
		getTask: (raw: unknown): TaskResult<TaskView> =>
			query<{ taskId: string }, TaskView>("getTask", raw, (tx, input) =>
				view(tx, requireTask(tx, input.taskId)),
			),
		getTaskDriveProjection: (
			raw: unknown,
		): TaskResult<{
			taskId: string;
			taskStatus: Task["status"];
			taskVersion: number;
			terminal: boolean;
			currentNode: {
				nodeId: string;
				status: NodeStatus;
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
		}> =>
			query<
				{ taskId: string },
				{
					taskId: string;
					taskStatus: Task["status"];
					taskVersion: number;
					terminal: boolean;
					currentNode: {
						nodeId: string;
						status: NodeStatus;
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
				}
			>("getTaskDriveProjection", raw, (tx, input) => {
				const task = requireTask(tx, input.taskId);
				const terminal = ["SUCCEEDED", "TERMINATED"].includes(task.status);
				const currentNode = task.currentNodeId
					? tx.nodes.get(task.currentNodeId)
					: undefined;
				const roleBinding = currentNode
					? tx.roleBindings.get(
							task.taskId,
							currentNode.requiredAgentPackageRef,
						)
					: undefined;
				let blockedReason: string | null = null;
				if (!terminal && !currentNode) blockedReason = "TASK_PLAN_EMPTY";
				else if (!terminal && currentNode?.status !== "READY")
					blockedReason = "NODE_NOT_READY";
				else if (!terminal && !roleBinding?.workerRef)
					blockedReason = "TASK_ROLE_BINDING_REQUIRED";
				const canDrive = !terminal && blockedReason === null;
				return {
					taskId: task.taskId,
					taskStatus: task.status,
					taskVersion: task.version,
					terminal,
					currentNode: currentNode
						? {
								nodeId: currentNode.nodeId,
								status: currentNode.status,
								version: currentNode.version,
								runNo: currentNode.runNo,
								requiredAgentPackageRef: currentNode.requiredAgentPackageRef,
							}
						: null,
					roleBinding: roleBinding
						? {
								agentPackageRef: roleBinding.agentPackageRef,
								roleRef: roleBinding.roleRef,
								workerRef: roleBinding.workerRef,
								conversationLocator: roleBinding.conversationLocator,
							}
						: null,
					canDrive,
					blockedReason,
				};
			}),
		getNodeContext: (
			raw: unknown,
		): TaskResult<{
			task: Pick<Task, "taskId" | "title" | "objective" | "status" | "version">;
			node: Pick<
				TaskNode,
				| "nodeId"
				| "title"
				| "objective"
				| "status"
				| "version"
				| "runNo"
				| "requiredAgentPackageRef"
				| "workerRef"
				| "inputDocuments"
				| "outputDocuments"
			>;
			documents: Array<{
				documentType: string;
				path: string;
				contentHash: string;
				sizeBytes: number;
			}>;
		}> =>
			query<
				{ taskId: string; nodeId: string },
				{
					task: Pick<
						Task,
						"taskId" | "title" | "objective" | "status" | "version"
					>;
					node: Pick<
						TaskNode,
						| "nodeId"
						| "title"
						| "objective"
						| "status"
						| "version"
						| "runNo"
						| "requiredAgentPackageRef"
						| "workerRef"
						| "inputDocuments"
						| "outputDocuments"
					>;
					documents: Array<{
						documentType: string;
						path: string;
						contentHash: string;
						sizeBytes: number;
					}>;
				}
			>("getNodeContext", raw, (tx, input) => {
				const task = requireTask(tx, input.taskId);
				const node = requireNode(tx, input.taskId, input.nodeId);
				const documents = node.inputDocuments
					.map((type) => tx.documents.get(task.taskId, type))
					.filter((item): item is TaskDocument => item !== undefined)
					.map((document) => ({
						documentType: document.documentType,
						path: document.filePath,
						contentHash: document.contentHash,
						sizeBytes: statSync(join(workspaceRoot, document.filePath)).size,
					}));
				return {
					task: {
						taskId: task.taskId,
						title: task.title,
						objective: task.objective,
						status: task.status,
						version: task.version,
					},
					node: {
						nodeId: node.nodeId,
						title: node.title,
						objective: node.objective,
						status: node.status,
						version: node.version,
						runNo: node.runNo,
						requiredAgentPackageRef: node.requiredAgentPackageRef,
						workerRef: node.workerRef,
						inputDocuments: node.inputDocuments,
						outputDocuments: node.outputDocuments,
					},
					documents,
				};
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
			query<
				{ taskId: string; afterEventId?: number; limit?: number },
				{ events: TaskEvent[] }
			>("listTaskEvents", raw, (tx, input) => ({
				events: tx.events
					.listByTask(input.taskId)
					.filter(
						(event) =>
							input.afterEventId === undefined ||
							(event.eventId ?? 0) > input.afterEventId,
					)
					.slice(0, input.limit ?? 100),
			})),
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
						nodeId: document.sourceNodeId,
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
	};

	const documents = {
		putTaskDocument: (raw: unknown): TaskResult<DocumentResult> => {
			let input: PutDocumentInput;
			let type: DocumentType;
			let recoveryPath: string;
			try {
				input = validatePublicInput("putTaskDocument", raw) as PutDocumentInput;
				type = ensureType(input.documentType);
				recoverPendingDocumentUpdates(input.taskId, type);
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

				const canonicalPath = relativeDocumentPath(input.taskId, type);
				const canonicalAbsolute = join(workspaceRoot, canonicalPath);
				const currentMetadata = store.read((tx) =>
					tx.documents.get(input.taskId, type),
				);
				const previousContent = existsSync(canonicalAbsolute)
					? readFileSync(canonicalAbsolute, "utf8")
					: null;
				const previousHash =
					previousContent === null ? null : contentHash(previousContent);
				if ((currentMetadata?.contentHash ?? null) !== previousHash)
					throw new DomainError(
						"DOCUMENT_RECOVERY_REQUIRED",
						"Canonical Markdown and durable document metadata must be reconciled before update.",
					);

				recoveryPath = documentUpdateRecoveryPath(
					input.taskId,
					type,
					input.idempotencyKey,
				);
				const recoveryAbsolute = join(workspaceRoot, recoveryPath);
				rmSync(recoveryAbsolute, { recursive: true, force: true });
				if (previousContent !== null)
					writeDocument(`${recoveryPath}/previous.md`, previousContent);
				writeDocument(`${recoveryPath}/next.md`, input.content);
				atomicWrite(
					`${recoveryPath}/state.json`,
					JSON.stringify({
						previousHash,
						requestHash: hash(input),
					} satisfies DocumentUpdateRecoveryState),
				);
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
					if (validated.nodeId !== null)
						requireNode(tx, task.taskId, validated.nodeId);

					const validatedType = ensureType(validated.documentType);
					const path = relativeDocumentPath(task.taskId, validatedType);
					const staged = `${documentUpdateRecoveryPath(
						task.taskId,
						validatedType,
						validated.idempotencyKey,
					)}/next.md`;

					// BEGIN IMMEDIATE + optimistic version validation happens before the
					// canonical Markdown is touched. The durable recovery journal keeps the
					// previous content until DB metadata and the file converge, so a process
					// crash at the promote/commit boundary can be repaired deterministically.
					promoteDocument(staged, path);

					const updated = {
						...task,
						version: task.version + 1,
						updatedAt: timestamp,
					};
					tx.tasks.update(updated);
					tx.documents.upsert({
						taskId: task.taskId,
						documentType: validatedType,
						sourceNodeId: validated.nodeId,
						filePath: path,
						contentHash: contentHash(validated.content),
						updatedByRef: validated.actorRef,
						updatedAt: timestamp,
					});
					const readied = recomputeReadiness(tx, updated, timestamp);
					if (readied.status !== updated.status) tx.tasks.update(readied);
					event(
						tx,
						{
							taskId: task.taskId,
							nodeId: validated.nodeId,
							eventType: "TASK_DOCUMENT_PUT",
							actorRef: validated.actorRef,
							taskVersion: readied.version,
							nodeVersion: null,
							payload: { documentType: validatedType },
						},
						timestamp,
					);
					return {
						taskId: task.taskId,
						nodeId: validated.nodeId,
						documentType: validatedType,
						path,
						contentHash: contentHash(validated.content),
						sizeBytes: Buffer.byteLength(validated.content),
						taskVersion: readied.version,
						updatedAt: timestamp,
					};
				},
			);
			try {
				recoverPendingDocumentUpdates(input.taskId, type);
			} catch (error) {
				return failure(error);
			}
			if (!result.ok && result.error.code === "INTERNAL_ERROR")
				return failure(
					new DomainError("DOCUMENT_WRITE_FAILED", result.error.message, true),
				);
			return result;
		},

		reconcileDocumentIndex: (input: {
			taskId: string;
			actorRef: string;
		}): TaskResult<{ reconciled: number }> => {
			try {
				for (const type of allowedDocumentTypes)
					recoverPendingDocumentUpdates(input.taskId, type);
				if (!store.read((tx) => tx.tasks.get(input.taskId))) {
					cleanupCreateStage(input.taskId);
					throw new DomainError(
						"TASK_NOT_FOUND",
						`Task ${input.taskId} was not found.`,
					);
				}
				for (const type of allowedDocumentTypes) {
					const staged = stageDocumentPath(input.taskId, type);
					if (existsSync(join(workspaceRoot, staged)))
						promoteDocument(staged, relativeDocumentPath(input.taskId, type));
				}
				cleanupCreateStage(input.taskId);
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
