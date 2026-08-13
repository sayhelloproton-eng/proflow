#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

import { createAgentRuntime } from "@tomflow/proflow-agent-runtime";
import {
	createBrowserRealityBridgeServer,
	createExecutionBrowserExtension,
} from "@tomflow/proflow-execution-browser-extension";
import { createLocalExecutor } from "@tomflow/proflow-execution-local";
import { createExecutionRuntime } from "@tomflow/proflow-execution-runtime";
import { applyMigrations } from "@tomflow/proflow-task-migration-runner";
import { createTaskServices } from "@tomflow/proflow-task-orchestration";
import { SqliteTaskStore } from "@tomflow/proflow-task-store-sqlite";
import { taskMigrations } from "@tomflow/proflow-task-store-sqlite/migrations";
import { createAgentGateway } from "../src/index.ts";

type RolePackageRef =
	| "@tomflow/proflow-agent-product"
	| "@tomflow/proflow-agent-controller-dev"
	| "@tomflow/proflow-agent-test-ops";
type HarnessConfig = {
	stateRoot: string;
	projectRoot: string;
	publicGatewayUrl: string;
	extensionId: string;
	gatewayPort: number;
	bridgePort: number;
	roles: Array<{
		agentPackageRef: RolePackageRef;
		roleRef: string;
		carrierUrl: string;
	}>;
};

const rolePackages = new Set<RolePackageRef>([
	"@tomflow/proflow-agent-product",
	"@tomflow/proflow-agent-controller-dev",
	"@tomflow/proflow-agent-test-ops",
]);
const allowedOperations: Record<RolePackageRef, ReadonlySet<string>> = {
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
		"askPeer",
		"replyPeer",
		"executeCapability",
		"getExecution",
		"readExecutionOutput",
	]),
};

function record(value: unknown, name: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new TypeError(`${name} must be an object`);
	return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError(`${name} must be a non-empty string`);
	return value;
}

function port(value: unknown, name: string): number {
	if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 65_535)
		throw new TypeError(`${name} must be a TCP port`);
	return Number(value);
}

function parseConfig(raw: unknown): HarnessConfig {
	const input = record(raw, "config");
	const stateRoot = resolve(text(input.stateRoot, "stateRoot"));
	const projectRoot = resolve(text(input.projectRoot, "projectRoot"));
	const publicGatewayUrl = text(
		input.publicGatewayUrl,
		"publicGatewayUrl",
	).replace(/\/$/, "");
	const publicUrl = new URL(publicGatewayUrl);
	if (publicUrl.protocol !== "https:" || publicUrl.port !== "")
		throw new TypeError("publicGatewayUrl must be public HTTPS on port 443");
	if (!isAbsolute(stateRoot) || basename(stateRoot) !== ".proflow")
		throw new TypeError("stateRoot must be an absolute .proflow directory");
	const extensionId = text(input.extensionId, "extensionId");
	if (!/^[a-z]{32}$/.test(extensionId))
		throw new TypeError(
			"extensionId must be a canonical Chromium extension id",
		);
	if (!Array.isArray(input.roles) || input.roles.length !== 3)
		throw new TypeError("exactly three real role registrations are required");
	const roles = input.roles.map((rawRole) => {
		const role = record(rawRole, "role");
		const agentPackageRef = text(
			role.agentPackageRef,
			"agentPackageRef",
		) as RolePackageRef;
		if (!rolePackages.has(agentPackageRef))
			throw new TypeError("unknown Agent Package ref");
		const roleRef = text(role.roleRef, "roleRef");
		const carrierUrl = text(role.carrierUrl, "carrierUrl");
		if (carrierUrl !== `https://chatgpt.com/g/${roleRef}`)
			throw new TypeError("carrierUrl must exactly match its real roleRef");
		return { agentPackageRef, roleRef, carrierUrl };
	});
	if (new Set(roles.map((role) => role.agentPackageRef)).size !== 3)
		throw new TypeError("Agent Package registrations must be unique");
	if (new Set(roles.map((role) => role.roleRef)).size !== 3)
		throw new TypeError("roleRef registrations must be unique");
	return {
		stateRoot,
		projectRoot,
		publicGatewayUrl,
		extensionId,
		gatewayPort: port(input.gatewayPort, "gatewayPort"),
		bridgePort: port(input.bridgePort, "bridgePort"),
		roles,
	};
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

const args = process.argv.slice(2);
if (args[0] !== "start" || args[1] !== "--config" || !args[2])
	throw new Error(
		"Usage: node real-carrier-harness.ts start --config /absolute/config.json",
	);
const config = parseConfig(
	JSON.parse(await readFile(resolve(args[2]), "utf8")),
);
await mkdir(config.stateRoot, { recursive: true, mode: 0o700 });

const taskDatabasePath = join(config.stateRoot, "state", "task.sqlite");
const migration = applyMigrations({
	databasePath: taskDatabasePath,
	migrations: taskMigrations,
});
if (!migration.ok)
	throw new Error(`TASK_MIGRATION_FAILED:${migration.error?.message}`);
const taskStore = new SqliteTaskStore({ databasePath: taskDatabasePath });
const task = createTaskServices({
	store: taskStore,
	workspaceRoot: config.projectRoot,
});

const taskFacts = (taskId: string) => {
	const view = unwrap(task.queries.getTask({ taskId }));
	return {
		taskId: view.taskId,
		status: view.status,
		roleBindings: view.roleBindings,
	};
};

const agent = await createAgentRuntime({
	proflowRoot: config.stateRoot,
	task: {
		async getTask(taskId) {
			return taskFacts(taskId);
		},
		async hasNonTerminalRoleUsage(roleRef) {
			const summaries = unwrap(task.queries.listTasks({})).tasks;
			return summaries.some((summary) => {
				const view = taskFacts(summary.taskId);
				return (
					view.status !== "SUCCEEDED" &&
					view.status !== "TERMINATED" &&
					view.roleBindings.some((binding) => binding.roleRef === roleRef)
				);
			});
		},
	},
});

for (const role of config.roles) {
	const existing = agent
		.listRegisteredRoles()
		.find((item) => item.agentPackageRef === role.agentPackageRef);
	if (existing) {
		if (
			existing.roleRef !== role.roleRef ||
			existing.carrierUrl !== role.carrierUrl ||
			existing.registeredPackageVersion !== "0.1.0"
		)
			throw new Error(`ROLE_REGISTRATION_DRIFT:${role.agentPackageRef}`);
	} else
		await agent.registerRole({
			agentPackageRef: role.agentPackageRef,
			registeredPackageVersion: "0.1.0",
			roleRef: role.roleRef,
			carrierUrl: role.carrierUrl,
		});
}
if (agent.doctorRoleStore().status !== "PASS")
	throw new Error("ROLE_STORE_NOT_READY");

const bridgeTokenPath = join(
	config.stateRoot,
	"execution",
	"browser-bridge.token",
);
await mkdir(join(config.stateRoot, "execution"), {
	recursive: true,
	mode: 0o700,
});
if (!existsSync(bridgeTokenPath))
	await writeFile(bridgeTokenPath, randomBytes(32).toString("base64url"), {
		mode: 0o600,
	});
const bridgeToken = (await readFile(bridgeTokenPath, "utf8")).trim();
const bridge = await createBrowserRealityBridgeServer({
	token: bridgeToken,
	extensionId: config.extensionId,
	port: config.bridgePort,
});

const browserExecutor = createExecutionBrowserExtension({
	browser: bridge.browser,
	task: {
		async getWorkerBinding(taskId, roleRef) {
			return (
				taskFacts(taskId).roleBindings.find(
					(binding) => binding.roleRef === roleRef,
				)?.workerRef ?? null
			);
		},
		async bindWorker(input) {
			unwrap(
				task.commands.bindTaskWorker({
					...input,
					expectedTaskVersion: unwrap(
						task.queries.getTask({ taskId: input.taskId }),
					).version,
					actorRef: "execution-browser",
					idempotencyKey: `browser-bind:${input.taskId}:${input.roleRef}:${input.workerRef}`,
				}),
			);
		},
	},
	agent: {
		async getPendingMessage(messageRef) {
			const message = (
				await agent.listPendingCollaborationMessages({ limit: 100 })
			).find((item) => item.messageId === messageRef);
			if (!message) throw new Error("PENDING_COLLABORATION_NOT_FOUND");
			return { ...message, status: "PENDING" as const };
		},
		async reportPhysicalDelivery(messageRef, evidenceRef) {
			const message = (
				await agent.listPendingCollaborationMessages({ limit: 100 })
			).find((item) => item.messageId === messageRef);
			if (!message) return;
			await agent.reportCollaborationDelivery({
				messageId: message.messageId,
				expectedMessageVersion: message.version,
				outcome: "DELIVERED",
				observedRoleRef: message.targetRoleRef,
				observedWorkerRef: message.targetWorkerRef,
				evidenceRef,
			});
		},
	},
});

const localExecutor = await createLocalExecutor({
	projectRoot: config.projectRoot,
	artifactRoot: join(config.stateRoot, "execution", "artifacts"),
});
const execution = await createExecutionRuntime({
	databasePath: join(config.stateRoot, "execution", "execution.sqlite"),
	localExecutor,
	browserExecutor,
});

const taskCommands: Record<string, (input: unknown) => unknown> = {
	createTask: task.commands.createTask,
	startNode: task.commands.startNode,
	completeNode: task.commands.completeNode,
	waitNode: task.commands.waitNode,
	failNode: task.commands.failNode,
	reopenNode: task.commands.reopenNode,
};
const taskQueries: Record<string, (input: unknown) => unknown> = {
	getTask: task.queries.getTask,
	getNodeContext: task.queries.getNodeContext,
	getTaskDocument: task.documents.getTaskDocument,
};

const gateway = await createAgentGateway({
	host: "127.0.0.1",
	port: config.gatewayPort,
	relayBaseUrl: `${config.publicGatewayUrl}/relay/`,
	owners: {
		authenticateBearer: agent.authenticateBearer,
		async route(operationId, authenticatedRoleRef, rawInput) {
			const role = agent.getRegisteredRole(authenticatedRoleRef);
			if (
				!allowedOperations[role.agentPackageRef as RolePackageRef]?.has(
					operationId,
				)
			)
				throw Object.assign(new Error("ROLE_OPERATION_DENIED"), {
					httpStatus: 403,
				});
			const input = record(rawInput, "action input");
			if (operationId === "listRegisteredRoles")
				return agent.listRegisteredRoles();
			if (operationId === "getRegisteredRole")
				return agent.getRegisteredRole(text(input.roleRef, "roleRef"));
			if (operationId === "askPeer")
				return agent.askPeer({ ...input, authenticatedRoleRef });
			if (operationId === "replyPeer")
				return agent.replyPeer({ ...input, authenticatedRoleRef });
			if (operationId === "putTaskDocument")
				return task.documents.putTaskDocument({
					...input,
					actorRef: authenticatedRoleRef,
				});
			const command = taskCommands[operationId];
			if (command) return command({ ...input, actorRef: authenticatedRoleRef });
			const query = taskQueries[operationId];
			if (query) return query(input);
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
				const executionRecord = await execution.executeCapability({
					...input,
					callerRef: authenticatedRoleRef,
					roleRef: authenticatedRoleRef,
				});
				if (executionRecord.result?.capability === "collaboration.deliver")
					await browserExecutor.finalizeCollaborationDelivery(executionRecord);
				return executionRecord;
			}
			if (operationId === "getExecution")
				return execution.getExecution(text(input.executionRef, "executionRef"));
			if (operationId === "readExecutionOutput")
				return execution.readExecutionOutput(input);
			throw new Error("OPERATION_NOT_ROUTED");
		},
		async lookupResult(operationId, authenticatedRoleRef, rawInput) {
			const input = record(rawInput, "lookup input");
			if (operationId === "executeCapability" && input.executionRef)
				return execution.getExecution(input.executionRef);
			return this.route(operationId, authenticatedRoleRef, input);
		},
		async readiness() {
			return {
				credentialStore: agent.doctorRoleStore().status === "PASS",
				agent: true,
				task: true,
				execution: true,
				browserCarrier: bridge.status().online,
				relay: true,
			};
		},
	},
});
const gatewayAddress = await gateway.start();
const statePath = join(config.stateRoot, "real-carrier-state.json");
await writeFile(
	statePath,
	`${JSON.stringify(
		{
			pid: process.pid,
			status: "RUNNING",
			publicGatewayUrl: config.publicGatewayUrl,
			localGatewayUrl: `http://${gatewayAddress.host}:${gatewayAddress.port}`,
			bridgeEndpoint: bridge.endpoint,
			extensionId: config.extensionId,
			roleRefs: agent.listRegisteredRoles().map((role) => role.roleRef),
			credentialPath: agent.credentialPath,
			bridgeTokenPath,
		},
		null,
		2,
	)}\n`,
	{ mode: 0o600 },
);
process.stdout.write(
	`${JSON.stringify({ status: "RUNNING", statePath, publicGatewayUrl: config.publicGatewayUrl, localGatewayUrl: `http://${gatewayAddress.host}:${gatewayAddress.port}`, bridgeEndpoint: bridge.endpoint })}\n`,
);

let stopping = false;
async function stop() {
	if (stopping) return;
	stopping = true;
	await gateway.stop();
	await bridge.close();
	execution.close();
	agent.close();
	taskStore.close();
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.on(signal, () => {
		void stop().finally(() => process.exit(0));
	});
await new Promise(() => {});
