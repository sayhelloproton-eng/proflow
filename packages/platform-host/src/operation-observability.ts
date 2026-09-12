import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, open, stat, rename, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
const safeRef = z.string().regex(/^[A-Za-z0-9_.:@/><-]{1,240}$/);
function sanitizeUrl(value: string): string {
	try {
		const url = new URL(value);
		if (!["http:", "https:"].includes(url.protocol))
			return "[REDACTED_INVALID_LOCATOR]";
		url.username = "";
		url.password = "";
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return "[REDACTED_INVALID_LOCATOR]";
	}
}
async function retainedTail(path: string): Promise<string> {
 const file=await open(path,"r");try {const size=(await file.stat()).size;const start=Math.max(0,size-5*1024*1024);const buffer=Buffer.alloc(size-start);await file.read(buffer,0,buffer.length,start);const text=buffer.toString("utf8");return start ? text.slice(text.indexOf("\n")+1) : text;}finally{await file.close();}
}
export const operationContext = new AsyncLocalStorage<{
	operationRef: string;
	parentOperationRef?: string;
}>();
export function incomingOperationRef(value: unknown): string {
	return typeof value === "string" && /^op:[0-9a-f-]{36}$/.test(value)
		? value
		: `op:${randomUUID()}`;
}
export const browserStructuredLogSchema = z
	.object({
		timestamp: z.string().datetime(),
		contract: z.literal("proflow.operation-event.v1").optional(),
		eventId: safeRef.optional(),
		sequenceNo: z.number().int().nonnegative().optional(),
		source: z.literal("browser-extension").optional(),
		extensionInstanceId: safeRef.optional(),
		moduleVersion: safeRef.optional(),
		event: safeRef.optional(),
		phase: safeRef.optional(),
		operationId: safeRef.optional(),
		correlationKind: z.enum(["EXACT", "IDENTITY_MATCH", "ADJACENT"]).optional(),
		decision: safeRef.optional(),
		reason: safeRef.optional(),
		sideEffectState: z
			.enum(["NOT_STARTED", "STARTED", "APPLIED", "NOT_APPLIED", "UNKNOWN"])
			.optional(),
		durationMs: z.number().nonnegative().optional(),
		contentInstanceId: safeRef.optional(),
		browserSessionEpoch: z.number().int().nonnegative().optional(),
		level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]),
		component: safeRef,
		capability: safeRef.optional(),
		operation: safeRef.optional(),
		status: safeRef.optional(),
		errorCode: safeRef.optional(),
		correlationId: safeRef.optional(),
		taskId: safeRef.optional(),
		nodeId: safeRef.optional(),
		runNo: z.number().int().nonnegative().optional(),
		agentPackageRef: safeRef.optional(),
		roleRef: safeRef.optional(),
		workerRef: safeRef.optional(),
		executionRef: safeRef.optional(),
		messageRef: safeRef.optional(),
		artifactRef: safeRef.optional(),
		evidenceRef: safeRef.optional(),
		conversationLocator: z
			.string()
			.max(1_000)
			.transform(sanitizeUrl)
			.optional(),
		operationRef: safeRef.optional(),
		attemptNo: z.number().int().nonnegative().optional(),
		tabId: z.number().int().nonnegative().optional(),
	})
	.strict();

/** One Host append owner, bounded queue and two 5 MiB segments per source. */
export function createOperationSink(stateRoot: string) {
	let tail = Promise.resolve();
	let pending = 0;
	const seen = new Set<string>();
	let restored = false;
	const write = (
		source: "browser-extension" | "platform-host",
		entry: Record<string, unknown>,
	): Promise<void> => {
		if (pending >= 1000) return Promise.reject(new Error("LOG_QUEUE_FULL"));
		pending++;
		const run = tail.then(async () => {
			const path = join(stateRoot, "logs", source, "events.jsonl");
			await mkdir(dirname(path), { recursive: true, mode: 0o700 });
			if (source === "browser-extension" && !restored) {
				for (const file of [path + ".1", path]) {
					try {
						for (const line of (await retainedTail(file)).split("\n")) {
							try {
								const v: unknown = JSON.parse(line);
								if (
									v &&
									typeof v === "object" &&
									typeof Reflect.get(v, "eventId") === "string"
								)
									seen.add(String(Reflect.get(v, "eventId")));
									if (seen.size > 20000) seen.delete(seen.values().next().value ?? "");
							} catch {}
						}
					} catch {}
				}
				restored = true;
			}
			const eventId =
				typeof entry.eventId === "string" ? entry.eventId : undefined;
			if (eventId && seen.has(eventId)) return;
			const info = await stat(path).catch(() => null);
			if (
				info &&
				(info.size >= 5 * 1024 * 1024 ||
					Date.now() - info.mtimeMs > 7 * 86400_000)
			)
				await rename(path, path + ".1");
			await appendFile(
				path,
				JSON.stringify({ ...entry, receivedAt: new Date().toISOString() }) +
					"\n",
				{ mode: 0o600 },
			);
			if (eventId) {
				seen.add(eventId);
				if (seen.size > 20000) seen.delete(seen.values().next().value ?? "");
			}
		});
		tail = run
			.catch(() => undefined)
			.finally(() => {
				pending--;
			});
		return run;
	};
	return { write, drain: () => tail };
}
function code(value: unknown): string | undefined {
	return typeof value === "string" && /^[A-Z][A-Z0-9_.:-]{0,159}$/.test(value)
		? value
		: undefined;
}
export function createHostOperationObserver(
	emit: (entry: Record<string, unknown>) => unknown,
) {
	const run = async <T>(
		surface: string,
		operationId: string,
		invoke: () => Promise<T>,
		axesInput?: unknown,
	): Promise<T> => {
		const parent = operationContext.getStore();
		const operationRef = `op:${randomUUID()}`;
		const started = performance.now();
		const record = (value: unknown, error?: unknown) => {
 const axes: Record<string,string>={};
 for(const candidate of [axesInput,value]) {if(!candidate || typeof candidate !== "object")continue;for(const key of ["taskId","nodeId","executionRef","workerRef","roleRef","evidenceRef","artifactRef"]){const v=Reflect.get(candidate,key);if(safeRef.safeParse(v).success)axes[key]=String(v);}}

			const result = value && typeof value === "object" ? value : {};
			const failed = error !== undefined || Reflect.get(result, "ok") === false;
			const errorValue = error ?? Reflect.get(result, "error");
			const errorCode =
				errorValue && typeof errorValue === "object"
					? code(Reflect.get(errorValue, "code")) ?? code(Reflect.get(errorValue,"message"))
					: undefined;
			const entry = {
				contract: "proflow.operation-boundary.v1",
				eventId: `host-event:${randomUUID()}`,
				timestamp: new Date().toISOString(),
				source: "platform-host",
				component: "platform-host-application-boundary",
				event: "HOST_APPLICATION",
				phase: surface,
				operationId: safeRef.safeParse(operationId).success
					? operationId
					: "INVALID_OPERATION",
				operationRef,
				...(parent
					? {
							parentOperationRef: parent.operationRef,
							correlationId: parent.parentOperationRef ?? parent.operationRef,
						}
					: {}),
				correlationKind: "EXACT",
				...axes,
 decision: code(Reflect.get(result,"decision")), reason: code(Reflect.get(result,"reason")),
 status: failed ? "FAILED" : Reflect.get(result,"decision") === "HUMAN_REQUIRED" ? "BLOCKED" : Reflect.get(result,"decision") === "DEFER" ? "DEFERRED" : "SUCCEEDED",
				sideEffectState: ["APPLIED","NOT_APPLIED","NOT_STARTED","UNKNOWN"].includes(String(Reflect.get(result,"sideEffectState"))) ? String(Reflect.get(result,"sideEffectState")) : "UNKNOWN",
				...(failed
					? { errorCode: errorCode ?? "HOST_APPLICATION_FAILED" }
					: {}),
				durationMs: performance.now() - started,
			};
			try {
				void Promise.resolve(emit(entry)).catch(() => undefined);
			} catch {}
		};
		return operationContext.run(
			{
				operationRef,
				...(parent
					? {
							parentOperationRef:
								parent.parentOperationRef ?? parent.operationRef,
							}
						: {}),
			},
			async () => {
				try {
					const value = await invoke();
					record(value);
					return value;
				} catch (error) {
					record(undefined, error);
					throw error;
				}
			},
		);
	};
	const port = <
		T extends { invoke(operation: string, input: unknown): Promise<unknown> },
	>(
		surface: string,
		target: T,
	): T => Object.freeze({
		...target,
		invoke: (operation: string, input: unknown) =>
			run(surface, operation, () => target.invoke(operation, input), input),
	});
	return { run, port };
}
