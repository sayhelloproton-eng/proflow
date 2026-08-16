import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import {
	appendFile,
	chmod,
	mkdir,
	readFile,
	stat,
	writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { createAgentRuntime } from "@tomflow/proflow-agent-runtime";
import type { SystemObserverView } from "@tomflow/proflow-execution-browser-extension";
import type { ExecuteCapabilityRequest } from "@tomflow/proflow-execution-contracts";
import { applyMigrations } from "@tomflow/proflow-task-migration-runner";
import {
	createTaskServices,
	publicOperationNames,
} from "@tomflow/proflow-task-orchestration";
import { SqliteTaskStore } from "@tomflow/proflow-task-store-sqlite";
import { taskMigrations } from "@tomflow/proflow-task-store-sqlite/migrations";
import { z } from "zod";

import {
	type RolePackageRef,
	roleOperations,
	rolePackageRefs,
} from "./role-operations.ts";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const systemObserverReasonResultSchema = z
	.object({
		scope: z.string().min(1).max(240).optional(),
		health: z.enum(["HEALTHY", "DEGRADED", "CRITICAL", "UNKNOWN"]),
		findings: z.array(z.string()).max(128),
		risks: z.array(z.string()).max(128),
		anomalies: z.array(z.string()).max(128),
		hypotheses: z.array(z.string()).max(128),
		unresolved: z.array(z.string()).max(128),
		needsDrilldown: z.array(z.string()).max(128),
		evidenceRefs: z.array(z.string()).max(128),
		confidence: z.number().min(0).max(1),
		carryForward: z
			.array(
				z
					.object({
						hypothesis: z.string().min(1),
						risk: z.string().min(1).optional(),
						evidenceRef: z.string().min(1).optional(),
						confidence: z.number().min(0).max(1),
					})
					.strict(),
			)
			.max(64),
		rationale: z.string().min(1),
	})
	.strict();

const browserStructuredLogSchema = z
	.object({
		timestamp: z.string().datetime(),
		level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]),
		component: z.string().min(1).max(100),
		capability: z.string().min(1).max(160).optional(),
		operation: z.string().min(1).max(160).optional(),
		status: z.string().min(1).max(80).optional(),
		errorCode: z.string().min(1).max(160).optional(),
		correlationId: z.string().min(1).max(240).optional(),
		taskId: z.string().min(1).max(240).optional(),
		nodeId: z.string().min(1).max(240).optional(),
		runNo: z.number().int().nonnegative().optional(),
		agentPackageRef: z.string().min(1).max(240).optional(),
		roleRef: z.string().min(1).max(240).optional(),
		workerRef: z.string().min(1).max(240).optional(),
		executionRef: z.string().min(1).max(240).optional(),
		messageRef: z.string().min(1).max(240).optional(),
		artifactRef: z.string().min(1).max(240).optional(),
		evidenceRef: z.string().min(1).max(240).optional(),
		conversationLocator: z.string().min(1).max(1_000).optional(),
		operationRef: z.string().min(1).max(240).optional(),
		attemptNo: z.number().int().nonnegative().optional(),
		tabId: z.number().int().nonnegative().optional(),
	})
	.strict();

const taskDiagnosticReasonResultSchema = z
	.object({
		finding: z.string().min(1).max(1_000),
		probableCause: z.string().min(1).max(1_000),
		confidence: z.number().min(0).max(1),
		recommendedNextObservation: z.string().min(1).max(1_000),
		recommendedRecoveryAction: z.string().min(1).max(1_000),
		needsHumanAttention: z.boolean(),
	})
	.strict();

// GPT transport/application boundary descriptor for an allowed TaskDocument.
// The Task Owner keeps returning a plain TaskDocument; only after admission
// succeeds does the Host convert the allowed document into this bounded file
// descriptor. The Gateway owns the OpenAI wire format, owns the matching
// `fileArtifacts` schema, and validates this output at the boundary.
interface TaskDocumentFileBridgeOutput {
	fileArtifacts: Array<{
		artifactRef: string;
		name: string;
		mimeType: string;
		content: string;
	}>;
}

const taskDocumentFileSchema = z.object({
	taskId: z.string().min(1),
	documentType: z.string().min(1),
	contentHash: z.string().min(1),
	content: z.string().min(1),
});

function fileBridgeOutputForTaskResult(result: unknown): unknown {
	if (typeof result !== "object" || result === null || !("ok" in result))
		return result;
	const record = result as Record<string, unknown>;
	if (record.ok !== true) return result;
	const document = taskDocumentFileSchema.parse(record.data);
	const output: TaskDocumentFileBridgeOutput = {
		fileArtifacts: [
			{
				artifactRef: `document:${document.taskId}:${document.documentType}`,
				name: `${document.documentType.toLowerCase().replaceAll("_", "-")}.md`,
				mimeType: "text/markdown",
				content: document.content,
			},
		],
	};
	return output;
}

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
		executionTransportCredentialFile: z.string().min(1).optional(),
		modelBaseUrl: loopbackUrl,
		modelTransportCredentialFile: z.string().min(1).optional(),
		gatewayTransportCredentialFile: z.string().min(1).optional(),
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
		...(value.modelTransportCredentialFile
			? {
					modelTransportCredentialFile: resolve(
						value.modelTransportCredentialFile,
					),
				}
			: {}),
		...(value.executionTransportCredentialFile
			? {
					executionTransportCredentialFile: resolve(
						value.executionTransportCredentialFile,
					),
				}
			: {}),
		...(value.gatewayTransportCredentialFile
			? {
					gatewayTransportCredentialFile: resolve(
						value.gatewayTransportCredentialFile,
					),
				}
			: {}),
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
					headers: credential ? { authorization: `Bearer ${credential}` } : {},
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
			let callerContext: string | undefined;
			let requestBody: unknown = input;
			if (owner === "model") {
				if (operationId === "getRuntimeStatus") {
					path = "/status";
					method = "GET";
				} else if (operationId === "infer") path = "/infer";
				else throw new Error("MODEL_OPERATION_NOT_ROUTED");
			} else if (operationId === "materializeExternalFiles")
				path = "/external-files/materialize";
			else if (operationId === "executeCapability") path = "/executions";
			else if (operationId === "lookupExecutionIntent")
				path = "/executions/lookup";
			else if (operationId === "listExecutionObserverSignals")
				path = "/observer-signals/list";
			else if (operationId === "getCarrierSummary") {
				path = "/carrier/summary";
				method = "GET";
			} else if (operationId === "getArtifactSummary") {
				path = "/artifacts/summary";
				method = "GET";
			} else if (operationId === "acknowledgeExecutionObserverSignal")
				path = "/observer-signals/ack";
			else if (operationId === "cancelExecution") path = "/executions/cancel";
			else if (operationId === "readExecutionOutput") {
				const value = object(input, "readExecutionOutput input");
				callerContext = string(value.callerRef, "callerRef");
				requestBody = Object.fromEntries(
					Object.entries(value).filter(([key]) => key !== "callerRef"),
				);
				path = "/executions/output";
			} else if (operationId === "requestExecutionApproval")
				path = "/approvals/request";
			else if (operationId === "decideExecutionApproval")
				path = "/approvals/decide";
			else if (operationId === "revokeExecutionApproval")
				path = "/approvals/revoke";
			else if (operationId === "listExecutionApprovals")
				path = "/approvals/list";
			else if (operationId === "getExecutionApproval") {
				const value = object(input, "getExecutionApproval input");
				path = `/approvals/${encodeURIComponent(string(value.approvalRef, "approvalRef"))}`;
				method = "GET";
			} else if (operationId === "getExecution") {
				const value = object(input, "getExecution input");
				callerContext = string(value.callerRef, "callerRef");
				path = `/executions/${encodeURIComponent(string(value.executionRef, "executionRef"))}`;
				method = "GET";
			} else throw new Error("EXECUTION_OPERATION_NOT_ROUTED");
			return responseJson(
				await fetch(`${baseUrl}${path}`, {
					method,
					headers: {
						...(credential ? { authorization: `Bearer ${credential}` } : {}),
						...(callerContext ? { "x-proflow-caller-ref": callerContext } : {}),
						...(method === "POST"
							? { "content-type": "application/json" }
							: {}),
					},
					...(method === "POST"
						? {
								body: JSON.stringify(requestBody),
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

// Bounded read of the Deployment owner's explicit System Observer projection.
// Platform Host never reads Deployment's internal state.json or derives health;
// it consumes only the bounded summary emitted by Deployment status/verify/doctor.
async function readDeploymentOwnerSummary(stateRoot: string): Promise<
	| {
			state: "READY" | "DEGRADED" | "ACTION_REQUIRED" | "NOT_READY";
			source: "status" | "verify" | "doctor";
			selectedModuleCount: number;
			totalModuleCount: number;
			observedModuleCount: number;
			blockingModuleCount: number;
			observedAt: string;
			freshUntil: string;
	  }
	| undefined
> {
	try {
		const raw = await readFile(
			join(stateRoot, "deployment", "observer-summary.json"),
			"utf8",
		);
		const value: unknown = JSON.parse(raw);
		if (typeof value !== "object" || value === null || Array.isArray(value))
			return undefined;
		const record = value as Record<string, unknown>;
		if (
			record.contract !== "proflow.deployment-observer-summary.v1" ||
			record.scope !== "PLATFORM"
		)
			return undefined;
		if (
			!new Set(["READY", "DEGRADED", "ACTION_REQUIRED", "NOT_READY"]).has(
				String(record.state),
			) ||
			!new Set(["status", "verify", "doctor"]).has(String(record.source)) ||
			typeof record.selectedModuleCount !== "number" ||
			typeof record.totalModuleCount !== "number" ||
			typeof record.observedModuleCount !== "number" ||
			typeof record.blockingModuleCount !== "number" ||
			typeof record.observedAt !== "string" ||
			typeof record.freshUntil !== "string" ||
			Number.isNaN(Date.parse(record.observedAt)) ||
			Number.isNaN(Date.parse(record.freshUntil)) ||
			record.selectedModuleCount !== record.totalModuleCount ||
			Date.parse(record.freshUntil) <= Date.now()
		) {
			return undefined;
		}
		return {
			state: record.state as
				| "READY"
				| "DEGRADED"
				| "ACTION_REQUIRED"
				| "NOT_READY",
			source: record.source as "status" | "verify" | "doctor",
			selectedModuleCount: record.selectedModuleCount,
			totalModuleCount: record.totalModuleCount,
			observedModuleCount: record.observedModuleCount,
			blockingModuleCount: record.blockingModuleCount,
			observedAt: record.observedAt,
			freshUntil: record.freshUntil,
		};
	} catch {
		return undefined;
	}
}

type Graph = Awaited<ReturnType<typeof constructGraph>>;

export type PlatformHostBrowserOwnerPorts = {
	task: {
		getWorkerBinding(
			taskId: string,
			roleRef: string,
		): Promise<{
			workerRef: string;
			conversationLocator: string | null;
		} | null>;
		bindWorker(input: {
			taskId: string;
			roleRef: string;
			workerRef: string;
			conversationLocator: string;
		}): Promise<void>;
	};
	agent: {
		listPendingMessages(limit: number): Promise<
			Array<{
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
				deliveryAttemptCount: number;
				lastDeliveryErrorCode: string | null;
				executionRef: string | null;
				evidenceRef: string | null;
			}>
		>;
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
			deliveryAttemptCount: number;
			lastDeliveryErrorCode: string | null;
			executionRef: string | null;
			evidenceRef: string | null;
		}>;
		reportDeliveryOutcome(input: {
			messageRef: string;
			outcome: "DELIVERED" | "FAILED" | "UNKNOWN";
			executionRef?: string;
			evidenceRef?: string;
			errorCode?: string;
		}): Promise<void>;
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

export type PlatformHostRoleManagement = {
	invoke(operation: string, input: unknown): Promise<unknown>;
};

async function constructGraph(
	config: PlatformHostConfig,
	executionCredential?: string,
	modelCredential?: string,
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
	const model = createOwnerHttpClient(
		"model",
		config.modelBaseUrl,
		modelCredential,
	);
	const boundedSystemView = async (view: SystemObserverView) => {
		if (view === "task") {
			const tasks = unwrap(task.queries.listTasks({})).tasks;
			return {
				summary: `tasks=${tasks.length}; active=${tasks.filter((item) => item.status === "ACTIVE").length}; ready=${tasks.filter((item) => item.status === "READY").length}`,
				health: "HEALTHY" as const,
			};
		}
		if (view === "worker") {
			const tasks = unwrap(task.queries.listTasks({})).tasks;
			let bindings = 0;
			let missingLocator = 0;
			for (const summary of tasks)
				for (const binding of taskFacts(summary.taskId).roleBindings) {
					if (binding.workerRef) bindings += 1;
					if (binding.workerRef && !binding.conversationLocator)
						missingLocator += 1;
				}
			return {
				summary: `boundWorkers=${bindings}; missingConversationLocator=${missingLocator}`,
				health:
					missingLocator === 0 ? ("HEALTHY" as const) : ("DEGRADED" as const),
			};
		}
		if (view === "collaboration") {
			const pending = await agent.listPendingCollaborationMessages({
				limit: 100,
			});
			return {
				summary: `pendingMessages=${pending.length}`,
				health:
					pending.length < 100 ? ("HEALTHY" as const) : ("DEGRADED" as const),
			};
		}
		if (view === "model") {
			const status = object(
				await model.invoke("getRuntimeStatus", {}),
				"model status",
			);
			return {
				summary: JSON.stringify(status).slice(0, 2_000),
				health:
					status.runtime === "READY"
						? ("HEALTHY" as const)
						: ("DEGRADED" as const),
			};
		}
		if (view === "execution") {
			const readiness = await execution.readiness();
			const signalResult = object(
				await execution.invoke("listExecutionObserverSignals", { limit: 50 }),
				"execution observer signals",
			);
			const signals = Array.isArray(signalResult.signals)
				? signalResult.signals
				: [];
			return {
				summary: `execution owner readiness=${readiness.status}; liveness=${readiness.liveness}; pendingObserverSignals=${signals.length}`,
				health:
					readiness.status === "READY"
						? ("HEALTHY" as const)
						: ("DEGRADED" as const),
			};
		}
		if (view === "carrier") {
			const carrier = object(
				await execution.invoke("getCarrierSummary", {}),
				"carrier summary",
			);
			const online = carrier.online === true;
			return {
				summary: `bridgeOnline=${online}; queuedCommands=${carrier.queuedCommands ?? 0}; pendingCommands=${carrier.pendingCommands ?? 0}`,
				health: online ? ("HEALTHY" as const) : ("DEGRADED" as const),
			};
		}
		if (view === "deployment") {
			const deployment = await readDeploymentOwnerSummary(config.stateRoot);
			if (deployment === undefined) {
				return {
					summary: "deployment owner summary unavailable",
					health: "UNKNOWN" as const,
					projectionStatus: "UNAVAILABLE" as const,
					findings: [
						"Deployment current state is not materialized; no substitute owner readiness is inferred",
					],
				};
			}
			return {
				summary: `deploymentOwnerState=${deployment.state}; source=${deployment.source}; selectedModules=${deployment.selectedModuleCount}; observedModules=${deployment.observedModuleCount}; blockingModules=${deployment.blockingModuleCount}; observedAt=${deployment.observedAt}`,
				health:
					deployment.state === "READY"
						? ("HEALTHY" as const)
						: ("DEGRADED" as const),
				findings:
					deployment.state === "READY"
						? []
						: [`Deployment owner reports ${deployment.state}`],
			};
		}
		if (view === "artifact") {
			const artifacts = object(
				await execution.invoke("getArtifactSummary", {}),
				"artifact summary",
			);
			const byKind =
				typeof artifacts.byKind === "object" && artifacts.byKind !== null
					? JSON.stringify(artifacts.byKind)
					: "none";
			return {
				summary: `totalArtifacts=${artifacts.totalArtifacts ?? 0}; byKind=${byKind}; latest=${artifacts.latestCreatedAt ?? "none"}`,
				health: "HEALTHY" as const,
			};
		}
		return {
			summary: `${view} owner aggregate projection unavailable`,
			health: "UNKNOWN" as const,
			projectionStatus: "UNAVAILABLE" as const,
			findings: [
				`${view} has no formal bounded aggregate read API in the current composition; no substitute owner readiness is inferred`,
			],
		};
	};
	const systemViewForTopic = (topic: string): SystemObserverView | null => {
		const normalized = topic.toLowerCase();
		return normalized.includes("collab")
			? "collaboration"
			: normalized.includes("model")
				? "model"
				: normalized.includes("worker")
					? "worker"
					: normalized.includes("task")
						? "task"
						: normalized.includes("carrier")
							? "carrier"
							: normalized.includes("deploy")
								? "deployment"
								: normalized.includes("artifact")
									? "artifact"
									: normalized.includes("execution")
										? "execution"
										: null;
	};
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
	const admitExecutionRead = async (
		authenticatedRoleRef: string,
		rawRecord: unknown,
	): Promise<unknown> => {
		const record = object(rawRecord, "execution read record");
		if (record.callerRef !== authenticatedRoleRef)
			throw Object.assign(new Error("EXECUTION_CALLER_MISMATCH"), {
				httpStatus: 403,
			});
		if (typeof record.taskId === "string") {
			if (record.roleRef !== authenticatedRoleRef)
				throw Object.assign(new Error("EXECUTION_ROLE_SCOPE_MISMATCH"), {
					httpStatus: 403,
				});
			if (typeof record.workerRef !== "string")
				throw Object.assign(new Error("EXECUTION_WORKER_SCOPE_REQUIRED"), {
					httpStatus: 403,
				});
			await admitTaskParticipant(
				record.taskId,
				authenticatedRoleRef,
				record.workerRef,
			);
		}
		return rawRecord;
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
				const taskMutationIdempotencyKey = string(
					input.idempotencyKey,
					"idempotencyKey",
				);
				const result = object(
					await execution.invoke("materializeExternalFiles", {
						contract: "execution.external-file-materialization",
						contractVersion: "1.0.0",
						callerRef: authenticatedRoleRef,
						idempotencyKey: `${taskMutationIdempotencyKey}:carrier-file-materialization`,
						correlationId: taskMutationIdempotencyKey,
						...(typeof input.taskId === "string"
							? { taskId: input.taskId }
							: {}),
						roleRef: authenticatedRoleRef,
						...(typeof input.taskId === "string"
							? { workerRef: actorRef }
							: {}),
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
			const taskResult = await taskOperation(
				queryOperations.has(operationId)
					? canonicalTaskInput
					: { ...canonicalTaskInput, actorRef },
			);
			if (operationId === "getTaskDocument")
				return fileBridgeOutputForTaskResult(taskResult);
			return taskResult;
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
			const result = await execution.invoke(operationId, {
				...input,
				callerRef: authenticatedRoleRef,
				roleRef: authenticatedRoleRef,
				...(canonicalWorkerRef !== undefined
					? { workerRef: canonicalWorkerRef }
					: {}),
			});
			// A normal Action may complete synchronously inside the current Worker Turn.
			// Do not manufacture a Browser RESUME for every terminal Execution record.
			// Only a future explicit async-completion signal may emit EXECUTION_RESULT_READY.
			return result;
		}
		if (operationId === "getExecution") {
			const record = await execution.invoke(operationId, {
				...input,
				callerRef: authenticatedRoleRef,
			});
			return admitExecutionRead(authenticatedRoleRef, record);
		}
		if (operationId === "readExecutionOutput") {
			const record = await execution.invoke("getExecution", {
				contract: "execution",
				contractVersion: "1.0.0",
				executionRef: string(input.executionRef, "executionRef"),
				callerRef: authenticatedRoleRef,
			});
			await admitExecutionRead(authenticatedRoleRef, record);
			return execution.invoke(operationId, {
				...input,
				callerRef: authenticatedRoleRef,
			});
		}
		throw new Error("OPERATION_NOT_ROUTED");
	};
	const browserOwnerPorts: PlatformHostBrowserOwnerPorts = Object.freeze({
		task: Object.freeze({
			async getWorkerBinding(taskId: string, roleRef: string) {
				const binding = taskFacts(taskId).roleBindings.find(
					(candidate) => candidate.roleRef === roleRef,
				);
				return binding?.workerRef
					? {
							workerRef: binding.workerRef,
							conversationLocator: binding.conversationLocator,
						}
					: null;
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
				if (!declared) throw new Error("AGENT_PACKAGE_NOT_ELIGIBLE");
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
			async listPendingMessages(limit: number) {
				const messages = await agent.listPendingCollaborationMessages({
					limit,
				});
				return messages
					.filter((message) => message.lastDeliveryErrorCode !== "UNKNOWN")
					.map((message) => ({ ...message, status: "PENDING" as const }));
			},
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
			async reportDeliveryOutcome(input: {
				messageRef: string;
				outcome: "DELIVERED" | "FAILED" | "UNKNOWN";
				executionRef?: string;
				evidenceRef?: string;
				errorCode?: string;
			}) {
				const message = agent.getCollaborationMessage({
					messageId: input.messageRef,
				});
				if (message.status === "DELIVERED") return;
				await agent.reportCollaborationDelivery({
					messageId: message.messageId,
					expectedMessageVersion: message.version,
					outcome: input.outcome,
					observedRoleRef: message.targetRoleRef,
					observedWorkerRef: message.targetWorkerRef,
					...(input.executionRef ? { executionRef: input.executionRef } : {}),
					...(input.evidenceRef ? { evidenceRef: input.evidenceRef } : {}),
					...(input.errorCode ? { errorCode: input.errorCode } : {}),
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
				const internalBrowserCaller =
					request.callerRef === "platform-host:task-observer" ||
					request.callerRef === "platform-host:carrier-controller" ||
					request.callerRef === "extension:task-observer" ||
					request.callerRef === "extension:collaboration-carrier";
				if (!internalBrowserCaller) agent.getRegisteredRole(request.callerRef);
				if (
					request.roleRef &&
					!internalBrowserCaller &&
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
				if (internalBrowserCaller && (!browserCapability || !request.taskId))
					return false;
				if (browserCapability && !request.taskId) return false;
				if (request.taskId) {
					const taskFact = taskFacts(request.taskId);
					if (
						request.capability === "collaboration.deliver" &&
						taskIsTerminal(taskFact.status)
					)
						return false;
					if (request.workerRef && !internalBrowserCaller)
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
						if (!internalBrowserCaller && targetRoleRef !== request.callerRef)
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
	const roleForPackage = (agentPackageRef: string) => {
		const role = agent
			.listRegisteredRoles()
			.find((candidate) => candidate.agentPackageRef === agentPackageRef);
		if (!role) throw new Error("ROLE_NOT_FOUND");
		return role;
	};
	const roleManagement: PlatformHostRoleManagement = Object.freeze({
		async invoke(operation, rawInput) {
			const value = object(rawInput, "role management input");
			if (operation === "role.register") {
				const result = await agent.registerRole(value);
				return { role: result.role, credential: result.credential };
			}
			if (operation === "role.list") return agent.listRegisteredRoles();
			const agentPackageRef = string(value.agentPackageRef, "agentPackageRef");
			const role = roleForPackage(agentPackageRef);
			if (operation === "role.show") return role;
			if (operation === "role.validate") {
				const doctor = agent.doctorRoleStore();
				const issuePrefix = `${role.roleRef}`;
				const issues = doctor.issues.filter((issue) =>
					issue.includes(issuePrefix),
				);
				if (role.carrierUrl !== `https://chatgpt.com/g/${role.roleRef}`)
					issues.push(`ROLE_CARRIER_URL_MISMATCH:${role.roleRef}`);
				const expectedPackageVersion = Reflect.get(
					value,
					"expectedPackageVersion",
				);
				if (
					expectedPackageVersion !== undefined &&
					(typeof expectedPackageVersion !== "string" ||
						expectedPackageVersion.length === 0)
				)
					throw new TypeError(
						"expectedPackageVersion must be a non-empty string",
					);
				if (
					typeof expectedPackageVersion === "string" &&
					role.registeredPackageVersion !== expectedPackageVersion
				)
					issues.push(
						`ROLE_PACKAGE_VERSION_DRIFT:${role.roleRef}:${role.registeredPackageVersion}:${expectedPackageVersion}`,
					);
				return {
					status: issues.length === 0 ? "PASS" : "FAIL",
					role,
					issues,
				};
			}
			if (operation === "role.delete") {
				await agent.deleteRole(role.roleRef);
				return { deleted: true, roleRef: role.roleRef };
			}
			if (operation === "role.key.show")
				return agent.showCredential(role.roleRef);
			if (operation === "role.key.rotate")
				return agent.rotateCredential(role.roleRef);
			throw new Error("UNSUPPORTED_ROLE_MANAGEMENT_OPERATION");
		},
	});
	const ensureTaskWorkers = async (
		taskId: string,
		options?: { waitFor?: readonly string[] },
	) => {
		const provision = async (agentPackageRef: string) => {
			let current = unwrap(task.queries.getTask({ taskId }));
			const binding = current.roleBindings.find(
				(candidate) => candidate.agentPackageRef === agentPackageRef,
			);
			if (!binding) throw new Error("TASK_ROLE_BINDING_REQUIRED");
			if (binding.workerRef && binding.conversationLocator) return;
			const role = roleForPackage(agentPackageRef);
			const executionRecord = object(
				await execution.invoke("executeCapability", {
					contract: "execution",
					contractVersion: "1.0.0",
					idempotencyKey: `new-task-worker:${taskId}:${role.roleRef}`,
					callerRef: "platform-host:carrier-controller",
					correlationId: `new-task:${taskId}`,
					taskId,
					roleRef: role.roleRef,
					capability: "worker.create",
					input: {
						roleRef: role.roleRef,
						roleUrl: role.carrierUrl,
						bootstrapFingerprint: `new-task:${taskId}:${agentPackageRef}`,
					},
				}),
				"worker create execution",
			);
			if (executionRecord.status !== "SUCCEEDED")
				throw new Error(
					`WORKER_CREATE_NOT_CONFIRMED:${String(executionRecord.status)}`,
				);
			current = unwrap(task.queries.getTask({ taskId }));
			const persisted = current.roleBindings.find(
				(candidate) => candidate.agentPackageRef === agentPackageRef,
			);
			if (!persisted?.workerRef || !persisted.conversationLocator)
				throw new Error("WORKER_CREATE_BINDING_NOT_PERSISTED");
		};
		// Dispatch all three fixed Workers concurrently. When `waitFor` names a
		// subset of roleRefs (the J1 Product path), only those results gate the
		// return; the remaining Worker creation is a durable, idempotent Execution
		// effect whose completion the ensureWorkers recovery reconciles from the
		// durable Task binding facts — never a bare in-memory promise.
		const waitFor = new Set(options?.waitFor ?? []);
		const shouldWait = (agentPackageRef: string) =>
			waitFor.size === 0 ||
			waitFor.has(roleForPackage(agentPackageRef).roleRef);
		const pending = rolePackageRefs.map((agentPackageRef) => ({
			agentPackageRef,
			promise: provision(agentPackageRef),
		}));
		const awaited = pending.filter((entry) =>
			shouldWait(entry.agentPackageRef),
		);
		const deferred = pending.filter(
			(entry) => !shouldWait(entry.agentPackageRef),
		);
		for (const entry of deferred) {
			entry.promise.catch(() => {
				// Deferred Worker creation failure is recoverable: the durable
				// binding stays unset, so a later ensureWorkers pass re-provisions
				// only the missing role.
			});
		}
		const results = await Promise.allSettled(
			awaited.map((entry) => entry.promise),
		);
		const failure = results.find(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);
		if (failure) throw failure.reason;
		return unwrap(task.queries.getTask({ taskId }));
	};
	const taskApplication = Object.freeze({
		async invoke(operation: string, rawInput: unknown) {
			const value = object(rawInput, "task application input");
			if (operation === "task.create") {
				const idempotencyKey = string(value.idempotencyKey, "idempotencyKey");
				const created = unwrap(
					task.commands.createTask({
						...(typeof value.taskId === "string"
							? { taskId: value.taskId }
							: {}),
						title: string(value.title, "title"),
						objective: string(value.objective, "objective"),
						plan: object(value.plan, "plan"),
						initialDocuments: Array.isArray(value.initialDocuments)
							? value.initialDocuments
							: [],
						roleBindings: rolePackageRefs.map((agentPackageRef) => {
							const role = roleForPackage(agentPackageRef);
							return {
								agentPackageRef,
								roleRef: role.roleRef,
								workerRef: null,
								conversationLocator: null,
							};
						}),
						actorRef: "extension:human",
						idempotencyKey,
					}),
				);
				// J1: return once the Product Worker is durably bound; Dev/Test
				// continue as recoverable durable effects without blocking Product
				// requirement discussion.
				return ensureTaskWorkers(created.taskId, {
					waitFor: [roleForPackage("@tomflow/proflow-agent-product").roleRef],
				});
			}
			if (operation === "task.ensureWorkers")
				return ensureTaskWorkers(string(value.taskId, "taskId"));
			if (operation === "task.list")
				return unwrap(
					task.queries.listTasks({
						...(Array.isArray(value.statuses)
							? { statuses: value.statuses }
							: {}),
					}),
				);
			if (operation === "task.get")
				return unwrap(
					task.queries.getTask({ taskId: string(value.taskId, "taskId") }),
				);
			if (operation === "task.start")
				return unwrap(
					task.commands.startTask({
						taskId: string(value.taskId, "taskId"),
						expectedTaskVersion: Number(value.expectedTaskVersion),
						actorRef: "extension:human",
						idempotencyKey: string(value.idempotencyKey, "idempotencyKey"),
					}),
				);
			if (operation === "node.reopen")
				return unwrap(
					task.commands.reopenNode({
						taskId: string(value.taskId, "taskId"),
						nodeId: string(value.nodeId, "nodeId"),
						reason: string(value.reason, "reason"),
						expectedTaskVersion: Number(value.expectedTaskVersion),
						actorRef: "extension:human",
						idempotencyKey: string(value.idempotencyKey, "idempotencyKey"),
					}),
				);
			throw new Error("UNSUPPORTED_TASK_APPLICATION_OPERATION");
		},
	});
	const approvalApplication = Object.freeze({
		async invoke(operation: string, rawInput: unknown) {
			const value = object(rawInput, "approval application input");
			if (operation === "approval.list")
				return execution.invoke("listExecutionApprovals", value);
			if (operation === "approval.get")
				return execution.invoke("getExecutionApproval", {
					approvalRef: string(value.approvalRef, "approvalRef"),
				});
			if (operation === "approval.request")
				return execution.invoke("requestExecutionApproval", {
					...value,
					actorRef: "extension:human",
				});
			if (operation === "approval.allow" || operation === "approval.deny")
				return execution.invoke("decideExecutionApproval", {
					contract: "execution.approval",
					contractVersion: "1.0.0",
					approvalRef: string(value.approvalRef, "approvalRef"),
					actorRef: "extension:human",
					expectedVersion: Number(value.expectedVersion),
					decision: operation === "approval.allow" ? "ALLOW" : "DENY",
					...(typeof value.reason === "string" ? { reason: value.reason } : {}),
				});
			if (operation === "approval.revoke")
				return execution.invoke("revokeExecutionApproval", {
					contract: "execution.approval",
					contractVersion: "1.0.0",
					approvalRef: string(value.approvalRef, "approvalRef"),
					actorRef: "extension:human",
					expectedVersion: Number(value.expectedVersion),
					reason: string(value.reason, "reason"),
				});
			throw new Error("UNSUPPORTED_APPROVAL_APPLICATION_OPERATION");
		},
	});
	const observerApplication = Object.freeze({
		async invoke(operation: string, rawInput: unknown) {
			const value = object(rawInput, "observer application input");
			if (operation === "task.projection")
				return taskDriverPorts.getTaskDriveProjection(
					string(value.taskId, "taskId"),
				);
			if (operation === "browser.binding")
				return browserOwnerPorts.task.getWorkerBinding(
					string(value.taskId, "taskId"),
					string(value.roleRef, "roleRef"),
				);
			if (operation === "browser.bindWorker") {
				await browserOwnerPorts.task.bindWorker({
					taskId: string(value.taskId, "taskId"),
					roleRef: string(value.roleRef, "roleRef"),
					workerRef: string(value.workerRef, "workerRef"),
					conversationLocator: string(
						value.conversationLocator,
						"conversationLocator",
					),
				});
				return { bound: true };
			}
			if (operation === "collaboration.binding")
				return browserOwnerPorts.task.getWorkerBinding(
					string(value.taskId, "taskId"),
					string(value.roleRef, "roleRef"),
				);
			if (operation === "collaboration.listPending")
				return browserOwnerPorts.agent.listPendingMessages(
					Number(value.limit ?? 50),
				);
			if (operation === "collaboration.getPending")
				return browserOwnerPorts.agent.getPendingMessage(
					string(value.messageRef, "messageRef"),
				);
			if (operation === "collaboration.execute") {
				const request = object(
					value.request,
					"collaboration execution request",
				);
				if (request.capability !== "collaboration.deliver")
					throw new Error("COLLABORATION_CARRIER_CAPABILITY_DENIED");
				return execution.invoke("executeCapability", {
					...request,
					callerRef: "extension:collaboration-carrier",
					capability: "collaboration.deliver",
				});
			}
			if (operation === "collaboration.reportDelivery") {
				const outcome = string(value.outcome, "outcome");
				if (
					outcome !== "DELIVERED" &&
					outcome !== "FAILED" &&
					outcome !== "UNKNOWN"
				)
					throw new Error("COLLABORATION_DELIVERY_OUTCOME_INVALID");
				await browserOwnerPorts.agent.reportDeliveryOutcome({
					messageRef: string(value.messageRef, "messageRef"),
					outcome,
					...(typeof value.evidenceRef === "string"
						? { evidenceRef: value.evidenceRef }
						: {}),
					...(typeof value.executionRef === "string"
						? { executionRef: value.executionRef }
						: {}),
					...(typeof value.errorCode === "string"
						? { errorCode: value.errorCode }
						: {}),
				});
				return { reported: true };
			}
			if (operation === "execution.listSignals")
				return execution.invoke("listExecutionObserverSignals", {
					limit: Number(value.limit ?? 50),
				});
			if (operation === "execution.ackSignal")
				return execution.invoke("acknowledgeExecutionObserverSignal", {
					signalRef: string(value.signalRef, "signalRef"),
				});
			if (operation === "task.wake") {
				const taskId = string(value.taskId, "taskId");
				const nodeId = string(value.nodeId, "nodeId");
				const runNo = Number(value.runNo);
				const roleRef = string(value.roleRef, "roleRef");
				const workerRef = string(value.workerRef, "workerRef");
				const trigger = string(value.trigger, "trigger");
				const underlyingRef =
					typeof value.underlyingRef === "string"
						? value.underlyingRef
						: "none";
				return execution.invoke("executeCapability", {
					contract: "execution",
					contractVersion: "1.0.0",
					idempotencyKey: `task-observer-wake:${taskId}:${nodeId}:${runNo}:${trigger}:${underlyingRef}`,
					callerRef: "extension:task-observer",
					correlationId: `task-observer:${taskId}:${nodeId}:${runNo}`,
					taskId,
					nodeId,
					runNo,
					roleRef,
					workerRef,
					capability: "worker.wake",
					input: {
						roleRef,
						workerRef,
						taskId,
						nodeId,
						runNo,
						trigger,
						fingerprint: `wake:${taskId}:${nodeId}:${runNo}:${trigger}:${underlyingRef}`,
					},
				});
			}
			if (operation === "task.diagnostic") {
				const response = object(
					await model.invoke("infer", {
						contractVersion: "1.0.0",
						specRef: "task.diagnostic.v1",
						mode: "reason",
						priority: "business",
						trace: {
							callerRef: "extension:task-observer",
							correlationId: string(value.correlationId, "correlationId"),
							taskId: string(value.taskId, "taskId"),
							nodeId: string(value.nodeId, "nodeId"),
						},
						payload: value.payload,
					}),
					"task diagnostic inference",
				);
				if (response.status !== "SUCCEEDED") {
					const error =
						typeof response.error === "object" && response.error !== null
							? (response.error as Record<string, unknown>)
							: {};
					const code =
						error.code === "CONTEXT_TOO_LARGE"
							? "CONTEXT_TOO_LARGE"
							: error.code === "MODEL_UNAVAILABLE" ||
									error.code === "CAPABILITY_UNSUPPORTED"
								? "REASON_UNAVAILABLE"
								: "REASON_FAILED";
					return { ok: false, errorCode: code };
				}
				return taskDiagnosticReasonResultSchema.parse(response.data);
			}
			if (operation === "system.view")
				return boundedSystemView(
					string(value.view, "view") as SystemObserverView,
				);
			if (operation === "system.drilldown") {
				const topic = string(value.topic, "topic");
				const view = systemViewForTopic(topic);
				if (view) return boundedSystemView(view);
				return {
					summary: `drilldown topic ${topic} cannot be attributed to a formal owner view`,
					health: "UNKNOWN" as const,
					projectionStatus: "UNAVAILABLE" as const,
					findings: [
						"unknown drilldown topic is not defaulted to execution or another owner",
					],
				};
			}
			if (operation === "system.reason") {
				const assessmentRef = string(value.assessmentRef, "assessmentRef");
				const observerPayload = object(
					value.payload,
					"system observer reason payload",
				);
				const payloadAssessmentRef = string(
					observerPayload.assessmentRef,
					"payload.assessmentRef",
				);
				if (payloadAssessmentRef !== assessmentRef) {
					throw new Error("SYSTEM_OBSERVER_ASSESSMENT_REF_MISMATCH");
				}
				const {
					assessmentRef: _assessmentRef,
					kind,
					...modelPayload
				} = observerPayload;
				const response = object(
					await model.invoke("infer", {
						contractVersion: "1.0.0",
						specRef: "system.health-assessment.v1",
						mode: "reason",
						priority: "background",
						trace: { callerRef: "extension:system-observer", assessmentRef },
						payload: {
							...modelPayload,
							assessmentKind: string(kind, "payload.kind"),
						},
					}),
					"system observer inference",
				);
				if (response.status !== "SUCCEEDED") {
					const error =
						typeof response.error === "object" && response.error !== null
							? (response.error as Record<string, unknown>)
							: {};
					const code =
						error.code === "CONTEXT_TOO_LARGE"
							? "CONTEXT_TOO_LARGE"
							: error.code === "MODEL_UNAVAILABLE" ||
									error.code === "CAPABILITY_UNSUPPORTED"
								? "REASON_UNAVAILABLE"
								: "REASON_FAILED";
					return { ok: false, errorCode: code };
				}
				return systemObserverReasonResultSchema.parse(response.data);
			}
			throw new Error("UNSUPPORTED_OBSERVER_APPLICATION_OPERATION");
		},
	});
	return Object.freeze({
		route,
		browserOwnerPorts,
		authorizeExecution,
		taskDriverPorts,
		agentIdentityPorts,
		roleManagement,
		taskApplication,
		approvalApplication,
		observerApplication,

		async lookup(
			operationId: string,
			authenticatedRoleRef: string,
			input: unknown,
		) {
			const value = object(input, "lookup input");
			if (operationId === "executeCapability") {
				if (value.executionRef) {
					const record = await execution.invoke("getExecution", {
						...value,
						callerRef: authenticatedRoleRef,
					});
					return admitExecutionRead(authenticatedRoleRef, record);
				}
				const taskId =
					typeof value.taskId === "string" ? value.taskId : undefined;
				let canonicalWorkerRef: string | undefined;
				if (taskId)
					canonicalWorkerRef = await admitTaskParticipant(
						taskId,
						authenticatedRoleRef,
						typeof value.workerRef === "string" ? value.workerRef : undefined,
					);
				const record = await execution.invoke("lookupExecutionIntent", {
					...value,
					callerRef: authenticatedRoleRef,
					roleRef: authenticatedRoleRef,
					...(canonicalWorkerRef ? { workerRef: canonicalWorkerRef } : {}),
				});
				return admitExecutionRead(authenticatedRoleRef, record);
			}
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

async function ensureRoleManagementCredential(stateRoot: string) {
	const path = join(stateRoot, "agent", "secrets", "role-management.token");
	await mkdir(join(stateRoot, "agent", "secrets"), {
		recursive: true,
		mode: 0o700,
	});
	if (!existsSync(path)) {
		const generated = randomBytes(32).toString("base64url");
		try {
			await writeFile(path, `${generated}\n`, { mode: 0o600, flag: "wx" });
		} catch (error) {
			if (!existsSync(path)) throw error;
		}
	}
	await chmod(join(stateRoot, "agent", "secrets"), 0o700);
	await chmod(path, 0o600);
	const credential = (await readFile(path, "utf8")).trim();
	if (credential.length < 32)
		throw new Error("ROLE_MANAGEMENT_CREDENTIAL_INVALID");
	return credential;
}

async function ensureExecutionIdentityCredential(stateRoot: string) {
	const directory = join(stateRoot, "execution", "secrets");
	const path = join(directory, "execution-identity.token");
	await mkdir(directory, { recursive: true, mode: 0o700 });
	if (!existsSync(path)) {
		const generated = randomBytes(32).toString("base64url");
		try {
			await writeFile(path, `${generated}\n`, { mode: 0o600, flag: "wx" });
		} catch (error) {
			if (!existsSync(path)) throw error;
		}
	}
	await chmod(directory, 0o700);
	await chmod(path, 0o600);
	const credential = (await readFile(path, "utf8")).trim();
	if (credential.length < 32)
		throw new Error("EXECUTION_IDENTITY_CREDENTIAL_INVALID");
	return credential;
}

async function ensureApprovalApplicationCredential(stateRoot: string) {
	const directory = join(stateRoot, "browser", "secrets");
	const path = join(directory, "approval-application.token");
	await mkdir(directory, { recursive: true, mode: 0o700 });
	if (!existsSync(path)) {
		const generated = randomBytes(32).toString("base64url");
		try {
			await writeFile(path, `${generated}\n`, { mode: 0o600, flag: "wx" });
		} catch (error) {
			if (!existsSync(path)) throw error;
		}
	}
	await chmod(directory, 0o700);
	await chmod(path, 0o600);
	const credential = (await readFile(path, "utf8")).trim();
	if (credential.length < 32)
		throw new Error("APPROVAL_APPLICATION_CREDENTIAL_INVALID");
	return credential;
}

async function ensureTaskApplicationCredential(stateRoot: string) {
	const directory = join(stateRoot, "browser", "secrets");
	const path = join(directory, "task-application.token");
	await mkdir(directory, { recursive: true, mode: 0o700 });
	if (!existsSync(path)) {
		const generated = randomBytes(32).toString("base64url");
		try {
			await writeFile(path, `${generated}\n`, { mode: 0o600, flag: "wx" });
		} catch (error) {
			if (!existsSync(path)) throw error;
		}
	}
	await chmod(directory, 0o700);
	await chmod(path, 0o600);
	const credential = (await readFile(path, "utf8")).trim();
	if (credential.length < 32)
		throw new Error("TASK_APPLICATION_CREDENTIAL_INVALID");
	return credential;
}

async function readPrivateTransportCredential(
	file: string,
	name: "GATEWAY" | "MODEL" | "EXECUTION",
) {
	const info = await stat(file);
	if (process.platform !== "win32" && (info.mode & 0o077) !== 0)
		throw new Error(`${name}_TRANSPORT_CREDENTIAL_PERMISSIONS_INVALID`);
	const credential = (await readFile(file, "utf8")).trim();
	if (credential.length < 32)
		throw new Error(`${name}_TRANSPORT_CREDENTIAL_INVALID`);
	return credential;
}
async function readGatewayTransportCredential(file: string) {
	return readPrivateTransportCredential(file, "GATEWAY");
}
async function readModelTransportCredential(file: string) {
	return readPrivateTransportCredential(file, "MODEL");
}
async function readExecutionTransportCredential(file: string) {
	return readPrivateTransportCredential(file, "EXECUTION");
}

function managementCredentialMatches(
	header: string | undefined,
	expected: string,
) {
	if (!header?.startsWith("Bearer ")) return false;
	const supplied = Buffer.from(header.slice("Bearer ".length));
	const target = Buffer.from(expected);
	return supplied.length === target.length && timingSafeEqual(supplied, target);
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
	let roleManagementCredential: string | undefined;
	let taskApplicationCredential: string | undefined;
	let approvalApplicationCredential: string | undefined;
	let executionIdentityCredential: string | undefined;
	let gatewayTransportCredential: string | undefined;
	let modelTransportCredential: string | undefined;
	let executionTransportCredential: string | undefined;
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
			async listPendingMessages(limit: number) {
				if (!graph) throw new Error("PLATFORM_HOST_NOT_RUNNING");
				return graph.browserOwnerPorts.agent.listPendingMessages(limit);
			},
			async getPendingMessage(messageRef: string) {
				if (!graph) throw new Error("PLATFORM_HOST_NOT_RUNNING");
				return graph.browserOwnerPorts.agent.getPendingMessage(messageRef);
			},
			async reportDeliveryOutcome(input: {
				messageRef: string;
				outcome: "DELIVERED" | "FAILED" | "UNKNOWN";
				executionRef?: string;
				evidenceRef?: string;
				errorCode?: string;
			}) {
				if (!graph) throw new Error("PLATFORM_HOST_NOT_RUNNING");
				return graph.browserOwnerPorts.agent.reportDeliveryOutcome(input);
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
			roleManagementCredential = await ensureRoleManagementCredential(
				input.config.stateRoot,
			);
			taskApplicationCredential = await ensureTaskApplicationCredential(
				input.config.stateRoot,
			);
			approvalApplicationCredential = await ensureApprovalApplicationCredential(
				input.config.stateRoot,
			);
			executionIdentityCredential = await ensureExecutionIdentityCredential(
				input.config.stateRoot,
			);
			gatewayTransportCredential = input.config.gatewayTransportCredentialFile
				? await readGatewayTransportCredential(
						input.config.gatewayTransportCredentialFile,
					)
				: undefined;
			modelTransportCredential = input.config.modelTransportCredentialFile
				? await readModelTransportCredential(
						input.config.modelTransportCredentialFile,
					)
				: undefined;
			executionTransportCredential = input.config
				.executionTransportCredentialFile
				? await readExecutionTransportCredential(
						input.config.executionTransportCredentialFile,
					)
				: input.executionCredential;
			log("DEPENDENCY_INITIALIZATION_STARTED", {
				order: ["task", "agent", "execution-client", "model-client"],
			});
			graph = await constructGraph(
				input.config,
				executionTransportCredential,
				modelTransportCredential,
			);
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
							request.method === "GET" &&
							url.pathname === "/internal/execution/identity/ready"
						) {
							if (
								!executionIdentityCredential ||
								!managementCredentialMatches(
									request.headers.authorization,
									executionIdentityCredential,
								)
							)
								return respond(response, 401, {
									error: "EXECUTION_IDENTITY_AUTH_FAILED",
								});
							return respond(response, 200, { ready: true });
						}
						if (
							request.method === "POST" &&
							url.pathname === "/internal/execution/authorize"
						) {
							if (
								!executionIdentityCredential ||
								!managementCredentialMatches(
									request.headers.authorization,
									executionIdentityCredential,
								)
							)
								return respond(response, 401, {
									error: "EXECUTION_IDENTITY_AUTH_FAILED",
								});
							const chunks: Buffer[] = [];
							for await (const chunk of request)
								chunks.push(
									Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
								);
							const body = object(
								JSON.parse(Buffer.concat(chunks).toString("utf8")),
								"execution identity request",
							);
							return respond(response, 200, {
								authorized: await graph.authorizeExecution(
									body as unknown as ExecuteCapabilityRequest,
								),
							});
						}
						if (
							request.method === "POST" &&
							url.pathname === "/application/approval"
						) {
							if (
								!approvalApplicationCredential ||
								!managementCredentialMatches(
									request.headers.authorization,
									approvalApplicationCredential,
								)
							)
								return respond(response, 401, {
									error: "APPROVAL_APPLICATION_AUTH_FAILED",
								});
							const chunks: Buffer[] = [];
							let bytes = 0;
							for await (const chunk of request) {
								const buffer = Buffer.isBuffer(chunk)
									? chunk
									: Buffer.from(chunk);
								bytes += buffer.byteLength;
								if (bytes > 262_144)
									throw new TypeError("REQUEST_BODY_TOO_LARGE");
								chunks.push(buffer);
							}
							const body = object(
								JSON.parse(Buffer.concat(chunks).toString("utf8")),
								"approval application request",
							);
							try {
								const result = await graph.approvalApplication.invoke(
									string(body.operation, "operation"),
									body.input ?? {},
								);
								return respond(response, 200, result);
							} catch (error) {
								return respond(response, 400, {
									error:
										error instanceof Error ? error.message : "INVALID_REQUEST",
								});
							}
						}
						if (
							request.method === "POST" &&
							url.pathname === "/application/log"
						) {
							if (
								!taskApplicationCredential ||
								!managementCredentialMatches(
									request.headers.authorization,
									taskApplicationCredential,
								)
							)
								return respond(response, 401, {
									error: "BROWSER_LOG_AUTH_FAILED",
								});
							const chunks: Buffer[] = [];
							let bytes = 0;
							for await (const chunk of request) {
								const buffer = Buffer.isBuffer(chunk)
									? chunk
									: Buffer.from(chunk);
								bytes += buffer.byteLength;
								if (bytes > 32_768)
									throw new TypeError("REQUEST_BODY_TOO_LARGE");
								chunks.push(buffer);
							}
							try {
								const entry = browserStructuredLogSchema.parse(
									JSON.parse(Buffer.concat(chunks).toString("utf8")),
								);
								const logPath = join(
									input.config.stateRoot,
									"logs",
									"browser-extension",
									"events.jsonl",
								);
								await mkdir(dirname(logPath), { recursive: true, mode: 0o700 });
								await appendFile(
									logPath,
									`${JSON.stringify({ ...entry, receivedAt: new Date().toISOString() })}\n`,
									{ mode: 0o600 },
								);
								return respond(response, 200, { accepted: true });
							} catch (error) {
								return respond(response, 400, {
									error:
										error instanceof Error
											? error.message
											: "INVALID_LOG_ENTRY",
								});
							}
						}
						if (
							request.method === "POST" &&
							url.pathname === "/application/observer"
						) {
							if (
								!taskApplicationCredential ||
								!managementCredentialMatches(
									request.headers.authorization,
									taskApplicationCredential,
								)
							)
								return respond(response, 401, {
									error: "OBSERVER_APPLICATION_AUTH_FAILED",
								});
							const chunks: Buffer[] = [];
							let bytes = 0;
							for await (const chunk of request) {
								const buffer = Buffer.isBuffer(chunk)
									? chunk
									: Buffer.from(chunk);
								bytes += buffer.byteLength;
								if (bytes > 262_144)
									throw new TypeError("REQUEST_BODY_TOO_LARGE");
								chunks.push(buffer);
							}
							const body = object(
								JSON.parse(Buffer.concat(chunks).toString("utf8")),
								"observer application request",
							);
							try {
								const result = await graph.observerApplication.invoke(
									string(body.operation, "operation"),
									body.input ?? {},
								);
								return respond(response, 200, result);
							} catch (error) {
								return respond(response, 400, {
									error:
										error instanceof Error ? error.message : "INVALID_REQUEST",
								});
							}
						}
						if (
							request.method === "POST" &&
							url.pathname === "/application/task"
						) {
							if (
								!taskApplicationCredential ||
								!managementCredentialMatches(
									request.headers.authorization,
									taskApplicationCredential,
								)
							)
								return respond(response, 401, {
									error: "TASK_APPLICATION_AUTH_FAILED",
								});
							const chunks: Buffer[] = [];
							let bytes = 0;
							for await (const chunk of request) {
								const buffer = Buffer.isBuffer(chunk)
									? chunk
									: Buffer.from(chunk);
								bytes += buffer.byteLength;
								if (bytes > 262_144)
									throw new TypeError("REQUEST_BODY_TOO_LARGE");
								chunks.push(buffer);
							}
							const body = object(
								JSON.parse(Buffer.concat(chunks).toString("utf8")),
								"task application request",
							);
							try {
								const result = await graph.taskApplication.invoke(
									string(body.operation, "operation"),
									body.input ?? {},
								);
								return respond(response, 200, result);
							} catch (error) {
								return respond(response, 400, {
									error:
										error instanceof Error ? error.message : "INVALID_REQUEST",
								});
							}
						}
						if (
							request.method === "POST" &&
							url.pathname === "/management/agent"
						) {
							if (
								!roleManagementCredential ||
								!managementCredentialMatches(
									request.headers.authorization,
									roleManagementCredential,
								)
							)
								return respond(response, 401, {
									error: "MANAGEMENT_AUTH_FAILED",
								});
							const chunks: Buffer[] = [];
							let bytes = 0;
							for await (const chunk of request) {
								const buffer = Buffer.isBuffer(chunk)
									? chunk
									: Buffer.from(chunk);
								bytes += buffer.byteLength;
								if (bytes > 65_536)
									throw new TypeError("REQUEST_BODY_TOO_LARGE");
								chunks.push(buffer);
							}
							const body = object(
								JSON.parse(Buffer.concat(chunks).toString("utf8")),
								"management request",
							);
							const operation = string(body.operation, "operation");
							try {
								const result = await graph.roleManagement.invoke(
									operation,
									body.input ?? {},
								);
								return respond(response, 200, result);
							} catch (error) {
								const code =
									typeof error === "object" && error !== null
										? Reflect.get(error, "code")
										: undefined;
								return respond(response, 400, {
									error:
										typeof code === "string"
											? code
											: error instanceof Error
												? error.message
												: "INVALID_REQUEST",
								});
							}
						}
						if (
							request.method !== "POST" ||
							!url.pathname.startsWith("/actions/")
						)
							return respond(response, 404, { error: "NOT_FOUND" });
						if (
							gatewayTransportCredential &&
							!managementCredentialMatches(
								request.headers.authorization,
								gatewayTransportCredential,
							)
						)
							return respond(response, 401, {
								error: "GATEWAY_TRANSPORT_AUTH_FAILED",
							});
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
			roleManagementCredential = undefined;
			taskApplicationCredential = undefined;
			approvalApplicationCredential = undefined;
			executionIdentityCredential = undefined;
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
		roleManagementCredential = undefined;
		taskApplicationCredential = undefined;
		approvalApplicationCredential = undefined;
		executionIdentityCredential = undefined;
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
