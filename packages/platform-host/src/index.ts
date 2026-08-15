import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { basename, isAbsolute, join, resolve } from "node:path";

import { createAgentRuntime } from "@tomflow/proflow-agent-runtime";
import { applyMigrations } from "@tomflow/proflow-task-migration-runner";
import {
	createTaskServices,
	publicOperationNames,
} from "@tomflow/proflow-task-orchestration";
import { SqliteTaskStore } from "@tomflow/proflow-task-store-sqlite";
import { taskMigrations } from "@tomflow/proflow-task-store-sqlite/migrations";
import { z } from "zod";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const rolePackageRefs = [
	"@tomflow/proflow-agent-product",
	"@tomflow/proflow-agent-controller-dev",
	"@tomflow/proflow-agent-test-ops",
] as const;
type RolePackageRef = (typeof rolePackageRefs)[number];

const roleOperations: Record<RolePackageRef, ReadonlySet<string>> = {
	"@tomflow/proflow-agent-product": new Set([
		"getTask",
		"putTaskDocument",
		"getTaskDocument",
		"askPeer",
		"replyPeer",
	]),
	"@tomflow/proflow-agent-controller-dev": new Set([
		"getTask",
		"getNodeContext",
		"startNode",
		"completeNode",
		"waitNode",
		"failNode",
		"reopenNode",
		"getTaskDocument",
		"putTaskDocument",
		"askPeer",
		"replyPeer",
		"executeCapability",
		"getExecution",
		"readExecutionOutput",
	]),
	"@tomflow/proflow-agent-test-ops": new Set([
		"getTask",
		"getNodeContext",
		"completeNode",
		"waitNode",
		"failNode",
		"getTaskDocument",
		"putTaskDocument",
		"getTaskDocument",
		"askPeer",
		"replyPeer",
		"executeCapability",
		"getExecution",
		"readExecutionOutput",
	]),
};

const loopbackUrl = z
	.url()
	.transform((value) => new URL(value))
	.refine(
		(value) => value.protocol === "http:" && loopbackHosts.has(value.hostname),
		"owner service URL must be loopback HTTP",
	)
	.transform((value) => value.href.replace(/\/$/, ""));
const configSchema = z
	.object({
		stateRoot: z.string().min(1),
		workspaceRoot: z.string().min(1),
		host: z.string().min(1).default("127.0.0.1"),
		port: z.number().int().min(0).max(65_535).default(0),
		executionBaseUrl: loopbackUrl,
		modelBaseUrl: loopbackUrl,
		roles: z
			.array(
				z
					.object({
						agentPackageRef: z.enum(rolePackageRefs),
						registeredPackageVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
						roleRef: z.string().regex(/^g-[A-Za-z0-9_-]+$/),
						carrierUrl: z
							.url()
							.refine((value) => value.startsWith("https://chatgpt.com/g/")),
					})
					.strict(),
			)
			.default([]),
	})
	.strict()
	.superRefine((value, context) => {
		if (!loopbackHosts.has(value.host))
			context.addIssue({
				code: "custom",
				path: ["host"],
				message: "platform-host transport must bind to loopback",
			});
		const stateRoot = resolve(value.stateRoot);
		if (!isAbsolute(value.stateRoot) || basename(stateRoot) !== ".proflow")
			context.addIssue({
				code: "custom",
				path: ["stateRoot"],
				message: "stateRoot must be an absolute .proflow directory",
			});
		if (!isAbsolute(value.workspaceRoot))
			context.addIssue({
				code: "custom",
				path: ["workspaceRoot"],
				message: "workspaceRoot must be absolute",
			});
		for (const role of value.roles)
			if (role.carrierUrl !== `https://chatgpt.com/g/${role.roleRef}`)
				context.addIssue({
					code: "custom",
					path: ["roles"],
					message: "carrierUrl must exactly bind its roleRef",
				});
		if (
			new Set(value.roles.map((role) => role.agentPackageRef)).size !==
			value.roles.length
		)
			context.addIssue({
				code: "custom",
				path: ["roles"],
				message: "agentPackageRef registrations must be unique",
			});
		if (
			new Set(value.roles.map((role) => role.roleRef)).size !==
			value.roles.length
		)
			context.addIssue({
				code: "custom",
				path: ["roles"],
				message: "roleRef registrations must be unique",
			});
	})
	.transform((value) => ({
		...value,
		stateRoot: resolve(value.stateRoot),
		workspaceRoot: resolve(value.workspaceRoot),
	}));

export type PlatformHostConfig = z.infer<typeof configSchema>;
export const parsePlatformHostConfig = (value: unknown): PlatformHostConfig =>
	configSchema.parse(value);
export async function loadPlatformHostConfig(path: string) {
	return parsePlatformHostConfig(
		JSON.parse(await readFile(resolve(path), "utf8")),
	);
}

export type DependencyReadiness = {
	status: "READY" | "NOT_READY";
	liveness: "UP" | "DOWN";
	owner: "task" | "agent" | "execution" | "model";
	detail?: unknown;
};
export type PlatformHostStatus = {
	process: "STOPPED" | "STARTING" | "RUNNING" | "DRAINING";
	liveness: "UP" | "DOWN";
	transport: "UP" | "DOWN";
	readiness: "READY" | "NOT_READY";
	accepting: boolean;
	inFlight: number;
	dependencies: {
		task: DependencyReadiness;
		agent: DependencyReadiness;
		execution: DependencyReadiness;
		model: DependencyReadiness;
	};
};

type OwnerHttpClient = {
	readiness(): Promise<DependencyReadiness>;
	invoke(operationId: string, input: unknown): Promise<unknown>;
};

async function responseJson(response: Response): Promise<unknown> {
	const body = await response.text();
	const value = body.length ? JSON.parse(body) : undefined;
	if (!response.ok)
		throw Object.assign(new Error("OWNER_SERVICE_UNAVAILABLE"), {
			httpStatus: response.status,
			ownerResponse: value,
		});
	return value;
}

function createOwnerHttpClient(
	owner: "execution" | "model",
	baseUrl: string,
	credential?: string,
): OwnerHttpClient {
	return Object.freeze({
		async readiness() {
			try {
				const response = await fetch(`${baseUrl}/ready`, {
					signal: AbortSignal.timeout(2_000),
				});
				const text = await response.text();
				const detail = text.length ? JSON.parse(text) : undefined;
				return {
					owner,
					status: response.ok ? ("READY" as const) : ("NOT_READY" as const),
					liveness: "UP" as const,
					detail,
				};
			} catch (error) {
				return {
					owner,
					status: "NOT_READY" as const,
					liveness: "DOWN" as const,
					detail: error instanceof Error ? { error: error.message } : undefined,
				};
			}
		},
		async invoke(operationId, input) {
			let path: string;
			let method = "POST";
			if (owner === "model") {
				if (operationId === "getRuntimeStatus") {
					path = "/status";
					method = "GET";
				} else if (operationId === "infer") path = "/infer";
				else throw new Error("MODEL_OPERATION_NOT_ROUTED");
			} else if (operationId === "materializeExternalFiles")
				path = "/external-files/materialize";
			else if (operationId === "executeCapability") path = "/executions";
			else if (operationId === "cancelExecution") path = "/executions/cancel";
			else if (operationId === "readExecutionOutput")
				path = "/executions/output";
			else if (operationId === "getExecution") {
				const value = object(input, "getExecution input");
				path = `/executions/${encodeURIComponent(string(value.executionRef, "executionRef"))}`;
				method = "GET";
			} else throw new Error("EXECUTION_OPERATION_NOT_ROUTED");
			return responseJson(
				await fetch(`${baseUrl}${path}`, {
					method,
					headers: {
						...(credential ? { authorization: `Bearer ${credential}` } : {}),
						...(method === "POST"
							? { "content-type": "application/json" }
							: {}),
					},
					...(method === "POST"
						? {
								body: JSON.stringify(input),
							}
						: {}),
					signal: AbortSignal.timeout(45_000),
				}),
			);
		},
	});
}

function object(value: unknown, name: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new TypeError(`${name} must be an object`);
	return value as Record<string, unknown>;
}
function string(value: unknown, name: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError(`${name} must be a non-empty string`);
	return value;
}
function unwrap<Value>(result: {
	ok: boolean;
	data?: Value;
	error?: unknown;
}): Value {
	if (!result.ok || result.data === undefined)
		throw new Error(`OWNER_CONTRACT_FAILED:${JSON.stringify(result.error)}`);
	return result.data;
}

type Graph = Awaited<ReturnType<typeof constructGraph>>;

export type PlatformHostBrowserOwnerPorts = {
	task: {
		getWorkerBinding(taskId: string, roleRef: string): Promise<string | null>;
		bindWorker(input: {
			taskId: string;
			roleRef: string;
			workerRef: string;
			conversationLocator: string;
		}): Promise<void>;
	};
	agent: {
		getPendingMessage(messageRef: string): Promise<{
			messageId: string;
			threadId: string;
			taskId: string;
			kind: "QUESTION" | "REPLY";
			fromRoleRef: string;
			fromWorkerRef: string;
			targetRoleRef: string;
			targetWorkerRef: string;
			replyToMessageId: string | null;
			content: string;
			status: "PENDING";
		}>;
		reportPhysicalDelivery(
			messageRef: string,
			evidenceRef: string,
			executionRef: string,
		): Promise<void>;
	};
};

export type PlatformHostExecutionIdentityPort = {
	authorize(request: {
		callerRef: string;
		roleRef?: string | undefined;
		taskId?: string | undefined;
		nodeId?: string | undefined;
		runNo?: number | undefined;
		workerRef?: string | undefined;
		projectRoot?: string | undefined;
		capability: string;
		input: unknown;
	}): Promise<boolean>;
};

export type PlatformHostTaskDriverPorts = {
	getTask(taskId: string): Promise<{
		taskId: string;
		status: string;
		version: number;
		currentNodeId: string | null;
		roleBindings: Array<{ roleRef: string; workerRef: string | null }>;
	}>;
	getTaskDriveProjection(taskId: string): Promise<{
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
	}>;
	getNodeContext(
		taskId: string,
		nodeId: string,
	): Promise<{
		task: { taskId: string; status: string; version: number };
		node: {
			nodeId: string;
			status: string;
			version: number;
			runNo: number;
			requiredAgentPackageRef: string;
			workerRef: string | null;
		};
	}>;
	startTask(input: {
		taskId: string;
		expectedTaskVersion: number;
		idempotencyKey: string;
	}): Promise<unknown>;
	startNode(input: {
		taskId: string;
		nodeId: string;
		expectedTaskVersion: number;
		expectedNodeVersion: number;
		idempotencyKey: string;
	}): Promise<unknown>;
};

export type PlatformHostAgentIdentityPorts = {
	getRegisteredRole(roleRef: string): Promise<{ roleRef: string }>;
};

async function constructGraph(
	config: PlatformHostConfig,
	executionCredential?: string,
) {
	const databasePath = join(config.stateRoot, "state", "task.sqlite");
	const migration = applyMigrations({
		databasePath,
		migrations: taskMigrations,
	});
	if (!migration.ok)
		throw new Error(`TASK_MIGRATION_FAILED:${migration.error?.message}`);
	const taskStore = new SqliteTaskStore({ databasePath });
	const task = createTaskServices({
		store: taskStore,
		workspaceRoot: config.workspaceRoot,
	});
	const taskFacts = (taskId: string) => {
		const value = unwrap(task.queries.getTask({ taskId }));
		return {
			taskId: value.taskId,
			status: value.status,
			roleBindings: value.roleBindings,
		};
	};
	const taskIsTerminal = (status: string) =>
		status === "SUCCEEDED" || status === "TERMINATED";
	let agent: Awaited<ReturnType<typeof createAgentRuntime>>;
	try {
		agent = await createAgentRuntime({
			proflowRoot: config.stateRoot,
			task: {
				async getTask(taskId) {
					return taskFacts(taskId);
				},
				async hasNonTerminalRoleUsage(roleRef) {
					const summaries = unwrap(task.queries.listTasks({})).tasks;
					return summaries.some((summary) => {
						const current = taskFacts(summary.taskId);
						return (
							current.status !== "SUCCEEDED" &&
							current.status !== "TERMINATED" &&
							current.roleBindings.some(
								(binding) => binding.roleRef === roleRef,
							)
						);
					});
				},
			},
		});
	} catch (error) {
		taskStore.close();
		throw error;
	}
	try {
		for (const role of config.roles) {
			const existing = agent
				.listRegisteredRoles()
				.find(
					(candidate) => candidate.agentPackageRef === role.agentPackageRef,
				);
			if (existing) {
				if (
					existing.roleRef !== role.roleRef ||
					existing.carrierUrl !== role.carrierUrl ||
					existing.registeredPackageVersion !== role.registeredPackageVersion
				)
					throw new Error(`ROLE_REGISTRATION_DRIFT:${role.agentPackageRef}`);
			} else await agent.registerRole(role);
		}
	} catch (error) {
		agent.close();
		taskStore.close();
		throw error;
	}
	const execution = createOwnerHttpClient(
		"execution",
		config.executionBaseUrl,
		executionCredential,
	);
	const model = createOwnerHttpClient("model", config.modelBaseUrl);
	const taskOperations = new Map<string, (input: unknown) => unknown>();
	for (const name of publicOperationNames) {
		const candidate =
			Reflect.get(task.commands, name) ??
			Reflect.get(task.queries, name) ??
			Reflect.get(task.documents, name);
		if (typeof candidate === "function")
			taskOperations.set(name, candidate as (input: unknown) => unknown);
	}
	const queryOperations = new Set([
		"getTaskGroup",
		"listTasks",
		"getTask",
		"getTaskDriveProjection",
		"getNodeContext",
		"listPendingMessages",
		"listTaskEvents",
		"getTaskDocument",
	]);
	const taskMutationOperations = new Set([
		"startNode",
		"completeNode",
		"waitNode",
		"failNode",
		"reopenNode",
		"putTaskDocument",
	]);
	// Unified external Task-scoped Action admission. TaskRoleBinding is a Task
	// owner fact, so participant + canonical Worker identity are derived from the
	// Task owner facts, never from an untrusted body roleRef/workerRef. Reads only
	// gate participation (terminal Tasks stay readable); mutations and Execution
	// additionally run the full Agent Worker validation (which rejects terminal
	// Tasks) before acting.
	const admitTaskParticipant = async (
		taskId: string,
		authenticatedRoleRef: string,
		suppliedWorkerRef?: string,
	): Promise<string> => {
		const binding = taskFacts(taskId).roleBindings.find(
			(candidate) => candidate.roleRef === authenticatedRoleRef,
		);
		if (!binding?.workerRef)
			throw Object.assign(new Error("TASK_ROLE_BINDING_REQUIRED"), {
				httpStatus: 403,
			});
		if (
			suppliedWorkerRef !== undefined &&
			suppliedWorkerRef !== binding.workerRef
		)
			throw Object.assign(new Error("TASK_WORKER_BINDING_MISMATCH"), {
				httpStatus: 403,
			});
		return binding.workerRef;
	};
	const route = async (
		operationId: string,
		authenticatedRoleRef: string,
		rawInput: unknown,
		context?: { fileMaterializationInputs?: unknown },
	) => {
		const role = agent.getRegisteredRole(authenticatedRoleRef);
		if (
			!roleOperations[role.agentPackageRef as RolePackageRef]?.has(operationId)
		)
			throw Object.assign(new Error("ROLE_OPERATION_DENIED"), {
				httpStatus: 403,
			});
		const input = object(rawInput, "action input");
		if (operationId === "askPeer")
			return agent.askPeer({ ...input, authenticatedRoleRef });
		if (operationId === "replyPeer")
			return agent.replyPeer({ ...input, authenticatedRoleRef });
		const taskOperation = taskOperations.get(operationId);
		if (taskOperation) {
			let actorRef = authenticatedRoleRef;
			if (typeof input.taskId === "string") {
				const workerRef = await admitTaskParticipant(
					input.taskId,
					authenticatedRoleRef,
					typeof input.workerRef === "string" ? input.workerRef : undefined,
				);
				if (taskMutationOperations.has(operationId))
					await agent.validateWorker({
						authenticatedRoleRef,
						taskId: input.taskId,
						workerRef,
					});
				actorRef = workerRef;
			}
			let canonicalTaskInput = input;
			if (context?.fileMaterializationInputs !== undefined) {
				if (operationId !== "putTaskDocument")
					throw Object.assign(
						new Error("FILE_MATERIALIZATION_UNSUPPORTED_OPERATION"),
						{ httpStatus: 400 },
					);
				const result = object(
					await execution.invoke("materializeExternalFiles", {
						contract: "execution.external-file-materialization",
						contractVersion: "1.0.0",
						callerRef: authenticatedRoleRef,
						files: context.fileMaterializationInputs,
					}),
					"carrier file materialization result",
				);
				if (!Array.isArray(result.files) || result.files.length !== 1)
					throw Object.assign(new Error("FILE_MATERIALIZATION_COUNT_INVALID"), {
						httpStatus: 400,
					});
				const file = object(result.files[0], "materialized carrier file");
				const content = string(
					file.content,
					"materialized carrier file content",
				);
				canonicalTaskInput = { ...input, content };
			}
			return taskOperation(
				queryOperations.has(operationId)
					? canonicalTaskInput
					: { ...canonicalTaskInput, actorRef },
			);
		}
		if (operationId === "executeCapability") {
			const taskId =
				typeof input.taskId === "string" ? input.taskId : undefined;
			let canonicalWorkerRef: string | undefined;
			if (taskId) {
				canonicalWorkerRef = await admitTaskParticipant(
					taskId,
					authenticatedRoleRef,
					typeof input.workerRef === "string" ? input.workerRef : undefined,
				);
				await agent.validateWorker({
					authenticatedRoleRef,
					taskId,
					workerRef: canonicalWorkerRef,
				});
			}
			return execution.invoke(operationId, {
				...input,
				callerRef: authenticatedRoleRef,
				roleRef: authenticatedRoleRef,
				...(canonicalWorkerRef !== undefined
					? { workerRef: canonicalWorkerRef }
					: {}),
			});
		}
		if (operationId === "getExecution" || operationId === "readExecutionOutput")
			return execution.invoke(operationId, input);
		throw new Error("OPERATION_NOT_ROUTED");
	};
	const browserOwnerPorts: PlatformHostBrowserOwnerPorts = Object.freeze({
		task: Object.freeze({
			async getWorkerBinding(taskId: string, roleRef: string) {
				return (
					taskFacts(taskId).roleBindings.find(
						(binding) => binding.roleRef === roleRef,
					)?.workerRef ?? null
				);
			},
		async bindWorker(binding: {
			taskId: string;
			roleRef: string;
			workerRef: string;
			conversationLocator: string;
		}) {
			const current = unwrap(
				task.queries.getTask({ taskId: binding.taskId }),
			);
			const declared = current.roleBindings.find(
				(item) => item.roleRef === binding.roleRef,
			);
			if (!declared)
				throw new Error("AGENT_PACKAGE_NOT_ELIGIBLE");
			if (declared.workerRef === binding.workerRef) return;
			if (declared.workerRef) throw new Error("TASK_ROLE_BINDING_CONFLICT");
			unwrap(
				task.commands.bindTaskWorker({
					taskId: binding.taskId,
					agentPackageRef: declared.agentPackageRef,
					roleRef: binding.roleRef,
					workerRef: binding.workerRef,
					conversationLocator: binding.conversationLocator,
					expectedTaskVersion: current.version,
					actorRef: "platform-host:worker-provisioning",
					idempotencyKey: `browser-bind:${binding.taskId}:${binding.roleRef}:${binding.workerRef}`,
				}),
			);
		},
		}),
		agent: Object.freeze({
			async getPendingMessage(messageRef: string) {
				const message = agent.getCollaborationMessage({
					messageId: messageRef,
				});
				if (message.status !== "PENDING")
					throw new Error("COLLABORATION_MESSAGE_NOT_PENDING");
				// A terminal Task must never re-enter the physical Browser delivery path.
				if (taskIsTerminal(taskFacts(message.taskId).status))
					throw new Error("TASK_TERMINAL");
				return { ...message, status: "PENDING" as const };
			},
			async reportPhysicalDelivery(
				messageRef: string,
				evidenceRef: string,
				executionRef: string,
			) {
				const message = agent.getCollaborationMessage({
					messageId: messageRef,
				});
				if (message.status === "DELIVERED") return;
				await agent.reportCollaborationDelivery({
					messageId: message.messageId,
					expectedMessageVersion: message.version,
					outcome: "DELIVERED",
					observedRoleRef: message.targetRoleRef,
					observedWorkerRef: message.targetWorkerRef,
					executionRef,
					evidenceRef,
				});
			},
		}),
	});
	const authorizeExecution: PlatformHostExecutionIdentityPort["authorize"] =
		async (request) => {
			try {
				const browserCapability =
					request.capability === "worker.create" ||
					request.capability === "worker.restore" ||
					request.capability === "worker.wake" ||
					request.capability === "collaboration.deliver";
				const internalTaskObserver =
					request.callerRef === "platform-host:task-observer";
				if (!internalTaskObserver) agent.getRegisteredRole(request.callerRef);
				if (
					request.roleRef &&
					!internalTaskObserver &&
					request.roleRef !== request.callerRef
				)
					return false;
				if (
					request.projectRoot &&
					resolve(request.projectRoot) !== config.workspaceRoot
				)
					return false;
				if ((request.nodeId || request.runNo) && !request.taskId) return false;
				if (request.workerRef && !request.taskId) return false;
				if (internalTaskObserver && (!browserCapability || !request.taskId))
					return false;
				if (browserCapability && !request.taskId) return false;
				if (request.taskId) {
					const taskFact = taskFacts(request.taskId);
					if (
						request.capability === "collaboration.deliver" &&
						taskIsTerminal(taskFact.status)
					)
						return false;
					if (request.workerRef && !internalTaskObserver)
						await agent.validateWorker({
							authenticatedRoleRef: request.callerRef,
							taskId: request.taskId,
							workerRef: request.workerRef,
						});
					if (request.nodeId)
						unwrap(
							task.queries.getNodeContext({
								taskId: request.taskId,
								nodeId: request.nodeId,
								...(request.runNo ? { runNo: request.runNo } : {}),
							}),
						);
					const browserInput = object(request.input, "execution input");
					if (browserCapability) {
						const targetRoleRef = string(browserInput.roleRef, "input.roleRef");
						agent.getRegisteredRole(targetRoleRef);
						const binding = taskFact.roleBindings.find(
							(candidate) => candidate.roleRef === targetRoleRef,
						);
						if (!binding) return false;
						if (!internalTaskObserver && targetRoleRef !== request.callerRef)
							return false;
						if (request.capability !== "worker.create") {
							const targetWorkerRef = string(
								browserInput.workerRef,
								"input.workerRef",
							);
							if (binding.workerRef !== targetWorkerRef) return false;
						}
					}
				}
				return true;
			} catch {
				return false;
			}
		};
	const taskDriverPorts: PlatformHostTaskDriverPorts = Object.freeze({
		async getTask(taskId: string) {
			const current = unwrap(task.queries.getTask({ taskId }));
			return {
				taskId: current.taskId,
				status: current.status,
				version: current.version,
				currentNodeId: current.currentNodeId,
				roleBindings: current.roleBindings,
			};
		},
		async getNodeContext(taskId: string, nodeId: string) {
			const current = unwrap(task.queries.getNodeContext({ taskId, nodeId }));
			return {
				task: {
					taskId: current.task.taskId,
					status: current.task.status,
					version: current.task.version,
				},
			node: {
				nodeId: current.node.nodeId,
				status: current.node.status,
				version: current.node.version,
				runNo: current.node.runNo,
				requiredAgentPackageRef: current.node.requiredAgentPackageRef,
				workerRef: current.node.workerRef,
			},
		};
	},
	async getTaskDriveProjection(taskId: string) {
		return unwrap(task.queries.getTaskDriveProjection({ taskId }));
	},
	async startTask(input) {
		return unwrap(
			task.commands.startTask({
				...input,
				actorRef: "platform-host:task-observer",
			}),
		);
	},
	async startNode(input) {
		return unwrap(
			task.commands.startNode({
				...input,
				actorRef: "platform-host:task-observer",
			}),
		);
	},
});
	const agentIdentityPorts: PlatformHostAgentIdentityPorts = Object.freeze({
		async getRegisteredRole(roleRef) {
			const role = agent.getRegisteredRole(roleRef);
			return { roleRef: role.roleRef };
		},
	});
	return Object.freeze({
		route,
		browserOwnerPorts,
		authorizeExecution,
		taskDriverPorts,
		agentIdentityPorts,
		async lookup(
			operationId: string,
			authenticatedRoleRef: string,
			input: unknown,
		) {
			const value = object(input, "lookup input");
			if (operationId === "executeCapability" && value.executionRef)
				return execution.invoke("getExecution", value);
			return route(operationId, authenticatedRoleRef, value);
		},
		async readiness() {
			const diagnostics = taskStore.diagnostics();
			const taskStatus: DependencyReadiness = {
				owner: "task",
				status: diagnostics.integrity === "ok" ? "READY" : "NOT_READY",
				liveness: "UP",
				detail: diagnostics,
			};
			const agentDoctor = agent.doctorRoleStore();
			const agentStatus: DependencyReadiness = {
				owner: "agent",
				status: agentDoctor.status === "PASS" ? "READY" : "NOT_READY",
				liveness: "UP",
				detail: agentDoctor,
			};
			const [executionStatus, modelStatus] = await Promise.all([
				execution.readiness(),
				model.readiness(),
			]);
			return {
				task: taskStatus,
				agent: agentStatus,
				execution: executionStatus,
				model: modelStatus,
			};
		},
		close() {
			agent.close();
			taskStore.close();
		},
	});
}

export function createPlatformHost(input: {
	config: PlatformHostConfig;
	log?: (entry: Record<string, unknown>) => void;
	executionCredential?: string;
}) {
	if (input.executionCredential && input.executionCredential.length < 32)
		throw new TypeError(
			"execution credential must contain at least 32 characters",
		);
	let lifecycle: PlatformHostStatus["process"] = "STOPPED";
	let accepting = false;
	let graph: Graph | undefined;
	let server: Server | undefined;
	const active = new Set<Promise<void>>();
	const log = (event: string, detail: Record<string, unknown> = {}) =>
		input.log?.({
			timestamp: new Date().toISOString(),
			component: "platform-host-process",
			event,
			...detail,
		});
	const stoppedDependencies = (): PlatformHostStatus["dependencies"] => ({
		task: { owner: "task", status: "NOT_READY", liveness: "DOWN" },
		agent: { owner: "agent", status: "NOT_READY", liveness: "DOWN" },
		execution: {
			owner: "execution",
			status: "NOT_READY",
			liveness: "DOWN",
		},
		model: { owner: "model", status: "NOT_READY", liveness: "DOWN" },
	});
	const status = async (): Promise<PlatformHostStatus> => {
		const dependencies = graph
			? await graph.readiness()
			: stoppedDependencies();
		return {
			process: lifecycle,
			liveness: lifecycle === "STOPPED" ? "DOWN" : "UP",
			transport: server ? "UP" : "DOWN",
			readiness:
				accepting &&
				Object.values(dependencies).every((item) => item.status === "READY")
					? "READY"
					: "NOT_READY",
			accepting,
			inFlight: active.size,
			dependencies,
		};
	};
	const browserOwnerPorts: PlatformHostBrowserOwnerPorts = Object.freeze({
		task: Object.freeze({
			async getWorkerBinding(taskId: string, roleRef: string) {
				if (!graph) throw new Error("PLATFORM_HOST_NOT_RUNNING");
				return graph.browserOwnerPorts.task.getWorkerBinding(taskId, roleRef);
			},
		async bindWorker(binding: {
			taskId: string;
			roleRef: string;
			workerRef: string;
			conversationLocator: string;
		}) {
			if (!graph) throw new Error("PLATFORM_HOST_NOT_RUNNING");
			return graph.browserOwnerPorts.task.bindWorker(binding);
		},
		}),
		agent: Object.freeze({
			async getPendingMessage(messageRef: string) {
				if (!graph) throw new Error("PLATFORM_HOST_NOT_RUNNING");
				return graph.browserOwnerPorts.agent.getPendingMessage(messageRef);
			},
			async reportPhysicalDelivery(
				messageRef: string,
				evidenceRef: string,
				executionRef: string,
			) {
				if (!graph) throw new Error("PLATFORM_HOST_NOT_RUNNING");
				return graph.browserOwnerPorts.agent.reportPhysicalDelivery(
					messageRef,
					evidenceRef,
					executionRef,
				);
			},
		}),
	});
	const executionIdentity: PlatformHostExecutionIdentityPort = Object.freeze({
		async authorize(request) {
			if (!graph) return false;
			return graph.authorizeExecution(request);
		},
	});
	const taskDriverPorts: PlatformHostTaskDriverPorts = Object.freeze({
		async getTask(taskId) {
			if (!graph) throw new Error("PLATFORM_HOST_NOT_RUNNING");
			return graph.taskDriverPorts.getTask(taskId);
		},
		async getTaskDriveProjection(taskId) {
			if (!graph) throw new Error("PLATFORM_HOST_NOT_RUNNING");
			return graph.taskDriverPorts.getTaskDriveProjection(taskId);
		},
		async getNodeContext(taskId, nodeId) {
			if (!graph) throw new Error("PLATFORM_HOST_NOT_RUNNING");
			return graph.taskDriverPorts.getNodeContext(taskId, nodeId);
		},
		async startTask(input) {
			if (!graph) throw new Error("PLATFORM_HOST_NOT_RUNNING");
			return graph.taskDriverPorts.startTask(input);
		},
		async startNode(input) {
			if (!graph) throw new Error("PLATFORM_HOST_NOT_RUNNING");
			return graph.taskDriverPorts.startNode(input);
		},
	});
	const agentIdentityPorts: PlatformHostAgentIdentityPorts = Object.freeze({
		async getRegisteredRole(roleRef) {
			if (!graph) throw new Error("PLATFORM_HOST_NOT_RUNNING");
			return graph.agentIdentityPorts.getRegisteredRole(roleRef);
		},
	});
	const respond = (
		response: import("node:http").ServerResponse,
		code: number,
		value: unknown,
	) => {
		response.writeHead(code, {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
		});
		response.end(JSON.stringify(value));
	};
	const start = async () => {
		if (lifecycle !== "STOPPED")
			throw new Error("platform-host is not stopped");
		lifecycle = "STARTING";
		try {
			log("DEPENDENCY_INITIALIZATION_STARTED", {
				order: ["task", "agent", "execution-client", "model-client"],
			});
			graph = await constructGraph(input.config, input.executionCredential);
			await graph.readiness();
			server = createServer((request, response) => {
				const work = (async () => {
					const url = new URL(request.url ?? "/", "http://platform-host.local");
					if (request.method === "GET" && url.pathname === "/health")
						return respond(response, 200, {
							status: lifecycle === "STOPPED" ? "DOWN" : "UP",
						});
					if (request.method === "GET" && url.pathname === "/ready") {
						const current = await status();
						return respond(
							response,
							current.readiness === "READY" ? 200 : 503,
							current,
						);
					}
					if (!accepting || !graph)
						return respond(response, 503, { error: "SERVICE_DRAINING" });
					try {
						if (
							request.method !== "POST" ||
							!url.pathname.startsWith("/actions/")
						)
							return respond(response, 404, { error: "NOT_FOUND" });
						const chunks: Buffer[] = [];
						let bytes = 0;
						for await (const chunk of request) {
							const buffer = Buffer.isBuffer(chunk)
								? chunk
								: Buffer.from(chunk);
							bytes += buffer.byteLength;
							if (bytes > 1_048_576)
								throw new TypeError("REQUEST_BODY_TOO_LARGE");
							chunks.push(buffer);
						}
						const body = object(
							JSON.parse(Buffer.concat(chunks).toString("utf8")),
							"owner request",
						);
						const authenticatedRoleRef = string(
							body.authenticatedRoleRef,
							"authenticatedRoleRef",
						);
						const suffix = url.pathname.slice("/actions/".length);
						const lookup = suffix.endsWith("/result");
						const operationId = decodeURIComponent(
							lookup ? suffix.slice(0, -"/result".length) : suffix,
						);
						const result = lookup
							? await graph.lookup(
									operationId,
									authenticatedRoleRef,
									body.input,
								)
							: await graph.route(
									operationId,
									authenticatedRoleRef,
									body.input,
									body.fileMaterializationInputs === undefined
										? undefined
										: {
												fileMaterializationInputs:
													body.fileMaterializationInputs,
											},
								);
						respond(response, 200, result);
					} catch (error) {
						const httpStatus =
							typeof error === "object" && error !== null
								? Reflect.get(error, "httpStatus")
								: undefined;
						respond(
							response,
							typeof httpStatus === "number" ? httpStatus : 400,
							{
								error:
									error instanceof Error ? error.message : "INVALID_REQUEST",
							},
						);
					}
				})();
				active.add(work);
				void work.finally(() => active.delete(work));
			});
			await new Promise<void>((resolveStart, reject) => {
				server?.once("error", reject);
				server?.listen(input.config.port, input.config.host, resolveStart);
			});
			accepting = true;
			lifecycle = "RUNNING";
			const address = server.address();
			if (!address || typeof address === "string")
				throw new Error("platform-host missing TCP address");
			log("SERVICE_STARTED", { host: input.config.host, port: address.port });
			return { host: input.config.host, port: address.port };
		} catch (error) {
			accepting = false;
			server?.close();
			server = undefined;
			graph?.close();
			graph = undefined;
			lifecycle = "STOPPED";
			throw error;
		}
	};
	const stop = async () => {
		if (lifecycle === "STOPPED") return;
		lifecycle = "DRAINING";
		accepting = false;
		const running = server;
		server = undefined;
		if (running)
			await new Promise<void>((resolveStop, reject) =>
				running.close((error) => (error ? reject(error) : resolveStop())),
			);
		await Promise.allSettled([...active]);
		graph?.close();
		graph = undefined;
		lifecycle = "STOPPED";
		log("SERVICE_STOPPED");
	};
	return Object.freeze({
		start,
		stop,
		status,
		browserOwnerPorts,
		executionIdentity,
		taskDriverPorts,
		agentIdentityPorts,
		async restart() {
			await stop();
			return start();
		},
	});
}
