#!/usr/bin/env node
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { basename, isAbsolute, join, resolve } from "node:path";

import { createAgentGatewayProcess } from "@tomflow/proflow-agent-gateway/process";
import {
	createBrowserRealityBridgeServer,
	createExecutionBrowserExtension,
	createExecutionBrowserTaskDriver,
} from "@tomflow/proflow-execution-browser-extension";
import { executionInputFingerprint } from "@tomflow/proflow-execution-runtime";
import { createExecutionRuntimeProcess } from "@tomflow/proflow-execution-runtime/service";
import {
	createModelRuntimeProcess,
	loadModelRuntimeProcessConfig,
} from "@tomflow/proflow-model-runtime/process";
import { systemHealthAssessmentSpec } from "@tomflow/proflow-model-runtime/specs/system-health-assessment";
import { z } from "zod";
import { createPlatformHost, parsePlatformHostConfig } from "../src/index.ts";

const rolePackageRefs = [
	"@tomflow/proflow-agent-product",
	"@tomflow/proflow-agent-controller-dev",
	"@tomflow/proflow-agent-test-ops",
] as const;
const port = z.number().int().min(1).max(65_535);
const harnessConfigSchema = z
	.object({
		stateRoot: z.string().min(1),
		projectRoot: z.string().min(1),
		publicGatewayUrl: z.url(),
		extensionId: z.string().regex(/^[a-z]{32}$/),
		modelConfigPath: z.string().min(1),
		approvalFile: z.string().min(1),
		ports: z
			.object({
				model: port,
				execution: port,
				host: port,
				gateway: port,
				bridge: port,
				control: port,
			})
			.strict(),
		roles: z
			.array(
				z
					.object({
						agentPackageRef: z.enum(rolePackageRefs),
						registeredPackageVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
						roleRef: z.string().regex(/^g-[A-Za-z0-9_-]+$/),
						carrierUrl: z.url(),
					})
					.strict(),
			)
			.length(3),
	})
	.strict()
	.superRefine((value, context) => {
		const publicUrl = new URL(value.publicGatewayUrl);
		if (publicUrl.protocol !== "https:" || publicUrl.port !== "")
			context.addIssue({
				code: "custom",
				path: ["publicGatewayUrl"],
				message: "publicGatewayUrl must be HTTPS on the default port",
			});
		if (
			!isAbsolute(value.stateRoot) ||
			basename(value.stateRoot) !== ".proflow"
		)
			context.addIssue({
				code: "custom",
				path: ["stateRoot"],
				message: "stateRoot must be an absolute .proflow directory",
			});
		for (const key of [
			"projectRoot",
			"modelConfigPath",
			"approvalFile",
		] as const)
			if (!isAbsolute(value[key]))
				context.addIssue({
					code: "custom",
					path: [key],
					message: `${key} must be absolute`,
				});
		if (new Set(Object.values(value.ports)).size !== 6)
			context.addIssue({
				code: "custom",
				path: ["ports"],
				message: "all six runtime and control ports must be distinct",
			});
		if (new Set(value.roles.map((role) => role.agentPackageRef)).size !== 3)
			context.addIssue({
				code: "custom",
				path: ["roles"],
				message: "exactly one registration per Agent Package is required",
			});
		if (new Set(value.roles.map((role) => role.roleRef)).size !== 3)
			context.addIssue({
				code: "custom",
				path: ["roles"],
				message: "real roleRef registrations must be unique",
			});
		for (const role of value.roles)
			if (role.carrierUrl !== `https://chatgpt.com/g/${role.roleRef}`)
				context.addIssue({
					code: "custom",
					path: ["roles"],
					message: "carrierUrl must exactly bind its real roleRef",
				});
	})
	.transform((value) => ({
		...value,
		stateRoot: resolve(value.stateRoot),
		projectRoot: resolve(value.projectRoot),
		modelConfigPath: resolve(value.modelConfigPath),
		approvalFile: resolve(value.approvalFile),
		publicGatewayUrl: value.publicGatewayUrl.replace(/\/$/, ""),
	}));

const approvalLedgerSchema = z
	.object({
		contract: z.literal("proflow.execution.operator-approval-ledger.v1"),
		approvals: z.array(
			z
				.object({
					approvalRef: z.string().min(1),
					status: z.literal("APPROVED"),
					callerRef: z.string().min(1),
					capability: z.string().min(1),
					inputFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
					approvedByRef: z.string().regex(/^human:[A-Za-z0-9._:-]+$/),
					approvedAt: z.iso.datetime(),
					expiresAt: z.iso.datetime(),
				})
				.strict(),
		),
	})
	.strict();

async function loadConfig(path: string) {
	return harnessConfigSchema.parse(
		JSON.parse(await readFile(resolve(path), "utf8")),
	);
}

async function approvalLedger(path: string) {
	if (!existsSync(path)) return null;
	const metadata = await stat(path);
	if ((metadata.mode & 0o077) !== 0)
		throw new Error("APPROVAL_FILE_PERMISSIONS_MUST_BE_0600");
	return approvalLedgerSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

function log(entry: Record<string, unknown>) {
	process.stderr.write(`${JSON.stringify(entry)}\n`);
}

const [command, ...args] = process.argv.slice(2);
if (command === "fingerprint") {
	if (args[0] !== "--request" || !args[1])
		throw new Error(
			"Usage: real-carrier-e2e-harness.ts fingerprint --request /absolute/request.json",
		);
	const request = JSON.parse(await readFile(resolve(args[1]), "utf8"));
	process.stdout.write(
		`${JSON.stringify({ inputFingerprint: executionInputFingerprint(request) })}\n`,
	);
	process.exit(0);
}
if (command !== "start" || args[0] !== "--config" || !args[1])
	throw new Error(
		"Usage: real-carrier-e2e-harness.ts start --config /absolute/config.json",
	);

const config = await loadConfig(args[1]);
await mkdir(config.stateRoot, { recursive: true, mode: 0o700 });
await mkdir(join(config.stateRoot, "execution"), {
	recursive: true,
	mode: 0o700,
});
const bridgeTokenPath = join(
	config.stateRoot,
	"execution",
	"browser-bridge.token",
);
if (!existsSync(bridgeTokenPath))
	await writeFile(bridgeTokenPath, randomBytes(32).toString("base64url"), {
		mode: 0o600,
	});
const bridgeToken = (await readFile(bridgeTokenPath, "utf8")).trim();
const executionTokenPath = join(
	config.stateRoot,
	"execution",
	"execution-service.token",
);
if (!existsSync(executionTokenPath))
	await writeFile(executionTokenPath, randomBytes(32).toString("base64url"), {
		mode: 0o600,
	});
const executionToken = (await readFile(executionTokenPath, "utf8")).trim();
const controlTokenPath = join(
	config.stateRoot,
	"execution",
	"real-carrier-control.token",
);
if (!existsSync(controlTokenPath))
	await writeFile(controlTokenPath, randomBytes(32).toString("base64url"), {
		mode: 0o600,
	});
const controlToken = (await readFile(controlTokenPath, "utf8")).trim();

const modelConfiguration = await loadModelRuntimeProcessConfig(
	config.modelConfigPath,
);
const model = await createModelRuntimeProcess({
	config: {
		...modelConfiguration,
		host: "127.0.0.1",
		port: config.ports.model,
	},
	log,
});
const host = createPlatformHost({
	config: parsePlatformHostConfig({
		stateRoot: config.stateRoot,
		workspaceRoot: config.projectRoot,
		host: "127.0.0.1",
		port: config.ports.host,
		executionBaseUrl: `http://127.0.0.1:${config.ports.execution}`,
		modelBaseUrl: `http://127.0.0.1:${config.ports.model}`,
		roles: config.roles,
	}),
	executionCredential: executionToken,
	log,
});
const bridge = await createBrowserRealityBridgeServer({
	token: bridgeToken,
	extensionId: config.extensionId,
	port: config.ports.bridge,
});
const browserExecutor = createExecutionBrowserExtension({
	browser: bridge.browser,
	...host.browserOwnerPorts,
});
const execution = await createExecutionRuntimeProcess({
	config: {
		databasePath: join(config.stateRoot, "execution", "execution.sqlite"),
		projectRoot: config.projectRoot,
		artifactRoot: join(config.stateRoot, "execution", "artifacts"),
		host: "127.0.0.1",
		port: config.ports.execution,
		exactNetworkTargets: [],
	},
	browserExecutor,
	identity: host.executionIdentity,
	transportCredential: executionToken,
	modelDecision: {
		async decide() {
			const response = await fetch(
				`http://127.0.0.1:${config.ports.model}/infer`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						contractVersion: "1.0.0",
						specRef: systemHealthAssessmentSpec.specRef,
						mode: "fast",
						priority: "business",
						trace: { callerRef: "execution-runtime:admission" },
						payload: {
							service: "execution-runtime",
							checks: [{ name: "operator-policy", state: "PASS" }],
						},
					}),
					signal: AbortSignal.timeout(30_000),
				},
			);
			if (!response.ok)
				return {
					decision: "DENY" as const,
					decisionPath: "fast" as const,
					reason: "MODEL_RUNTIME_UNAVAILABLE",
				};
			const inference = (await response.json()) as {
				status?: string;
				data?: { decision?: string };
			};
			return inference.status === "SUCCEEDED" &&
				inference.data?.decision === "HEALTHY"
				? { decision: "ALLOW" as const, decisionPath: "fast" as const }
				: {
						decision: "DENY" as const,
						decisionPath: "fast" as const,
						reason: "MODEL_DECISION_NOT_HEALTHY",
					};
		},
	},
	approval: {
		async validate(input) {
			const ledger = await approvalLedger(config.approvalFile);
			if (!ledger) return false;
			const approval = ledger.approvals.find(
				(candidate) => candidate.approvalRef === input.approvalRef,
			);
			if (!approval) return false;
			const now = Date.parse(input.now);
			return (
				approval.status === "APPROVED" &&
				approval.callerRef === input.callerRef &&
				approval.capability === input.capability &&
				approval.inputFingerprint === input.inputFingerprint &&
				Date.parse(approval.approvedAt) <= now &&
				now < Date.parse(approval.expiresAt)
			);
		},
	},
	log,
}).catch(async (error) => {
	await bridge.close();
	await model.stop();
	throw error;
});
const executeThroughOwner = async (request: unknown) => {
	const response = await fetch(
		`http://127.0.0.1:${config.ports.execution}/executions`,
		{
			method: "POST",
			headers: {
				authorization: `Bearer ${executionToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(request),
		},
	);
	if (!response.ok) throw new Error("EXECUTION_OWNER_UNAVAILABLE");
	return response.json();
};
const taskDriver = createExecutionBrowserTaskDriver({
	task: host.taskDriverPorts,
	identity: host.agentIdentityPorts,
	execution: { executeCapability: executeThroughOwner },
	roleUrl(roleRef) {
		const registration = config.roles.find(
			(candidate) => candidate.roleRef === roleRef,
		);
		if (!registration) throw new Error("ROLE_NOT_REGISTERED");
		return registration.carrierUrl;
	},
});

let gateway: Awaited<ReturnType<typeof createAgentGatewayProcess>> | undefined;
let control: Server | undefined;
let stopping = false;
async function stop() {
	if (stopping) return;
	stopping = true;
	if (control)
		await new Promise<void>((resolveStop, reject) =>
			control?.close((error) => (error ? reject(error) : resolveStop())),
		);
	await gateway?.stop();
	await host.stop();
	await execution.stop();
	await model.stop();
	await bridge.close();
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.on(signal, () => {
		void stop().finally(() => process.exit(0));
	});

try {
	await model.start();
	await execution.start();
	await host.start();
	const credentialFile = join(
		config.stateRoot,
		"agent",
		"secrets",
		"role-credentials.json",
	);
	gateway = await createAgentGatewayProcess({
		config: {
			host: "127.0.0.1",
			port: config.ports.gateway,
			publicBaseUrl: config.publicGatewayUrl,
			downstreamBaseUrl: `http://127.0.0.1:${config.ports.host}`,
			credentialFile,
		},
		log,
	});
	await gateway.start();
	control = createServer(async (request, response) => {
		response.setHeader("content-type", "application/json; charset=utf-8");
		response.setHeader("cache-control", "no-store");
		if (request.headers.authorization !== `Bearer ${controlToken}`) {
			response.statusCode = 401;
			response.end(JSON.stringify({ error: "AUTHENTICATION_FAILED" }));
			return;
		}
		try {
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			if (request.method === "GET" && url.pathname === "/status") {
				const taskId = url.searchParams.get("taskId");
				response.end(
					JSON.stringify({
						bridge: bridge.status(),
						host: await host.status(),
						execution: execution.status(),
						gateway: gateway?.status(),
						...(taskId
							? { task: await host.taskDriverPorts.getTask(taskId) }
							: {}),
					}),
				);
				return;
			}
			if (request.method === "GET" && url.pathname === "/task/provision-plan") {
				const taskId = url.searchParams.get("taskId");
				if (!taskId) throw new Error("TASK_ID_REQUIRED");
				response.end(JSON.stringify(await taskDriver.planProvision(taskId)));
				return;
			}
			if (request.method === "GET" && url.pathname === "/node/wake-plan") {
				const taskId = url.searchParams.get("taskId");
				if (!taskId) throw new Error("TASK_ID_REQUIRED");
				response.end(JSON.stringify(await taskDriver.planNodeWake(taskId)));
				return;
			}
			if (request.method !== "POST") {
				response.statusCode = 404;
				response.end(JSON.stringify({ error: "NOT_FOUND" }));
				return;
			}
			let body = "";
			for await (const chunk of request) {
				body += String(chunk);
				if (body.length > 100_000) throw new Error("REQUEST_BODY_TOO_LARGE");
			}
			const input = JSON.parse(body);
			let output: unknown;
			if (url.pathname === "/task/authorize")
				output = await host.taskDriverPorts.authorizeTask(input);
			else if (url.pathname === "/task/start")
				output = await taskDriver.startTask(input.taskId);
			else if (url.pathname === "/node/start")
				output = await host.taskDriverPorts.startNode(input);
			else if (url.pathname === "/task/provision-apply")
				output = await taskDriver.applyProvision(input);
			else if (url.pathname === "/node/wake-apply")
				output = await taskDriver.applyNodeWake(input);
			else {
				response.statusCode = 404;
				response.end(JSON.stringify({ error: "NOT_FOUND" }));
				return;
			}
			response.end(JSON.stringify(output));
		} catch (error) {
			response.statusCode = 400;
			response.end(
				JSON.stringify({
					error: error instanceof Error ? error.message : "INVALID_REQUEST",
				}),
			);
		}
	});
	await new Promise<void>((resolveStart, reject) => {
		control?.once("error", reject);
		control?.listen(config.ports.control, "127.0.0.1", resolveStart);
	});
	const statePath = join(config.stateRoot, "real-carrier-state.json");
	await writeFile(
		statePath,
		`${JSON.stringify(
			{
				contract: "proflow.real-carrier-runtime-state.v1",
				runRef: `real-carrier:${randomUUID()}`,
				pid: process.pid,
				status: "RUNNING",
				publicGatewayUrl: config.publicGatewayUrl,
				localGatewayUrl: `http://127.0.0.1:${config.ports.gateway}`,
				hostUrl: `http://127.0.0.1:${config.ports.host}`,
				executionUrl: `http://127.0.0.1:${config.ports.execution}`,
				executionTokenPath,
				modelUrl: `http://127.0.0.1:${config.ports.model}`,
				bridgeEndpoint: bridge.endpoint,
				bridgeTokenPath,
				controlEndpoint: `http://127.0.0.1:${config.ports.control}`,
				controlTokenPath,
				approvalFile: config.approvalFile,
				extensionId: config.extensionId,
				roleRefs: config.roles.map((role) => role.roleRef),
			},
			null,
			2,
		)}\n`,
		{ mode: 0o600 },
	);
	process.stdout.write(`${JSON.stringify({ status: "RUNNING", statePath })}\n`);
	await new Promise(() => {});
} catch (error) {
	await stop();
	throw error;
}
