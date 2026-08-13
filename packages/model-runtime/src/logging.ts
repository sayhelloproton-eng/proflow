import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type ModelRuntimeLogEntry = {
	timestamp: string;
	event: "PRE_QUEUE_REJECTION" | "INFERENCE_RESULT";
	phase: "VALIDATION" | "HEALTH" | "RESULT";
	inferenceRef: string;
	specRef: string;
	callerRef: string;
	correlationId?: string;
	requestedMode: "fast" | "reason" | "auto";
	actualMode?: "fast" | "reason";
	status: "SUCCEEDED" | "FAILED" | "CANCELLED";
	errorCode?: string;
	queueLatencyMs: number;
	inferenceLatencyMs?: number;
	totalLatencyMs: number;
	payloadBytes: number;
	payloadFingerprint: string;
	imageCount: number;
	images: Array<{
		mimeType: string;
		bytes: number;
		fingerprint: string;
	}>;
	providerRequestRefs: string[];
	finishReasons: string[];
	thinkingStatuses: string[];
	repairCount: number;
};

export type ModelRuntimeLogger = {
	log(entry: ModelRuntimeLogEntry): Promise<void>;
};

export function fingerprint(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

export function createFileModelRuntimeLogger(input: {
	proflowRoot: string;
}): ModelRuntimeLogger {
	const directory = join(input.proflowRoot, "logs", "model");
	const path = join(directory, "inference.jsonl");
	let writes = Promise.resolve();
	return {
		async log(entry) {
			const line = `${JSON.stringify(entry)}\n`;
			writes = writes.then(async () => {
				await mkdir(directory, { recursive: true });
				await appendFile(path, line, { encoding: "utf8", mode: 0o600 });
			});
			await writes;
		},
	};
}
