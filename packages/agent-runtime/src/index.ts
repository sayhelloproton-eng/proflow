import {
	createHash,
	randomBytes,
	randomUUID,
	timingSafeEqual,
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
export const AGENT_CONTRACT_VERSION = "1.0.0" as const;
export type TaskFacts = {
	taskId: string;
	status:
		| "PENDING"
		| "READY"
		| "ACTIVE"
		| "WAITING"
		| "FAILED"
		| "PAUSED"
		| "SUCCEEDED"
		| "TERMINATED";
	roleBindings: Array<{
		agentPackageRef: string;
		roleRef: string;
		workerRef: string | null;
		conversationLocator: string | null;
	}>;
};
export type TaskPublicPort = {
	getTask(taskId: string): Promise<TaskFacts>;
	hasNonTerminalRoleUsage(roleRef: string): Promise<boolean>;
};
export type AgentRuntimeOptions = {
	proflowRoot: string;
	task: TaskPublicPort;
	now?: () => Date;
	idFactory?: () => string;
	credentialFactory?: () => string;
};
export type RegisteredRole = {
	agentPackageRef: string;
	registeredPackageVersion: string;
	roleRef: string;
	carrierType: "custom-gpt";
	carrierUrl: string;
	registeredAt: string;
};
export type CollaborationThread = {
	threadId: string;
	taskId: string;
	state: "OPEN_CAN_ASK" | "OPEN_AWAITING_REPLY" | "OPEN_REPLY_PENDING_DELIVERY";
	lastQuestionMessageId: string | null;
	lastReplyMessageId: string | null;
	version: number;
};
export type CollaborationMessage = {
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
	status: "PENDING" | "DELIVERED";
	deliveryAttemptCount: number;
	lastDeliveryErrorCode: string | null;
	executionRef: string | null;
	evidenceRef: string | null;
	version: number;
	createdAt: string;
	deliveredAt: string | null;
};
export class AgentRuntimeError extends Error {
	readonly code: string;
	constructor(code: string, message = code) {
		super(`${code}: ${message}`);
		this.code = code;
	}
}
const identifier = z.string().min(1).max(512);
const fixedAgentPackageRefs = [
	"@tomflow/proflow-agent-product",
	"@tomflow/proflow-agent-controller-dev",
	"@tomflow/proflow-agent-test-ops",
] as const;
const roleRegistrationSchema = z
	.object({
		agentPackageRef: z.enum(fixedAgentPackageRefs),
		registeredPackageVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
		roleRef: z.string().regex(/^g-[A-Za-z0-9_-]+$/),
		carrierUrl: z
			.url()
			.refine((value) => value.startsWith("https://chatgpt.com/g/")),
	})
	.strict()
	.superRefine((value, context) => {
		if (value.carrierUrl !== `https://chatgpt.com/g/${value.roleRef}`)
			context.addIssue({
				code: "custom",
				path: ["carrierUrl"],
				message: "carrierUrl must exactly bind roleRef",
			});
	});
const workerValidationSchema = z
	.object({
		authenticatedRoleRef: identifier,
		taskId: identifier,
		workerRef: identifier,
	})
	.strict();
const askSchema = z
	.object({
		authenticatedRoleRef: identifier,
		taskId: identifier,
		threadId: identifier.optional(),
		fromWorkerRef: identifier,
		targetAgentPackageRef: identifier,
		content: z.string().min(1).max(100_000),
		idempotencyKey: identifier,
	})
	.strict();
const replySchema = z
	.object({
		authenticatedRoleRef: identifier,
		threadId: identifier,
		fromWorkerRef: identifier,
		content: z.string().min(1).max(100_000),
		idempotencyKey: identifier,
	})
	.strict();
const deliverySchema = z
	.object({
		messageId: identifier,
		expectedMessageVersion: z.number().int().positive(),
		outcome: z.enum(["DELIVERED", "FAILED", "UNKNOWN"]),
		observedRoleRef: identifier,
		observedWorkerRef: identifier,
		executionRef: identifier.optional(),
		evidenceRef: identifier.optional(),
		errorCode: identifier.optional(),
	})
	.strict()
	.superRefine((delivery, context) => {
		if (delivery.outcome !== "DELIVERED") return;
		if (!delivery.executionRef)
			context.addIssue({
				code: "custom",
				message: "DELIVERED requires a non-empty executionRef",
				path: ["executionRef"],
			});
		if (!delivery.evidenceRef)
			context.addIssue({
				code: "custom",
				message: "DELIVERED requires a non-empty evidenceRef",
				path: ["evidenceRef"],
			});
	});
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
			.join(",")}}`;
	return JSON.stringify(value);
}
function fingerprint(value: unknown): string {
	return createHash("sha256").update(canonical(value)).digest("hex");
}
function terminal(task: TaskFacts): boolean {
	return task.status === "SUCCEEDED" || task.status === "TERMINATED";
}
async function atomicJson(path: string, value: unknown, mode = 0o600) {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${randomUUID()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
	await rename(temporary, path);
}
type ThreadRow = Record<string, string | number | null>;
type MessageRow = Record<string, string | number | null>;
function threadFromRow(row: ThreadRow): CollaborationThread {
	return {
		threadId: String(row.thread_id),
		taskId: String(row.task_id),
		state: String(row.state) as CollaborationThread["state"],
		lastQuestionMessageId:
			row.last_question_message_id === null
				? null
				: String(row.last_question_message_id),
		lastReplyMessageId:
			row.last_reply_message_id === null
				? null
				: String(row.last_reply_message_id),
		version: Number(row.version),
	};
}
function messageFromRow(row: MessageRow): CollaborationMessage {
	return {
		messageId: String(row.message_id),
		threadId: String(row.thread_id),
		taskId: String(row.task_id),
		kind: String(row.kind) as CollaborationMessage["kind"],
		fromRoleRef: String(row.from_role_ref),
		fromWorkerRef: String(row.from_worker_ref),
		targetRoleRef: String(row.target_role_ref),
		targetWorkerRef: String(row.target_worker_ref),
		replyToMessageId:
			row.reply_to_message_id === null ? null : String(row.reply_to_message_id),
		content: String(row.content),
		status: String(row.status) as CollaborationMessage["status"],
		deliveryAttemptCount: Number(row.delivery_attempt_count),
		lastDeliveryErrorCode:
			row.last_delivery_error_code === null
				? null
				: String(row.last_delivery_error_code),
		executionRef: row.execution_ref === null ? null : String(row.execution_ref),
		evidenceRef: row.evidence_ref === null ? null : String(row.evidence_ref),
		version: Number(row.version),
		createdAt: String(row.created_at),
		deliveredAt: row.delivered_at === null ? null : String(row.delivered_at),
	};
}
export async function createAgentRuntime(options: AgentRuntimeOptions) {
	const now = options.now ?? (() => new Date());
	const idFactory = options.idFactory ?? randomUUID;
	const credentialFactory =
		options.credentialFactory ?? (() => randomBytes(32).toString("base64url"));
	const agentRoot = join(options.proflowRoot, "agent");
	const registryPath = join(agentRoot, "roles.json");
	const credentialPath = join(agentRoot, "secrets", "role-credentials.json");
	const databasePath = join(agentRoot, "collaboration", "collaboration.sqlite");
	await mkdir(dirname(databasePath), { recursive: true, mode: 0o700 });
	await mkdir(dirname(credentialPath), { recursive: true, mode: 0o700 });
	const roles = new Map<string, RegisteredRole>();
	if (existsSync(registryPath)) {
		const parsed = z
			.array(
				roleRegistrationSchema.safeExtend({
					carrierType: z.literal("custom-gpt"),
					registeredAt: z.iso.datetime(),
				}),
			)
			.parse(JSON.parse(readFileSync(registryPath, "utf8")));
		for (const role of parsed) roles.set(role.roleRef, role);
	}
	const credentials = new Map<string, string>();
	if (existsSync(credentialPath)) {
		const parsed = z
			.record(identifier, identifier)
			.parse(JSON.parse(readFileSync(credentialPath, "utf8")));
		for (const [roleRef, credential] of Object.entries(parsed))
			credentials.set(roleRef, credential);
	} else await atomicJson(credentialPath, {});
	const database = new DatabaseSync(databasePath);
	database.exec(
		"PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
	);
	database.exec(`
		CREATE TABLE IF NOT EXISTS collaboration_threads (
			thread_id TEXT PRIMARY KEY, contract_version TEXT NOT NULL, task_id TEXT NOT NULL,
			participant_a_role_ref TEXT NOT NULL, participant_a_worker_ref TEXT NOT NULL,
			participant_b_role_ref TEXT NOT NULL, participant_b_worker_ref TEXT NOT NULL,
			state TEXT NOT NULL CHECK (state IN ('OPEN_CAN_ASK','OPEN_AWAITING_REPLY','OPEN_REPLY_PENDING_DELIVERY')),
			last_question_message_id TEXT, last_reply_message_id TEXT,
			version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS collaboration_messages (
			message_id TEXT PRIMARY KEY, contract_version TEXT NOT NULL, thread_id TEXT NOT NULL, task_id TEXT NOT NULL,
			kind TEXT NOT NULL CHECK(kind IN ('QUESTION','REPLY')),
			from_role_ref TEXT NOT NULL, from_worker_ref TEXT NOT NULL,
			target_role_ref TEXT NOT NULL, target_worker_ref TEXT NOT NULL,
			reply_to_message_id TEXT, content TEXT NOT NULL,
			status TEXT NOT NULL CHECK(status IN ('PENDING','DELIVERED')),
			delivery_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(delivery_attempt_count >= 0),
			last_delivery_error_code TEXT, execution_ref TEXT, evidence_ref TEXT,
			version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
			created_at TEXT NOT NULL, delivered_at TEXT, updated_at TEXT NOT NULL,
			FOREIGN KEY(thread_id) REFERENCES collaboration_threads(thread_id)
		);
		CREATE TABLE IF NOT EXISTS collaboration_idempotency (
			idempotency_key TEXT PRIMARY KEY, operation TEXT NOT NULL, request_hash TEXT NOT NULL,
			response_json TEXT NOT NULL, created_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_collab_threads_task ON collaboration_threads(task_id, updated_at);
		CREATE INDEX IF NOT EXISTS idx_collab_messages_pending ON collaboration_messages(status, created_at);
		CREATE INDEX IF NOT EXISTS idx_collab_messages_thread ON collaboration_messages(thread_id, created_at);
		CREATE INDEX IF NOT EXISTS idx_collab_messages_target ON collaboration_messages(target_role_ref, target_worker_ref, status, created_at);
	`);
	const persistRoles = () =>
		atomicJson(
			registryPath,
			[...roles.values()].sort((left, right) =>
				left.agentPackageRef.localeCompare(right.agentPackageRef),
			),
		);
	const persistCredentialSnapshot = (snapshot: ReadonlyMap<string, string>) =>
		atomicJson(credentialPath, Object.fromEntries(snapshot), 0o600);
	const persistCredentials = () => persistCredentialSnapshot(credentials);
	const findRoleForPackage = (agentPackageRef: string) => {
		const role = [...roles.values()].find(
			(candidate) => candidate.agentPackageRef === agentPackageRef,
		);
		if (!role) throw new AgentRuntimeError("ROLE_NOT_FOUND");
		return role;
	};
	const validateWorker = async (raw: unknown) => {
		const input = workerValidationSchema.parse(raw);
		const task = await options.task.getTask(input.taskId);
		if (terminal(task)) throw new AgentRuntimeError("TASK_TERMINAL");
		const binding = task.roleBindings.find(
			(candidate) => candidate.roleRef === input.authenticatedRoleRef,
		);
		if (!binding) throw new AgentRuntimeError("ROLE_NOT_TASK_PARTICIPANT");
		if (!binding.workerRef || binding.workerRef !== input.workerRef)
			throw new AgentRuntimeError("WORKER_IDENTITY_INVALID");
		return {
			roleRef: input.authenticatedRoleRef,
			workerRef: input.workerRef,
			taskId: input.taskId,
		};
	};
	const getThread = (threadId: string) => {
		const row = database
			.prepare("SELECT * FROM collaboration_threads WHERE thread_id=?")
			.get(threadId) as ThreadRow | undefined;
		if (!row) throw new AgentRuntimeError("THREAD_NOT_FOUND");
		return { row, value: threadFromRow(row) };
	};
	const getMessage = (messageId: string) => {
		const row = database
			.prepare("SELECT * FROM collaboration_messages WHERE message_id=?")
			.get(messageId) as MessageRow | undefined;
		if (!row) throw new AgentRuntimeError("MESSAGE_NOT_FOUND");
		return messageFromRow(row);
	};
	const replay = <T>(
		key: string,
		operation: string,
		request: unknown,
	): T | undefined => {
		const row = database
			.prepare(
				"SELECT * FROM collaboration_idempotency WHERE idempotency_key=?",
			)
			.get(key) as Record<string, string> | undefined;
		if (!row) return undefined;
		if (
			row.operation !== operation ||
			row.request_hash !== fingerprint(request)
		)
			throw new AgentRuntimeError("IDEMPOTENCY_CONFLICT");
		return JSON.parse(String(row.response_json)) as T;
	};
	const saveReplay = (
		key: string,
		operation: string,
		request: unknown,
		response: unknown,
	) => {
		database
			.prepare("INSERT INTO collaboration_idempotency VALUES (?,?,?,?,?)")
			.run(
				key,
				operation,
				fingerprint(request),
				JSON.stringify(response),
				now().toISOString(),
			);
	};
	const readDurableRoleRefs = (): {
		roles: Set<string>;
		credentials: Set<string>;
	} => {
		const durableRoles = new Set<string>();
		if (existsSync(registryPath)) {
			const parsed = z
				.array(
					roleRegistrationSchema.safeExtend({
						carrierType: z.literal("custom-gpt"),
						registeredAt: z.iso.datetime(),
					}),
				)
				.parse(JSON.parse(readFileSync(registryPath, "utf8")));
			for (const role of parsed) durableRoles.add(role.roleRef);
		}
		const durableCredentials = new Set<string>();
		if (existsSync(credentialPath)) {
			const parsed = z
				.record(identifier, identifier)
				.parse(JSON.parse(readFileSync(credentialPath, "utf8")));
			for (const roleRef of Object.keys(parsed))
				durableCredentials.add(roleRef);
		}
		return { roles: durableRoles, credentials: durableCredentials };
	};
	const doctorRoleStore = () => {
		const issues: string[] = [];
		let durableRoles = new Set<string>();
		let durableCredentials = new Set<string>();
		try {
			const durable = readDurableRoleRefs();
			durableRoles = durable.roles;
			durableCredentials = durable.credentials;
		} catch {
			issues.push("ROLE_STORE_UNREADABLE");
		}
		for (const roleRef of durableRoles)
			if (!durableCredentials.has(roleRef))
				issues.push(`ROLE_WITHOUT_CREDENTIAL:${roleRef}`);
		for (const roleRef of durableCredentials)
			if (!durableRoles.has(roleRef))
				issues.push(`CREDENTIAL_WITHOUT_ROLE:${roleRef}`);
		issues.sort();
		return {
			status: issues.length === 0 ? ("PASS" as const) : ("FAIL" as const),
			issues,
		};
	};
	return Object.freeze({
		doctorRoleStore,
		listRegisteredRoles: () =>
			[...roles.values()].sort((left, right) =>
				left.agentPackageRef.localeCompare(right.agentPackageRef),
			),
		getRegisteredRole(roleRef: string) {
			const role = roles.get(roleRef);
			if (!role) throw new AgentRuntimeError("ROLE_NOT_FOUND");
			return role;
		},
		async registerRole(raw: unknown) {
			const input = roleRegistrationSchema.parse(raw);
			if (
				roles.has(input.roleRef) ||
				[...roles.values()].some(
					(role) => role.agentPackageRef === input.agentPackageRef,
				)
			)
				throw new AgentRuntimeError("ROLE_ALREADY_REGISTERED");
			const credential = credentialFactory();
			const role: RegisteredRole = {
				...input,
				carrierType: "custom-gpt",
				registeredAt: now().toISOString(),
			};
			roles.set(role.roleRef, role);
			credentials.set(role.roleRef, credential);
			let credentialPersisted = false;
			try {
				await persistCredentials();
				credentialPersisted = true;
				await persistRoles();
			} catch (error) {
				roles.delete(role.roleRef);
				credentials.delete(role.roleRef);
				if (credentialPersisted) {
					// The durable credential file may already carry an orphan
					// entry; re-persist the rolled-back in-memory snapshot so the
					// two durable stores converge instead of silently diverging.
					try {
						await persistCredentials();
					} catch {
						throw new AgentRuntimeError(
							"ROLE_STORE_HALF_STATE",
							"Durable role/credential stores diverged after a failed registration.",
						);
					}
				}
				throw error;
			}
			return { role, credential };
		},
		async deleteRole(roleRef: string) {
			if (!roles.has(roleRef)) throw new AgentRuntimeError("ROLE_NOT_FOUND");
			if (await options.task.hasNonTerminalRoleUsage(roleRef))
				throw new AgentRuntimeError("ROLE_IN_USE");
			roles.delete(roleRef);
			credentials.delete(roleRef);
			try {
				await persistCredentials();
				await persistRoles();
			} catch (error) {
				// In-memory maps have already dropped the role; compensate both
				// durable files so the durable stores converge with memory.
				try {
					await persistCredentials();
					await persistRoles();
				} catch {
					throw new AgentRuntimeError(
						"ROLE_STORE_HALF_STATE",
						"Durable role/credential stores diverged after a failed deletion.",
					);
				}
				throw error;
			}
		},
		async showCredential(roleRef: string) {
			const credential = credentials.get(roleRef);
			if (!credential) throw new AgentRuntimeError("CREDENTIAL_NOT_FOUND");
			return { roleRef, credential };
		},
		async rotateCredential(roleRef: string) {
			if (!roles.has(roleRef)) throw new AgentRuntimeError("ROLE_NOT_FOUND");
			const credential = credentialFactory();
			// Durable credential truth is published first. The in-memory cache is
			// updated only after the atomic file replacement succeeds, so a failed
			// rotation never exposes a credential that is not durable.
			const candidate = new Map(credentials);
			candidate.set(roleRef, credential);
			await persistCredentialSnapshot(candidate);
			credentials.set(roleRef, credential);
			return { roleRef, credential };
		},
		async authenticateBearer(credential: string) {
			// Authentication uses the same durable authority read by agent-gateway.
			// This removes the cross-process split window during credential rotation.
			let durable: Record<string, unknown>;
			try {
				const parsed: unknown = JSON.parse(
					await readFile(credentialPath, "utf8"),
				);
				if (
					typeof parsed !== "object" ||
					parsed === null ||
					Array.isArray(parsed)
				)
					throw new Error("invalid credential store");
				durable = parsed as Record<string, unknown>;
			} catch {
				throw new AgentRuntimeError("AUTHENTICATION_FAILED");
			}
			const supplied = Buffer.from(credential);
			for (const [roleRef, stored] of Object.entries(durable)) {
				if (typeof stored !== "string") continue;
				const expected = Buffer.from(stored);
				if (
					supplied.length === expected.length &&
					timingSafeEqual(supplied, expected)
				)
					return roleRef;
			}
			throw new AgentRuntimeError("AUTHENTICATION_FAILED");
		},
		validateWorker,
		async askPeer(raw: unknown) {
			const input = askSchema.parse(raw);
			await validateWorker({
				authenticatedRoleRef: input.authenticatedRoleRef,
				taskId: input.taskId,
				workerRef: input.fromWorkerRef,
			});
			const task = await options.task.getTask(input.taskId);
			const targetRole = findRoleForPackage(input.targetAgentPackageRef);
			const target = task.roleBindings.find(
				(binding) => binding.roleRef === targetRole.roleRef,
			);
			if (!target?.workerRef)
				throw new AgentRuntimeError("TARGET_WORKER_NOT_BOUND");
			const idempotencyRef = `${input.authenticatedRoleRef}:askPeer:${input.idempotencyKey}`;
			database.exec("BEGIN IMMEDIATE");
			try {
				const existing = replay<{
					thread: CollaborationThread;
					message: CollaborationMessage;
				}>(idempotencyRef, "askPeer", input);
				if (existing) {
					database.exec("COMMIT");
					return existing;
				}
				const timestamp = now().toISOString();
				const threadId = input.threadId ?? idFactory();
				if (input.threadId) {
					const existingThread = getThread(threadId);
					const current = existingThread.value;
					if (current.taskId !== input.taskId)
						throw new AgentRuntimeError("THREAD_TASK_MISMATCH");
					const participants = [
						{
							roleRef: String(existingThread.row.participant_a_role_ref),
							workerRef: String(existingThread.row.participant_a_worker_ref),
						},
						{
							roleRef: String(existingThread.row.participant_b_role_ref),
							workerRef: String(existingThread.row.participant_b_worker_ref),
						},
					] as const;
					const senderIndex = participants.findIndex(
						(participant) =>
							participant.roleRef === input.authenticatedRoleRef &&
							participant.workerRef === input.fromWorkerRef,
					);
					if (senderIndex < 0)
						throw new AgentRuntimeError("THREAD_PARTICIPANT_MISMATCH");
					const expectedTarget = participants[senderIndex === 0 ? 1 : 0];
					if (
						targetRole.roleRef !== expectedTarget.roleRef ||
						target.workerRef !== expectedTarget.workerRef
					)
						throw new AgentRuntimeError("THREAD_TARGET_MISMATCH");
					if (current.state === "OPEN_REPLY_PENDING_DELIVERY")
						throw new AgentRuntimeError("THREAD_REPLY_NOT_DELIVERED");
					if (current.state !== "OPEN_CAN_ASK")
						throw new AgentRuntimeError("THREAD_AWAITING_REPLY");
					const changed = database
						.prepare(
							"UPDATE collaboration_threads SET state='OPEN_AWAITING_REPLY', last_question_message_id=?, version=version+1, updated_at=? WHERE thread_id=? AND version=? AND state='OPEN_CAN_ASK'",
						)
						.run("pending", timestamp, threadId, current.version);
					if (changed.changes !== 1)
						throw new AgentRuntimeError("COLLABORATION_VERSION_CONFLICT");
				} else {
					database
						.prepare(
							"INSERT INTO collaboration_threads VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
						)
						.run(
							threadId,
							AGENT_CONTRACT_VERSION,
							input.taskId,
							input.authenticatedRoleRef,
							input.fromWorkerRef,
							targetRole.roleRef,
							target.workerRef,
							"OPEN_AWAITING_REPLY",
							null,
							null,
							1,
							timestamp,
							timestamp,
						);
				}
				const messageId = idFactory();
				database
					.prepare(
						"INSERT INTO collaboration_messages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
					)
					.run(
						messageId,
						AGENT_CONTRACT_VERSION,
						threadId,
						input.taskId,
						"QUESTION",
						input.authenticatedRoleRef,
						input.fromWorkerRef,
						targetRole.roleRef,
						target.workerRef,
						null,
						input.content,
						"PENDING",
						0,
						null,
						null,
						null,
						1,
						timestamp,
						null,
						timestamp,
					);
				database
					.prepare(
						"UPDATE collaboration_threads SET last_question_message_id=?, updated_at=? WHERE thread_id=?",
					)
					.run(messageId, timestamp, threadId);
				const response = {
					thread: getThread(threadId).value,
					message: getMessage(messageId),
				};
				saveReplay(idempotencyRef, "askPeer", input, response);
				database.exec("COMMIT");
				return response;
			} catch (error) {
				database.exec("ROLLBACK");
				throw error;
			}
		},
		async replyPeer(raw: unknown) {
			const input = replySchema.parse(raw);
			const initial = getThread(input.threadId).value;
			await validateWorker({
				authenticatedRoleRef: input.authenticatedRoleRef,
				taskId: initial.taskId,
				workerRef: input.fromWorkerRef,
			});
			const idempotencyRef = `${input.authenticatedRoleRef}:replyPeer:${input.idempotencyKey}`;
			database.exec("BEGIN IMMEDIATE");
			try {
				const existing = replay<{
					thread: CollaborationThread;
					message: CollaborationMessage;
				}>(idempotencyRef, "replyPeer", input);
				if (existing) {
					database.exec("COMMIT");
					return existing;
				}
				const current = getThread(input.threadId).value;
				if (
					current.state !== "OPEN_AWAITING_REPLY" ||
					!current.lastQuestionMessageId
				)
					throw new AgentRuntimeError("THREAD_NOT_AWAITING_REPLY");
				const question = getMessage(current.lastQuestionMessageId);
				if (
					question.targetRoleRef !== input.authenticatedRoleRef ||
					question.targetWorkerRef !== input.fromWorkerRef
				)
					throw new AgentRuntimeError("REPLY_IDENTITY_INVALID");
				const timestamp = now().toISOString();
				const messageId = idFactory();
				database
					.prepare(
						"INSERT INTO collaboration_messages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
					)
					.run(
						messageId,
						AGENT_CONTRACT_VERSION,
						current.threadId,
						current.taskId,
						"REPLY",
						input.authenticatedRoleRef,
						input.fromWorkerRef,
						question.fromRoleRef,
						question.fromWorkerRef,
						question.messageId,
						input.content,
						"PENDING",
						0,
						null,
						null,
						null,
						1,
						timestamp,
						null,
						timestamp,
					);
				const changed = database
					.prepare(
						"UPDATE collaboration_threads SET state='OPEN_REPLY_PENDING_DELIVERY', last_reply_message_id=?, version=version+1, updated_at=? WHERE thread_id=? AND version=? AND state='OPEN_AWAITING_REPLY'",
					)
					.run(messageId, timestamp, current.threadId, current.version);
				if (changed.changes !== 1)
					throw new AgentRuntimeError("COLLABORATION_VERSION_CONFLICT");
				const response = {
					thread: getThread(current.threadId).value,
					message: getMessage(messageId),
				};
				saveReplay(idempotencyRef, "replyPeer", input, response);
				database.exec("COMMIT");
				return response;
			} catch (error) {
				database.exec("ROLLBACK");
				throw error;
			}
		},
		async listPendingCollaborationMessages(raw: unknown) {
			const input = z
				.object({ limit: z.number().int().positive().max(100) })
				.strict()
				.parse(raw);
			const result: CollaborationMessage[] = [];
			const pageSize = input.limit;
			let cursor: { createdAt: string; messageId: string } | undefined;
			while (result.length < input.limit) {
				const rows =
					cursor === undefined
						? (database
								.prepare(
									"SELECT * FROM collaboration_messages WHERE status='PENDING' ORDER BY created_at, message_id LIMIT ?",
								)
								.all(pageSize) as MessageRow[])
						: (database
								.prepare(
									"SELECT * FROM collaboration_messages WHERE status='PENDING' AND (created_at > ? OR (created_at = ? AND message_id > ?)) ORDER BY created_at, message_id LIMIT ?",
								)
								.all(
									cursor.createdAt,
									cursor.createdAt,
									cursor.messageId,
									pageSize,
								) as MessageRow[]);
				if (rows.length === 0) break;
				for (const row of rows) {
					const message = messageFromRow(row);
					if (!terminal(await options.task.getTask(message.taskId)))
						result.push(message);
				}
				const last = rows[rows.length - 1];
				if (!last) break;
				cursor = {
					createdAt: String(last.created_at),
					messageId: String(last.message_id),
				};
				if (rows.length < pageSize) break;
			}
			return result;
		},
		getCollaborationMessage(raw: unknown) {
			const input = z.object({ messageId: identifier }).strict().parse(raw);
			return getMessage(input.messageId);
		},
		async reportCollaborationDelivery(raw: unknown) {
			const input = deliverySchema.parse(raw);
			const message = getMessage(input.messageId);
			if (
				message.targetRoleRef !== input.observedRoleRef ||
				message.targetWorkerRef !== input.observedWorkerRef
			)
				throw new AgentRuntimeError("DELIVERY_TARGET_MISMATCH");
			if (message.status === "DELIVERED") return message;
			if (message.version !== input.expectedMessageVersion)
				throw new AgentRuntimeError("COLLABORATION_VERSION_CONFLICT");
			if (terminal(await options.task.getTask(message.taskId)))
				throw new AgentRuntimeError("TASK_TERMINAL");
			database.exec("BEGIN IMMEDIATE");
			try {
				const timestamp = now().toISOString();
				if (input.outcome === "DELIVERED") {
					const changed = database
						.prepare(
							"UPDATE collaboration_messages SET status='DELIVERED', delivery_attempt_count=delivery_attempt_count+1, execution_ref=?, evidence_ref=?, delivered_at=?, updated_at=?, version=version+1 WHERE message_id=? AND version=? AND status='PENDING'",
						)
						.run(
							input.executionRef ?? null,
							input.evidenceRef ?? null,
							timestamp,
							timestamp,
							message.messageId,
							message.version,
						);
					if (changed.changes !== 1)
						throw new AgentRuntimeError("COLLABORATION_VERSION_CONFLICT");
					if (message.kind === "REPLY") {
						const changed = database
							.prepare(
								"UPDATE collaboration_threads SET state='OPEN_CAN_ASK', version=version+1, updated_at=? WHERE thread_id=? AND state='OPEN_REPLY_PENDING_DELIVERY' AND last_reply_message_id=?",
							)
							.run(timestamp, message.threadId, message.messageId);
						if (changed.changes !== 1)
							throw new AgentRuntimeError("COLLABORATION_VERSION_CONFLICT");
					}
				} else {
					const changed = database
						.prepare(
							"UPDATE collaboration_messages SET delivery_attempt_count=delivery_attempt_count+1, last_delivery_error_code=?, execution_ref=?, evidence_ref=?, updated_at=?, version=version+1 WHERE message_id=? AND version=? AND status='PENDING'",
						)
						.run(
							input.errorCode ?? input.outcome,
							input.executionRef ?? null,
							input.evidenceRef ?? null,
							timestamp,
							message.messageId,
							message.version,
						);
					if (changed.changes !== 1)
						throw new AgentRuntimeError("COLLABORATION_VERSION_CONFLICT");
				}
				database.exec("COMMIT");
				return getMessage(message.messageId);
			} catch (error) {
				database.exec("ROLLBACK");
				throw error;
			}
		},
		close() {
			database.close();
		},
		databasePath,
		registryPath,
		credentialPath,
	});
}
