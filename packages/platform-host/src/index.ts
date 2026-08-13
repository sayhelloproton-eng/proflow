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
		"listRegisteredRoles",
		"getRegisteredRole",
		"createTask",
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
			} else if (operationId === "executeCapability") path = "/executions";
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
					...(method === "POST"
						? {
								headers: { "content-type": "application/json" },
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
async function constructGraph(config: PlatformHostConfig) {
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
	const execution = createOwnerHttpClient("execution", config.executionBaseUrl);
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
		"getNodeContext",
		"listPendingMessages",
		"listTaskEvents",
		"getTaskDocument",
	]);
	const route = async (
		operationId: string,
		authenticatedRoleRef: string,
		rawInput: unknown,
	) => {
		const role = agent.getRegisteredRole(authenticatedRoleRef);
		if (
			!roleOperations[role.agentPackageRef as RolePackageRef]?.has(operationId)
		)
			throw Object.assign(new Error("ROLE_OPERATION_DENIED"), {
				httpStatus: 403,
			});
		const input = object(rawInput, "action input");
		if (operationId === "listRegisteredRoles")
			return agent.listRegisteredRoles();
		if (operationId === "getRegisteredRole")
			return agent.getRegisteredRole(string(input.roleRef, "roleRef"));
		if (operationId === "askPeer")
			return agent.askPeer({ ...input, authenticatedRoleRef });
		if (operationId === "replyPeer")
			return agent.replyPeer({ ...input, authenticatedRoleRef });
		const taskOperation = taskOperations.get(operationId);
		if (taskOperation)
			return taskOperation(
				queryOperations.has(operationId)
					? input
					: { ...input, actorRef: authenticatedRoleRef },
			);
		if (operationId === "executeCapability") {
			const taskId =
				typeof input.taskId === "string" ? input.taskId : undefined;
			const workerRef =
				typeof input.workerRef === "string" ? input.workerRef : undefined;
			if (taskId && workerRef)
				await agent.validateWorker({
					authenticatedRoleRef,
					taskId,
					workerRef,
				});
			return execution.invoke(operationId, {
				...input,
				callerRef: authenticatedRoleRef,
				roleRef: authenticatedRoleRef,
			});
		}
		if (operationId === "getExecution" || operationId === "readExecutionOutput")
			return execution.invoke(operationId, input);
		throw new Error("OPERATION_NOT_ROUTED");
	};
	return Object.freeze({
		route,
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
}) {
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
			graph = await constructGraph(input.config);
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
		async restart() {
			await stop();
			return start();
		},
	});
}
