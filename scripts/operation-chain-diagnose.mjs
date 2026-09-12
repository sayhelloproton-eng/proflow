#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const failureStatuses = new Set([
	"FAILED",
	"BLOCKED",
	"UNKNOWN",
	"HUMAN_REQUIRED",
]);
const successStatuses = new Set(["SUCCEEDED", "APPLIED", "READY", "RUNNING"]);

function record(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value
		: {};
}
function text(value) {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}
function number(value) {
	return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}
function parsedTimestamp(value) {
	const candidate = text(value);
	return candidate && !Number.isNaN(Date.parse(candidate)) ? candidate : undefined;
}
function readJsonFile(path) {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}
function readJsonl(path, source) {
	if (!existsSync(path)) return [];
	const lines = readFileSync(path, "utf8").split("\n").filter(Boolean).slice(-5_000);
	return lines.flatMap((line) => {
		try {
			const value = record(JSON.parse(line));
			const timestamp = parsedTimestamp(value.timestamp ?? value.createdAt ?? value.observedAt);
			if (!timestamp) return [];
			return [{
				timestamp,
				source,
				component: text(value.component) ?? source,
				event: text(value.operation) ?? text(value.event) ?? text(value.phase) ?? "EVENT",
				status: text(value.status) ?? text(value.phase),
				errorCode: text(value.errorCode),
				correlationId: text(value.correlationId),
				taskId: text(value.taskId),
				nodeId: text(value.nodeId),
				runNo: number(value.runNo),
				roleRef: text(value.roleRef),
				workerRef: text(value.workerRef),
				executionRef: text(value.executionRef),
				operationRef: text(value.operationRef),
				capability: text(value.capability),
				operationId: text(value.operationId),
			}];
		} catch {
			return [];
		}
	});
}
function readTaskEvents(databasePath, taskId) {
	if (!existsSync(databasePath)) return [];
	const database = new DatabaseSync(databasePath, { readOnly: true });
	try {
		const rows = taskId
			? database.prepare("SELECT * FROM task_events WHERE task_id=? ORDER BY event_id DESC LIMIT 2000").all(taskId)
			: database.prepare("SELECT * FROM task_events ORDER BY event_id DESC LIMIT 2000").all();
		return rows.reverse().flatMap((raw) => {
			const row = record(raw);
			const timestamp = parsedTimestamp(row.created_at);
			if (!timestamp) return [];
			let payload = {};
			try { payload = record(row.payload_json ? JSON.parse(String(row.payload_json)) : {}); } catch {}
			return [{
				timestamp,
				source: "task-owner",
				component: "task-owner",
				event: String(row.event_type ?? "TASK_EVENT"),
				status: text(payload.status) ?? "SUCCEEDED",
				errorCode: text(payload.errorCode),
				correlationId: text(payload.correlationId),
				taskId: text(row.task_id),
				nodeId: text(row.node_id),
				runNo: number(payload.runNo),
				roleRef: text(payload.roleRef),
				workerRef: text(payload.workerRef),
				executionRef: text(payload.executionRef),
				operationRef: text(payload.operationRef ?? payload.triggerRef),
				capability: text(payload.capability),
				operationId: text(payload.operationId),
			}];
		});
	} catch {
		return [];
	} finally {
		database.close();
	}
}
function isFailure(event) {
	return Boolean(
		event.errorCode ||
		failureStatuses.has(event.status) ||
		/(?:FAILED|REJECTED|UNKNOWN|TIMEOUT|DISCONNECTED)$/.test(event.event),
	);
}
function isSuccess(event) {
	return Boolean(
		successStatuses.has(event.status) ||
		/(?:SUCCEEDED|ONLINE|ACCEPTED|REPORTED|PERSISTED|RELEASED|COMPLETED)$/.test(event.event),
	);
}
function correlationKind(event, taskId, roleRefs, workerRefs) {
	if (taskId && event.taskId === taskId) return "EXACT";
	if (event.correlationId || event.executionRef) return "EXACT";
	if (
		(event.roleRef && roleRefs.has(event.roleRef)) ||
		(event.workerRef && workerRefs.has(event.workerRef))
	) return "IDENTITY_MATCH";
	return "ADJACENT";
}

export function diagnoseOperationChain(options = {}) {
	const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
	const stateRoot = join(workspaceRoot, ".proflow");
	const taskId = options.taskId;
	const sinceMinutes = Math.max(1, Math.min(24 * 60, options.sinceMinutes ?? 30));
	const nowMs = options.nowMs ?? Date.now();
	const sinceMs = nowMs - sinceMinutes * 60_000;
	const taskEvents = readTaskEvents(join(stateRoot, "state", "task.sqlite"), taskId);
	const logs = [
		["browser-extension", join(stateRoot, "logs", "browser-extension", "events.jsonl")],
		["agent-gateway", join(stateRoot, "logs", "agent-gateway", "events.jsonl")],
		["execution-runtime", join(stateRoot, "logs", "execution-runtime", "events.jsonl")],
		["execution-local", join(stateRoot, "logs", "execution-local", "events.jsonl")],
		["model-runtime", join(stateRoot, "logs", "model", "inference.jsonl")],
	].flatMap(([source, path]) => readJsonl(path, source));
	const all = [...taskEvents, ...logs]
		.filter((event) => Date.parse(event.timestamp) >= sinceMs)
		.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
	const explicitTask = taskId
		? all.filter((event) => event.taskId === taskId || event.source === "task-owner")
		: [];
	const anchor = explicitTask.at(-1);
	const anchorMs = anchor ? Date.parse(anchor.timestamp) : sinceMs;
	const roleRefs = new Set(explicitTask.flatMap((event) => event.roleRef ? [event.roleRef] : []));
	const workerRefs = new Set(explicitTask.flatMap((event) => event.workerRef ? [event.workerRef] : []));
	const timeline = all
		.filter((event) => {
			if (!taskId) return true;
			if (event.taskId === taskId) return true;
			if (event.taskId && event.taskId !== taskId) return false;
			return Date.parse(event.timestamp) >= anchorMs - 60_000;
		})
		.map((event) => ({
			...event,
			correlationKind: correlationKind(event, taskId, roleRefs, workerRefs),
		}));
	const incidentStartMs = anchor ? Date.parse(anchor.timestamp) : sinceMs;
	const incident = timeline.filter((event) => Date.parse(event.timestamp) >= incidentStartMs);
	const firstDivergenceIndex = incident.findIndex(isFailure);
	const firstDivergence = firstDivergenceIndex >= 0 ? incident[firstDivergenceIndex] : null;
	let previousSuccess = null;
	if (firstDivergenceIndex >= 0)
		for (let index = firstDivergenceIndex - 1; index >= 0; index -= 1)
			if (isSuccess(incident[index])) { previousSuccess = incident[index]; break; }
	const latestBySource = Object.fromEntries(
		[...new Set(timeline.map((event) => event.source))].map((source) => [
			source,
			[...timeline].reverse().find((event) => event.source === source) ?? null,
		]),
	);
	return {
		contract: "proflow.operation-chain-diagnostic.v1",
		workspaceRoot,
		taskId: taskId ?? null,
		observedAt: new Date(nowMs).toISOString(),
		sinceMinutes,
		deployment: readJsonFile(join(stateRoot, "deployment", "observer-summary.json")),
		anchor: anchor ?? null,
		firstDivergence,
		previousSuccess,
		latestBySource,
		timeline,
	};
}

export function renderOperationChainDiagnostic(result) {
	const lines = [
		"ProFlow Operation Chain Diagnostic",
		`observedAt: ${result.observedAt}`,
		`task: ${result.taskId ?? "ALL"}`,
		`events: ${result.timeline.length}`,
	];
	if (result.deployment && typeof result.deployment === "object")
		lines.push(`deployment: ${result.deployment.state ?? "UNKNOWN"}`);
	if (result.firstDivergence) {
		const value = result.firstDivergence;
		lines.push(
			"",
			"FIRST DIVERGENCE",
			`${value.timestamp} ${value.source}/${value.component} ${value.event} status=${value.status ?? "-"} error=${value.errorCode ?? "-"} correlation=${value.correlationKind}`,
		);
		if (result.previousSuccess)
			lines.push(
				`previous success: ${result.previousSuccess.timestamp} ${result.previousSuccess.source}/${result.previousSuccess.event}`,
			);
	} else lines.push("", "FIRST DIVERGENCE: none observed");
	lines.push("", "LATEST BY OWNER");
	for (const [source, value] of Object.entries(result.latestBySource))
		if (value)
			lines.push(`${source}: ${value.timestamp} ${value.event} status=${value.status ?? "-"} error=${value.errorCode ?? "-"}`);
	lines.push("", "TIMELINE");
	for (const event of result.timeline.slice(-80))
		lines.push(`${event.timestamp} [${event.correlationKind}] ${event.source}/${event.event} ${event.status ?? "-"}${event.errorCode ? ` ${event.errorCode}` : ""}`);
	return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
	const options = {};
	let json = false;
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === "--json") { json = true; continue; }
		const next = argv[index + 1];
		if (value === "--workspace" && next) { options.workspaceRoot = next; index += 1; continue; }
		if (value === "--task" && next) { options.taskId = next; index += 1; continue; }
		if (value === "--since-minutes" && next) { options.sinceMinutes = Number(next); index += 1; continue; }
		throw new Error(`unknown or incomplete argument: ${value}`);
	}
	return { options, json };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const { options, json } = parseArgs(process.argv.slice(2));
		const result = diagnoseOperationChain(options);
		process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : renderOperationChainDiagnostic(result));
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
