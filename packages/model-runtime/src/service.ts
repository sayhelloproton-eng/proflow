import { createServer, type Server } from "node:http";

import type {
	InferenceResult,
	ModelRuntimeStatus,
} from "@tomflow/proflow-model-contracts";

type RuntimePublicApi = {
	infer(
		request: unknown,
		options?: { signal?: AbortSignal },
	): Promise<InferenceResult>;
	getRuntimeStatus(): ModelRuntimeStatus;
};

export type ModelRuntimeService = {
	start(): Promise<{ host: string; port: number }>;
	stop(): Promise<void>;
	status(): "STOPPED" | "RUNNING";
};

async function requestBody(
	request: import("node:http").IncomingMessage,
): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > 1_048_576) throw new Error("request body exceeds 1 MiB");
		chunks.push(buffer);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createModelRuntimeService(input: {
	runtime: RuntimePublicApi;
	host?: string;
	port?: number;
}): ModelRuntimeService {
	const host = input.host ?? "127.0.0.1";
	const port = input.port ?? 0;
	let server: Server | undefined;
	const inferenceControllers = new Set<AbortController>();
	return {
		async start() {
			if (server) throw new Error("model runtime service is already running");
			server = createServer(async (request, response) => {
				response.setHeader("content-type", "application/json; charset=utf-8");
				const inferenceController = new AbortController();
				const clientAborted = () => inferenceController.abort("CLIENT_ABORT");
				request.once("aborted", clientAborted);
				response.once("close", () => {
					if (!response.writableEnded) clientAborted();
				});
				try {
					if (request.method === "GET" && request.url === "/status") {
						response.end(JSON.stringify(input.runtime.getRuntimeStatus()));
						return;
					}
					if (request.method === "POST" && request.url === "/infer") {
						inferenceControllers.add(inferenceController);
						const result = await input.runtime.infer(
							await requestBody(request),
							{
								signal: inferenceController.signal,
							},
						);
						if (response.destroyed) return;
						response.end(JSON.stringify(result));
						return;
					}
					response.statusCode = 404;
					response.end(JSON.stringify({ error: "NOT_FOUND" }));
				} catch {
					if (response.destroyed) return;
					response.statusCode = 400;
					response.end(JSON.stringify({ error: "INVALID_REQUEST" }));
				} finally {
					inferenceControllers.delete(inferenceController);
					request.removeListener("aborted", clientAborted);
				}
			});
			await new Promise<void>((resolve, reject) => {
				server?.once("error", reject);
				server?.listen(port, host, resolve);
			});
			const address = server.address();
			if (!address || typeof address === "string")
				throw new Error("service did not bind a TCP address");
			return { host, port: address.port };
		},
		async stop() {
			const running = server;
			server = undefined;
			if (!running) return;
			for (const controller of inferenceControllers)
				controller.abort("RESTART");
			await new Promise<void>((resolve, reject) =>
				running.close((error) => (error ? reject(error) : resolve())),
			);
		},
		status: () => (server ? "RUNNING" : "STOPPED"),
	};
}
