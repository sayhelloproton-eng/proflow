import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, isAbsolute, resolve } from "node:path";
import {
	artifactMaterializationResponseSchema,
	EXECUTION_CONTRACT_VERSION,
	materializeContextPackRequestSchema,
	materializeExternalFilesRequestSchema,
	materializeExternalFilesResponseSchema,
	materializePatchProposalRequestSchema,
	parseExecutionRef,
} from "@tomflow/proflow-execution-contracts";
import { createLocalExecutorPort } from "./executors/local-adapter.ts";
import {
	createExecutionRuntime,
	type ExecutionRuntimeOptions,
} from "./index.ts";

export type ExecutionRuntimeProcessConfig = {
	databasePath: string;
	projectRoot: string;
	artifactRoot: string;
	host: string;
	port: number;
	exactNetworkTargets: string[];
	browserExecutorConfigPath?: string;
	transportCredentialFile?: string;
	identity?: { endpoint: string; tokenFile: string };
	modelDecision?: {
		endpoint: string;
		timeoutMs?: number;
		credentialFile?: string;
	};
};

export type ExecutionRuntimeProcessStatus = {
	process: "STOPPED" | "STARTING" | "RUNNING" | "DRAINING";
	liveness: "UP" | "DOWN";
	readiness: "READY" | "NOT_READY";
	accepting: boolean;
	inFlight: number;
	databasePath: string;
	localExecutor: "READY" | "UNAVAILABLE";
	browserExecutor: "READY" | "UNAVAILABLE";
	identity: "READY" | "UNAVAILABLE";
	transportAuth: "READY" | "UNAVAILABLE";
	modelDecision: "READY" | "UNAVAILABLE";
};

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

export function parseExecutionRuntimeProcessConfig(
	value: unknown,
): ExecutionRuntimeProcessConfig {
	const input = object(value, "execution-runtime config");
	const databasePath = resolve(string(input.databasePath, "databasePath"));
	const projectRoot = resolve(string(input.projectRoot, "projectRoot"));
	const artifactRoot = resolve(string(input.artifactRoot, "artifactRoot"));
	if (![databasePath, projectRoot, artifactRoot].every(isAbsolute))
		throw new TypeError("runtime paths must resolve to absolute paths");
	const port = input.port === undefined ? 0 : Number(input.port);
	if (!Number.isInteger(port) || port < 0 || port > 65_535)
		throw new TypeError("port must be an integer from 0 through 65535");
	const exactNetworkTargets = input.exactNetworkTargets ?? [];
	const browserExecutorConfigPath =
		input.browserExecutorConfigPath === undefined
			? undefined
			: string(input.browserExecutorConfigPath, "browserExecutorConfigPath");
	if (
		browserExecutorConfigPath !== undefined &&
		!isAbsolute(browserExecutorConfigPath)
	)
		throw new TypeError("browserExecutorConfigPath must be absolute");
	const transportCredentialFile =
		input.transportCredentialFile === undefined
			? undefined
			: string(input.transportCredentialFile, "transportCredentialFile");
	if (
		transportCredentialFile !== undefined &&
		!isAbsolute(transportCredentialFile)
	)
		throw new TypeError("transportCredentialFile must be absolute");
	let modelDecision: ExecutionRuntimeProcessConfig["modelDecision"];
	if (input.modelDecision !== undefined) {
		const value = object(input.modelDecision, "modelDecision");
		const endpoint = new URL(string(value.endpoint, "modelDecision.endpoint"));
		if (
			endpoint.protocol !== "http:" ||
			!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(
				endpoint.hostname,
			) ||
			endpoint.pathname !== "/" ||
			endpoint.search ||
			endpoint.hash
		)
			throw new TypeError("modelDecision.endpoint must be loopback HTTP root");
		const timeoutMs =
			value.timeoutMs === undefined ? undefined : Number(value.timeoutMs);
		if (
			timeoutMs !== undefined &&
			(!Number.isInteger(timeoutMs) || timeoutMs <= 0)
		)
			throw new TypeError("modelDecision.timeoutMs must be a positive integer");
		const credentialFile =
			value.credentialFile === undefined
				? undefined
				: string(value.credentialFile, "modelDecision.credentialFile");
		if (credentialFile !== undefined && !isAbsolute(credentialFile))
			throw new TypeError("modelDecision.credentialFile must be absolute");
		modelDecision = {
			endpoint: endpoint.origin,
			...(timeoutMs === undefined ? {} : { timeoutMs }),
			...(credentialFile === undefined ? {} : { credentialFile }),
		};
	}
	let identity: ExecutionRuntimeProcessConfig["identity"];
	if (input.identity !== undefined) {
		const value = object(input.identity, "identity");
		const endpoint = new URL(string(value.endpoint, "identity.endpoint"));
		if (
			endpoint.protocol !== "http:" ||
			!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(
				endpoint.hostname,
			) ||
			endpoint.pathname !== "/" ||
			endpoint.search ||
			endpoint.hash
		)
			throw new TypeError("identity.endpoint must be loopback HTTP root");
		const tokenFile = string(value.tokenFile, "identity.tokenFile");
		if (!isAbsolute(tokenFile))
			throw new TypeError("identity.tokenFile must be absolute");
		identity = { endpoint: endpoint.origin, tokenFile };
	}
	if (
		!Array.isArray(exactNetworkTargets) ||
		exactNetworkTargets.some((item) => typeof item !== "string")
	)
		throw new TypeError("exactNetworkTargets must be a string array");
	return {
		databasePath,
		projectRoot,
		artifactRoot,
		host: input.host === undefined ? "127.0.0.1" : string(input.host, "host"),
		port,
		exactNetworkTargets: [...exactNetworkTargets] as string[],
		...(browserExecutorConfigPath ? { browserExecutorConfigPath } : {}),
		...(transportCredentialFile ? { transportCredentialFile } : {}),
		...(identity ? { identity } : {}),
		...(modelDecision ? { modelDecision } : {}),
	};
}

export async function loadExecutionRuntimeProcessConfig(path: string) {
	return parseExecutionRuntimeProcessConfig(
		JSON.parse(await readFile(resolve(path), "utf8")),
	);
}

type Runtime = Awaited<ReturnType<typeof createExecutionRuntime>>;

export async function createExecutionRuntimeProcess(input: {
	config: ExecutionRuntimeProcessConfig;
	browserExecutor?: ExecutionRuntimeOptions["browserExecutor"];
	browserReadiness?: () => boolean;
	carrierSummary?: () => {
		online: boolean;
		extensionInstanceId: string | null;
		queuedCommands: number;
		pendingCommands: number;
	};
	identityReadiness?: () => boolean;
	identity?: ExecutionRuntimeOptions["identity"];
	policy?: ExecutionRuntimeOptions["policy"];
	modelDecision?: ExecutionRuntimeOptions["modelDecision"];
	modelDecisionReadiness?: () => boolean;
	approval?: ExecutionRuntimeOptions["approval"];
	log?: (entry: Record<string, unknown>) => void;
	transportCredential?: string;
	requireModelDecision?: boolean;
}) {
	if (input.transportCredential && input.transportCredential.length < 32)
		throw new TypeError(
			"transport credential must contain at least 32 characters",
		);
	let state: ExecutionRuntimeProcessStatus["process"] = "STOPPED";
	let accepting = false;
	let server: Server | undefined;
	let runtime: Runtime | undefined;
	const active = new Set<Promise<void>>();
	const log = (event: string, fields: Record<string, unknown> = {}) =>
		input.log?.({
			timestamp: new Date().toISOString(),
			component: "execution-runtime-process",
			event,
			...fields,
		});
	const status = (): ExecutionRuntimeProcessStatus => {
		const browserExecutor = input.browserExecutor
			? input.browserReadiness?.() === false
				? "UNAVAILABLE"
				: "READY"
			: "UNAVAILABLE";
		const browserRequirementSatisfied =
			input.config.browserExecutorConfigPath === undefined ||
			browserExecutor === "READY";
		const identity =
			input.identity && input.identityReadiness?.() !== false
				? "READY"
				: "UNAVAILABLE";
		const identityRequirementSatisfied =
			input.config.identity === undefined || identity === "READY";
		const transportAuth = input.transportCredential ? "READY" : "UNAVAILABLE";
		const transportRequirementSatisfied =
			input.config.transportCredentialFile === undefined ||
			transportAuth === "READY";
		const modelDecision =
			input.modelDecision && input.modelDecisionReadiness?.() !== false
				? "READY"
				: "UNAVAILABLE";
		const modelRequirementSatisfied =
			input.requireModelDecision !== true || modelDecision === "READY";
		return {
			process: state,
			liveness: state === "STOPPED" ? "DOWN" : "UP",
			readiness:
				state === "RUNNING" &&
				accepting &&
				runtime &&
				browserRequirementSatisfied &&
				identityRequirementSatisfied &&
				transportRequirementSatisfied &&
				modelRequirementSatisfied
					? "READY"
					: "NOT_READY",
			accepting,
			inFlight: active.size,
			databasePath: input.config.databasePath,
			localExecutor: runtime ? "READY" : "UNAVAILABLE",
			browserExecutor,
			identity,
			transportAuth,
			modelDecision,
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
		if (state !== "STOPPED")
			throw new Error("execution runtime is not stopped");
		state = "STARTING";
		try {
			const localExecutor = await createLocalExecutorPort({
				projectRoot: input.config.projectRoot,
				artifactRoot: input.config.artifactRoot,
				exactNetworkTargets: input.config.exactNetworkTargets,
			});
			runtime = await createExecutionRuntime({
				databasePath: input.config.databasePath,
				localExecutor,
				...(input.browserExecutor
					? { browserExecutor: input.browserExecutor }
					: {}),
				...(input.identity ? { identity: input.identity } : {}),
				...(input.policy ? { policy: input.policy } : {}),
				...(input.modelDecision ? { modelDecision: input.modelDecision } : {}),
				...(input.approval ? { approval: input.approval } : {}),
			});
			server = createServer((request, response) => {
				const work = (async () => {
					const url = new URL(request.url ?? "/", "http://execution.local");
					if (request.method === "GET" && url.pathname === "/health")
						return respond(response, 200, { status: "UP" });
					if (request.method === "GET" && url.pathname === "/ready") {
						const current = status();
						return respond(
							response,
							current.readiness === "READY" ? 200 : 503,
							current,
						);
					}
					if (input.transportCredential) {
						const supplied = request.headers.authorization?.startsWith(
							"Bearer ",
						)
							? request.headers.authorization.slice(7)
							: "";
						const expectedBytes = Buffer.from(input.transportCredential);
						const suppliedBytes = Buffer.from(supplied);
						if (
							expectedBytes.length !== suppliedBytes.length ||
							!timingSafeEqual(expectedBytes, suppliedBytes)
						)
							return respond(response, 401, { error: "AUTHENTICATION_FAILED" });
					}
					if (!accepting || !runtime)
						return respond(response, 503, { error: "SERVICE_DRAINING" });
					try {
						if (request.method === "GET" && url.pathname === "/carrier/summary")
							return respond(
								response,
								200,
								input.carrierSummary?.() ?? {
									online: false,
									extensionInstanceId: null,
									queuedCommands: 0,
									pendingCommands: 0,
								},
							);
						if (
							request.method === "GET" &&
							url.pathname === "/artifacts/summary"
						)
							return respond(response, 200, runtime.getArtifactSummary());
						const chunks: Buffer[] = [];
						let byteLength = 0;
						for await (const chunk of request) {
							const buffer = Buffer.isBuffer(chunk)
								? chunk
								: Buffer.from(chunk);
							byteLength += buffer.byteLength;
							if (byteLength > 1_048_576)
								throw new TypeError("REQUEST_BODY_TOO_LARGE");
							chunks.push(buffer);
						}
						const body = chunks.length
							? JSON.parse(Buffer.concat(chunks).toString("utf8"))
							: undefined;
						if (
							request.method === "POST" &&
							url.pathname === "/artifacts/context-pack"
						) {
							const materialization =
								materializeContextPackRequestSchema.parse(body);
							const execution = await runtime.executeCapability({
								contract: "execution",
								contractVersion: EXECUTION_CONTRACT_VERSION,
								callerRef: materialization.callerRef,
								idempotencyKey: materialization.idempotencyKey,
								...(materialization.correlationId
									? { correlationId: materialization.correlationId }
									: {}),
								taskId: materialization.taskId,
								nodeId: materialization.nodeId,
								...(materialization.roleRef
									? { roleRef: materialization.roleRef }
									: {}),
								...(materialization.workerRef
									? { workerRef: materialization.workerRef }
									: {}),
								projectRoot: input.config.projectRoot,
								capability: "artifact.context-pack.materialize",
								input: {
									entries: materialization.entries,
									...(materialization.secrets
										? { secrets: materialization.secrets }
										: {}),
								},
							});
							if (
								execution.status !== "SUCCEEDED" ||
								execution.result?.capability !==
									"artifact.context-pack.materialize"
							)
								return respond(response, 409, execution);
							const artifact = runtime.getArtifactRecord({
								artifactRef: execution.result.data.artifactRef,
								callerRef: materialization.callerRef,
								taskId: materialization.taskId,
								nodeId: materialization.nodeId,
								...(materialization.roleRef
									? { roleRef: materialization.roleRef }
									: {}),
								...(materialization.workerRef
									? { workerRef: materialization.workerRef }
									: {}),
							});
							return respond(
								response,
								200,
								artifactMaterializationResponseSchema.parse({
									contract: "execution.artifact-materialization",
									contractVersion: EXECUTION_CONTRACT_VERSION,
									executionRef: execution.executionRef,
									artifact,
								}),
							);
						}
						if (
							request.method === "POST" &&
							url.pathname === "/artifacts/patch-proposal"
						) {
							const materialization =
								materializePatchProposalRequestSchema.parse(body);
							const execution = await runtime.executeCapability({
								contract: "execution",
								contractVersion: EXECUTION_CONTRACT_VERSION,
								callerRef: materialization.callerRef,
								idempotencyKey: materialization.idempotencyKey,
								...(materialization.correlationId
									? { correlationId: materialization.correlationId }
									: {}),
								taskId: materialization.taskId,
								nodeId: materialization.nodeId,
								...(materialization.roleRef
									? { roleRef: materialization.roleRef }
									: {}),
								...(materialization.workerRef
									? { workerRef: materialization.workerRef }
									: {}),
								projectRoot: input.config.projectRoot,
								capability: "artifact.patch-proposal.materialize",
								input: { proposal: materialization.proposal },
							});
							if (
								execution.status !== "SUCCEEDED" ||
								execution.result?.capability !==
									"artifact.patch-proposal.materialize"
							)
								return respond(response, 409, execution);
							const artifact = runtime.getArtifactRecord({
								artifactRef: execution.result.data.artifactRef,
								callerRef: materialization.callerRef,
								taskId: materialization.taskId,
								nodeId: materialization.nodeId,
								...(materialization.roleRef
									? { roleRef: materialization.roleRef }
									: {}),
								...(materialization.workerRef
									? { workerRef: materialization.workerRef }
									: {}),
							});
							return respond(
								response,
								200,
								artifactMaterializationResponseSchema.parse({
									contract: "execution.artifact-materialization",
									contractVersion: EXECUTION_CONTRACT_VERSION,
									executionRef: execution.executionRef,
									artifact,
								}),
							);
						}
						if (
							request.method === "POST" &&
							url.pathname === "/external-files/materialize"
						) {
							const materialization =
								materializeExternalFilesRequestSchema.parse(body);
							const execution = await runtime.executeCapability({
								contract: "execution",
								contractVersion: EXECUTION_CONTRACT_VERSION,
								callerRef: materialization.callerRef,
								idempotencyKey: materialization.idempotencyKey,
								...(materialization.correlationId
									? { correlationId: materialization.correlationId }
									: {}),
								...(materialization.taskId
									? { taskId: materialization.taskId }
									: {}),
								...(materialization.nodeId
									? { nodeId: materialization.nodeId }
									: {}),
								...(materialization.roleRef
									? { roleRef: materialization.roleRef }
									: {}),
								...(materialization.workerRef
									? { workerRef: materialization.workerRef }
									: {}),
								projectRoot: input.config.projectRoot,
								capability: "artifact.external-file.materialize",
								input: { files: materialization.files },
							});
							if (
								execution.status !== "SUCCEEDED" ||
								execution.result?.capability !==
									"artifact.external-file.materialize"
							)
								return respond(response, 409, execution);
							return respond(
								response,
								200,
								materializeExternalFilesResponseSchema.parse({
									contract: "execution.external-file-materialization",
									contractVersion: EXECUTION_CONTRACT_VERSION,
									executionRef: execution.executionRef,
									files: execution.result.data.files,
								}),
							);
						}
						if (
							request.method === "POST" &&
							url.pathname === "/approvals/request"
						)
							return respond(
								response,
								200,
								runtime.requestExecutionApproval(body),
							);
						if (
							request.method === "POST" &&
							url.pathname === "/approvals/decide"
						)
							return respond(
								response,
								200,
								runtime.decideExecutionApproval(body),
							);
						if (
							request.method === "POST" &&
							url.pathname === "/approvals/revoke"
						)
							return respond(
								response,
								200,
								runtime.revokeExecutionApproval(body),
							);
						if (request.method === "POST" && url.pathname === "/approvals/list")
							return respond(response, 200, {
								approvals: runtime.listExecutionApprovals(
									object(body ?? {}, "approval list input") as {
										executionRef?: string;
										status?: string;
									},
								),
							});
						if (
							request.method === "GET" &&
							url.pathname.startsWith("/approvals/")
						)
							return respond(
								response,
								200,
								runtime.getExecutionApproval(
									decodeURIComponent(url.pathname.slice(11)),
								),
							);
						if (request.method === "POST" && url.pathname === "/executions")
							return respond(
								response,
								200,
								await runtime.executeCapability(body),
							);
						if (
							request.method === "POST" &&
							url.pathname === "/executions/lookup"
						)
							return respond(
								response,
								200,
								runtime.lookupExecutionIntent(body),
							);
						if (
							request.method === "POST" &&
							url.pathname === "/observer-signals/list"
						) {
							const value = object(body ?? {}, "observer signal list input");
							return respond(response, 200, {
								signals: runtime.listExecutionObserverSignals(
									typeof value.limit === "number" ? value.limit : 50,
								),
							});
						}
						if (
							request.method === "POST" &&
							url.pathname === "/observer-signals/ack"
						) {
							const value = object(body, "observer signal ack input");
							return respond(
								response,
								200,
								runtime.acknowledgeExecutionObserverSignal(
									string(value.signalRef, "signalRef"),
								),
							);
						}
						if (
							request.method === "POST" &&
							url.pathname === "/executions/cancel"
						)
							return respond(
								response,
								200,
								await runtime.cancelExecution(body),
							);
						if (
							request.method === "POST" &&
							url.pathname === "/executions/output"
						) {
							const callerRef = request.headers["x-proflow-caller-ref"];
							if (typeof callerRef !== "string" || callerRef.length === 0)
								throw new Error("EXECUTION_CALLER_REQUIRED");
							return respond(
								response,
								200,
								await runtime.readExecutionOutputForCaller(body, callerRef),
							);
						}
						if (
							request.method === "GET" &&
							url.pathname.startsWith("/executions/")
						) {
							const callerRef = request.headers["x-proflow-caller-ref"];
							if (typeof callerRef !== "string" || callerRef.length === 0)
								throw new Error("EXECUTION_CALLER_REQUIRED");
							return respond(
								response,
								200,
								runtime.getExecutionForCaller({
									executionRef: parseExecutionRef(
										decodeURIComponent(url.pathname.slice(12)),
									),
									callerRef,
								}),
							);
						}
						respond(response, 404, { error: "NOT_FOUND" });
					} catch (error) {
						respond(response, 400, {
							error: error instanceof Error ? error.message : "INVALID_REQUEST",
						});
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
			state = "RUNNING";
			const address = server.address();
			if (!address || typeof address === "string")
				throw new Error("missing address");
			log("SERVICE_STARTED", { host: input.config.host, port: address.port });
			return { host: input.config.host, port: address.port };
		} catch (error) {
			state = "STOPPED";
			accepting = false;
			runtime?.close();
			runtime = undefined;
			throw error;
		}
	};
	const stop = async () => {
		if (state === "STOPPED") return;
		state = "DRAINING";
		accepting = false;
		const running = server;
		server = undefined;
		if (running)
			await new Promise<void>((resolveStop, reject) =>
				running.close((error) => (error ? reject(error) : resolveStop())),
			);
		await Promise.allSettled([...active]);
		runtime?.close();
		runtime = undefined;
		state = "STOPPED";
		log("SERVICE_STOPPED");
	};
	return Object.freeze({
		start,
		stop,
		async restart() {
			await stop();
			return start();
		},
		status,
		stateDirectory: dirname(input.config.databasePath),
	});
}
