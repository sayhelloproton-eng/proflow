#!/usr/bin/env node
import {
	existsSync,
	readFileSync,
	openSync,
	closeSync,
	fstatSync,
	readSync,
} from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
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
	return typeof value === "string" && /^[A-Za-z0-9_.:@/><-]{1,240}$/.test(value)
		? value
		: undefined;
}
function number(value) {
	return Number.isInteger(value) && Number(value) >= 0
		? Number(value)
		: undefined;
}
function parsedTimestamp(value) {
	const candidate = text(value);
	return candidate && !Number.isNaN(Date.parse(candidate))
		? candidate
		: undefined;
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
	const fd = openSync(path, "r");
	let data;
	try {
		const size = fstatSync(fd).size;
		const start = Math.max(0, size - 5 * 1024 * 1024);
		const buffer = Buffer.alloc(size - start);
		readSync(fd, buffer, 0, buffer.length, start);
		data = buffer.toString("utf8");
		if (start > 0) data = data.slice(data.indexOf("\n") + 1);
	} finally {
		closeSync(fd);
	}
	const lines = data.split("\n").filter(Boolean).slice(-5_000);
	return lines.flatMap((line) => {
		try {
			const value = record(JSON.parse(line));
			const timestamp = parsedTimestamp(
				value.timestamp ?? value.createdAt ?? value.observedAt,
			);
			if (!timestamp) return [];
			return [
				{
					timestamp,
					eventId: text(value.eventId),
					parentOperationRef: text(value.parentOperationRef),
					correlationKind: text(value.correlationKind),
					decision: text(value.decision),
					reason: text(value.reason),
					sideEffectState: text(value.sideEffectState),
					sequenceNo: number(value.sequenceNo),
					source,
					component: text(value.component) ?? source,
					event:
						text(value.operation) ??
						text(value.event) ??
						text(value.phase) ??
						"EVENT",
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
				},
			];
		} catch {
			return [];
		}
	});
}
function readTaskEvents(databasePath, taskId) {
	if (!existsSync(databasePath)) return [];
	let database;
	try {
		database = new DatabaseSync(databasePath, { readOnly: true });
		const rows = taskId
			? database
					.prepare(
						"SELECT * FROM task_events WHERE task_id=? ORDER BY event_id DESC LIMIT 2000",
					)
					.all(taskId)
			: database
					.prepare(
						"SELECT * FROM task_events ORDER BY event_id DESC LIMIT 2000",
					)
					.all();
		return rows.reverse().flatMap((raw) => {
			const row = record(raw);
			const timestamp = parsedTimestamp(row.created_at);
			if (!timestamp) return [];
			let payload = {};
			try {
				payload = record(
					row.payload_json ? JSON.parse(String(row.payload_json)) : {},
				);
			} catch {}
			return [
				{
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
				},
			];
		});
	} catch {
		return [];
	} finally {
		database?.close();
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
			/(?:SUCCEEDED|ONLINE|ACCEPTED|REPORTED|PERSISTED|RELEASED|COMPLETED)$/.test(
				event.event,
			),
	);
}
function correlationKind(event, options, roleRefs, workerRefs) {
	if (
		event.correlationKind !== "IDENTITY_MATCH" &&
		event.correlationKind !== "ADJACENT" &&
		((options.operationRef &&
			(event.operationRef === options.operationRef ||
				event.parentOperationRef === options.operationRef ||
				event.correlationId === options.operationRef)) ||
			(options.correlationId &&
				event.correlationId === options.correlationId) ||
			(options.executionRef && event.executionRef === options.executionRef))
	)
		return "EXACT";
	if (
		(options.taskId && event.taskId === options.taskId) ||
		(event.roleRef && roleRefs.has(event.roleRef)) ||
		(event.workerRef && workerRefs.has(event.workerRef))
	)
		return "IDENTITY_MATCH";
	return "ADJACENT";
}
function ownerFacts(path, query, params = [], optionsForFacts = {}) {
	if (!existsSync(path))
		return { availability: "UNAVAILABLE", path, facts: [] };
	let db;
	try {
		db = new DatabaseSync(path, { readOnly: true });
		return {
			availability: "AVAILABLE",
			path,
			facts: db
				.prepare(query)
				.all(...params)
				.flatMap((row) => {
					if (!("record_json" in row)) return [row];
					const v = record(JSON.parse(String(row.record_json)));
					if (optionsForFacts.taskId && v.taskId !== optionsForFacts.taskId)
						return [];
					if (
						optionsForFacts.executionRef &&
						row.execution_ref !== optionsForFacts.executionRef
					)
						return [];
					return [
						{
							executionRef: text(row.execution_ref),
							capability: text(row.capability),
							status: text(v.status),
							taskId: text(v.taskId),
							nodeId: text(v.nodeId),
							correlationId: text(v.correlationId),
							errorCode: text(record(v.error).code),
							sideEffectState: text(v.sideEffectState),
						},
					];
				}),
		};
	} catch {
		return {
			availability: "UNAVAILABLE",
			path,
			errorCode: "OWNER_READ_FAILED",
			facts: [],
		};
	} finally {
		db?.close();
	}
}

export function diagnoseOperationChain(options = {}) {
	let workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
	if (!options.workspaceRoot && basename(dirname(workspaceRoot)) === "repos")
		workspaceRoot = dirname(dirname(workspaceRoot));
	const stateRoot = join(workspaceRoot, ".proflow");
	const taskId = options.taskId;
	const executionDatabase = join(
		stateRoot,
		"runtime",
		"modules",
		"execution-runtime",
		"execution.sqlite",
	);
	const sinceMinutes = Math.max(
		1,
		Math.min(24 * 60, options.sinceMinutes ?? 30),
	);
	const nowMs = options.nowMs ?? Date.now();
	const sinceMs = nowMs - sinceMinutes * 60_000;
	const taskEvents = readTaskEvents(
		join(stateRoot, "state", "task.sqlite"),
		taskId,
	);
	const logSources = [
		[
			"browser-extension",
			join(stateRoot, "logs", "browser-extension", "events.jsonl"),
		],
		["agent-gateway", join(stateRoot, "logs", "agent-gateway", "events.jsonl")],
		["platform-host", join(stateRoot, "logs", "platform-host", "events.jsonl")],
		[
			"execution-runtime",
			join(
				dirname(executionDatabase),
				"logs",
				"execution-runtime",
				"events.jsonl",
			),
		],
		[
			"execution-runtime",
			join(stateRoot, "logs", "execution-runtime", "events.jsonl"),
		],
		[
			"execution-local",
			join(stateRoot, "logs", "execution-local", "events.jsonl"),
		],
		["model-runtime", join(stateRoot, "logs", "model", "inference.jsonl")],
	];
 const sourceAvailability=[];
 const logs=logSources.flatMap(([source,path])=>{
 try { const events=[readJsonl(`${path}.1`,source),readJsonl(path,source)].flat();sourceAvailability.push({source,path,availability:existsSync(path)||existsSync(`${path}.1`)?"AVAILABLE":"UNAVAILABLE"});return events;}
 catch {sourceAvailability.push({source,path,availability:"UNAVAILABLE",errorCode:"LOG_READ_FAILED"});return [];}
 });
	const all = [...taskEvents, ...logs]
		.filter(
			(event) =>
				Date.parse(event.timestamp) >= sinceMs &&
				Date.parse(event.timestamp) <= nowMs,
		)
		.sort(
			(left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
		);
	const explicitTask = taskId
		? all.filter(
				(event) => event.taskId === taskId || event.source === "task-owner",
			)
		: [];
	const anchor = explicitTask.at(-1);
	const anchorMs = anchor ? Date.parse(anchor.timestamp) : sinceMs;
	const roleRefs = new Set(
		explicitTask.flatMap((event) => (event.roleRef ? [event.roleRef] : [])),
	);
	const workerRefs = new Set(
		explicitTask.flatMap((event) => (event.workerRef ? [event.workerRef] : [])),
	);
	const seen = new Set();
	const timeline = all
		.filter((event) => {
			if (!event.eventId) return true;
			if (seen.has(event.eventId)) return false;
			seen.add(event.eventId);
			return true;
		})
		.filter((event) => {
			if (options.operationRef || options.correlationId || options.executionRef)
				return (
					correlationKind(event, options, roleRefs, workerRefs) === "EXACT"
				);
			if (!taskId) return true;
			if (event.taskId === taskId) return true;
			if (event.taskId && event.taskId !== taskId) return false;
			return Date.parse(event.timestamp) >= anchorMs - 60_000;
		})
		.map((event) => ({
			...event,
			correlationKind: correlationKind(event, options, roleRefs, workerRefs),
		}));
	const incident = timeline.filter(
		(event) => event.correlationKind === "EXACT",
	);
	// Child completion precedes parent completion logically, regardless of wall clock skew.
	const failures = incident.filter(isFailure);
	const leaves = failures.filter(
		(candidate) =>
			!failures.some(
				(child) => child.parentOperationRef === candidate.operationRef,
			),
	);
	const firstDivergence =
		leaves.length === 1
			? leaves[0]
			: leaves.length > 0 &&
					new Set(leaves.map((event) => event.operationRef)).size === 1
				? leaves[0]
				: null;
	// Siblings and nearby completions are not a proven successful predecessor.
	const previousSuccess = firstDivergence
		? (incident.find(
				(event) =>
					isSuccess(event) &&
					event.operationRef === firstDivergence.parentOperationRef,
			) ?? null)
		: null;
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
		operationRef: options.operationRef ?? null,
		correlationId: options.correlationId ?? null,
		attribution: firstDivergence
			? "OBSERVED_EXACT_BOUNDARY_NOT_PROVEN_ROOT_CAUSE"
			: "INSUFFICIENT_CAUSAL_EVIDENCE",
		divergenceCandidates: leaves,
		currentOwnerFacts: {
			task: taskId
				? ownerFacts(
						join(stateRoot, "state", "task.sqlite"),
						"SELECT task_id,status,version,current_node_id,updated_at FROM tasks WHERE task_id=?",
						[taskId],
					)
				: { availability: "NOT_REQUESTED", facts: [] },
			execution: ownerFacts(
				executionDatabase,
				"SELECT execution_ref,capability,record_json FROM executions ORDER BY created_at DESC LIMIT 2000",
				[],
				options,
			),
		},
		observedAt: new Date(nowMs).toISOString(),
		sinceMinutes,
		sourceAvailability,
		deployment: (() => {
			const value = record(
				readJsonFile(join(stateRoot, "deployment", "observer-summary.json")),
			);
			return {
				state: text(value.state) ?? "UNKNOWN",
				observedAt: parsedTimestamp(value.observedAt),
			};
		})(),
		anchor: anchor ?? null,
		firstDivergence,
		previousSuccess,
		lastSuccessfulBoundary: previousSuccess,
		successfulBoundaryCandidates: incident.filter(isSuccess),
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
			`${value.timestamp} ${value.source}/${value.component} ${value.event} status=${value.status ?? "-"} reason=${value.reason ?? "-"} decision=${value.decision ?? "-"} sideEffect=${value.sideEffectState ?? "UNKNOWN"} error=${value.errorCode ?? "-"} correlation=${value.correlationKind}`,
		);
		if (result.previousSuccess)
			lines.push(
				`previous success: ${result.previousSuccess.timestamp} ${result.previousSuccess.source}/${result.previousSuccess.event}`,
			);
	} else lines.push("", "FIRST DIVERGENCE: insufficient exact causal evidence");
	lines.push("", "LATEST BY OWNER");
	for (const [source, value] of Object.entries(result.latestBySource))
		if (value)
			lines.push(
				`${source}: ${value.timestamp} ${value.event} status=${value.status ?? "-"} error=${value.errorCode ?? "-"}`,
			);
	lines.push("", "TIMELINE");
	for (const event of result.timeline.slice(-80))
		lines.push(
			`${event.timestamp} [${event.correlationKind}] ${event.source}/${event.event} ${event.status ?? "-"}${event.errorCode ? ` ${event.errorCode}` : ""}`,
		);
	return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
	const options = {};
	let json = false;
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === "--json") {
			json = true;
			continue;
		}
		const next = argv[index + 1];
		if (value === "--workspace" && next) {
			options.workspaceRoot = next;
			index += 1;
			continue;
		}
		if (value === "--operation" && next) {
			options.operationRef = next;
			index += 1;
			continue;
		}
		if (value === "--correlation" && next) {
			options.correlationId = next;
			index += 1;
			continue;
		}
		if (value === "--execution" && next) {
			options.executionRef = next;
			index += 1;
			continue;
		}
		if (value === "--task" && next) {
			options.taskId = next;
			index += 1;
			continue;
		}
		if (value === "--since-minutes" && next) {
			options.sinceMinutes = Number(next);
			index += 1;
			continue;
		}
		throw new Error(`unknown or incomplete argument: ${value}`);
	}
	return { options, json };
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	try {
		const { options, json } = parseArgs(process.argv.slice(2));
		const result = diagnoseOperationChain(options);
		process.stdout.write(
			json
				? `${JSON.stringify(result, null, 2)}\n`
				: renderOperationChainDiagnostic(result),
		);
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	}
}
