import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, isAbsolute, resolve } from "node:path";
import { parseExecutionRef } from "@tomflow/proflow-execution-contracts";
import { createLocalExecutor } from "@tomflow/proflow-execution-local";
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
	identity?: ExecutionRuntimeOptions["identity"];
	policy?: ExecutionRuntimeOptions["policy"];
	modelDecision?: ExecutionRuntimeOptions["modelDecision"];
	approval?: ExecutionRuntimeOptions["approval"];
	log?: (entry: Record<string, unknown>) => void;
}) {
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
	const status = (): ExecutionRuntimeProcessStatus => ({
		process: state,
		liveness: state === "STOPPED" ? "DOWN" : "UP",
		readiness: state === "RUNNING" && accepting ? "READY" : "NOT_READY",
		accepting,
		inFlight: active.size,
		databasePath: input.config.databasePath,
		localExecutor: runtime ? "READY" : "UNAVAILABLE",
		browserExecutor: input.browserExecutor ? "READY" : "UNAVAILABLE",
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
		if (state !== "STOPPED")
			throw new Error("execution runtime is not stopped");
		state = "STARTING";
		try {
			const localExecutor = await createLocalExecutor({
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
					if (!accepting || !runtime)
						return respond(response, 503, { error: "SERVICE_DRAINING" });
					try {
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
						if (request.method === "POST" && url.pathname === "/executions")
							return respond(
								response,
								200,
								await runtime.executeCapability(body),
							);
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
						)
							return respond(
								response,
								200,
								await runtime.readExecutionOutput(body),
							);
						if (
							request.method === "GET" &&
							url.pathname.startsWith("/executions/")
						)
							return respond(
								response,
								200,
								runtime.getExecution(
									parseExecutionRef(decodeURIComponent(url.pathname.slice(12))),
								),
							);
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
