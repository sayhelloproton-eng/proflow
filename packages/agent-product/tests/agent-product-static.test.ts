import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	deterministicLoopbackPort,
	ensureModuleSecretFile,
	writeModuleSharedFacts,
} from "@tomflow/proflow-module-contract";
import { parse } from "yaml";
import { materializeAgentPackage } from "../src/index.ts";

const packageUrl = new URL("../package.json", import.meta.url);
const openApiUrl = new URL(
	"../actions/custom-gpt.openapi.yaml",
	import.meta.url,
);

async function artifacts() {
	const metadata = JSON.parse(await readFile(packageUrl, "utf8")) as Record<
		string,
		unknown
	>;
	const openapi = await readFile(openApiUrl, "utf8");
	return { metadata, openapi, material: materializeAgentPackage(metadata) };
}

type OpenApiOperation = {
	operationId: string;
	"x-openai-isConsequential": boolean;
	requestBody?: unknown;
};
type OpenApi = {
	openapi: string;
	security: unknown[];
	paths: Record<string, Record<string, OpenApiOperation>>;
};
const document = (text: string) => parse(text) as OpenApi;
const operations = (text: string) =>
	Object.values(document(text).paths).flatMap((path) =>
		Object.values(path).map((operation) => operation.operationId),
	);

test("CP-AGT-PROD-01 generic Product package keeps static Role Knowledge separate from dynamic Task facts", async () => {
	const { metadata, material } = await artifacts();
	assert.equal(material.packageName, "@tomflow/proflow-agent-product");
	assert.equal("agent.manifest" in metadata, false);
	assert.doesNotMatch(
		material.instructions,
		/需求充分后再创建\s*Task|Worker\s*可以先于\s*Task\s*存在/,
	);
	assert.match(material.instructions, /Requirement|需求/);
	const profile = (
		metadata as {
			proflowAgent?: {
				carrierProfiles?: {
					"custom-gpt"?: { requirements?: Record<string, unknown> };
				};
			};
		}
	).proflowAgent?.carrierProfiles?.["custom-gpt"];
	assert.ok(profile);
	assert.equal("knowledge" in (profile?.requirements ?? {}), false);
	assert.equal("knowledgeUpload" in (profile?.requirements ?? {}), false);
	assert.doesNotMatch(
		material.knowledgeBundle,
		/PRD|TEST_RESULT|TECHNICAL_DESIGN/,
	);
});

test("CP-AGT-PROD-02 Product GPT-facing OpenAPI is static and excludes New Task / dynamic Role discovery operations", async () => {
	const { openapi } = await artifacts();
	const parsed = document(openapi);
	assert.equal(parsed.openapi, "3.1.0");
	assert.ok(parsed.security.length > 0);
	assert.deepEqual(
		new Set(operations(openapi)),
		new Set([
			"getTask",
			"putTaskDocument",
			"getTaskDocument",
			"askPeer",
			"replyPeer",
		]),
	);
	for (const path of Object.values(parsed.paths))
		for (const [method, operation] of Object.entries(path)) {
			assert.equal(operation["x-openai-isConsequential"], false);
			if (method === "post") assert.ok(operation.requestBody);
		}
	assert.doesNotMatch(
		openapi,
		/createTask|listRegisteredRoles|getRegisteredRole|executeAnything|updateStatus/i,
	);
});

test("CP-AGT-PROD-03 + CP-AGT-PROD-04 Extension-first Task ownership is reflected by the Product surface while real c-id binding remains external", async () => {
	const { openapi, material } = await artifacts();
	assert.equal(operations(openapi).includes("createTask"), false);
	assert.equal(operations(openapi).includes("putTaskDocument"), true);
	assert.doesNotMatch(
		openapi,
		/createConversation|worker\.create|tabId|windowId|frameId/,
	);
	assert.doesNotMatch(
		material.instructions,
		/聊天.*(?:完成|确认).*Task.*(?:READY|ACTIVE)|自然语言.*Task.*状态/i,
	);
	const { behaviorAdapter } = await import("../deployment/adapter.ts");
	const context = { workspaceRoot: "/__proflow_missing_agent_fixture__" };
	const status = behaviorAdapter.status(context).result;
	assert.equal(status.status, "SUCCEEDED");
	assert.deepEqual(status.data, {
		setupStatus: "ACTION_REQUIRED",
		runtimeStatus: "NOT_APPLICABLE",
		issues: [
			{
				scope: "SETUP",
				code: "ROLE_SETUP_REQUIRED",
				message: "ROLE_NOT_REGISTERED:@tomflow/proflow-agent-product",
				relatedModuleRefs: [],
				nextCommand: "platform setup --module agent-product",
			},
		],
	});
	assert.equal(behaviorAdapter.setup(context).result.status, "ACTION_REQUIRED");
});

test("CP-AGT-PROD-05 one Worker Turn permits 0..N routine Actions without Browser continue protocol", async () => {
	const { openapi } = await artifacts();
	const parsed = document(openapi);
	for (const path of Object.values(parsed.paths))
		for (const operation of Object.values(path))
			assert.equal(operation["x-openai-isConsequential"], false);
	assert.doesNotMatch(
		openapi,
		/continue(?:Worker|Turn|Conversation)|actionFinished|browserContinue|wakeAfterAction/i,
	);
});

test("CP-AGT-PROD-06 real GPT auth/Always Allow/File Bridge proof is not faked by package-local fixtures", async () => {
	const { behaviorAdapter } = await import("../deployment/adapter.ts");
	const context = { workspaceRoot: "/__proflow_missing_agent_fixture__" };
	const status = behaviorAdapter.status(context).result;
	assert.equal(status.status, "SUCCEEDED");
	assert.deepEqual(status.data, {
		setupStatus: "ACTION_REQUIRED",
		runtimeStatus: "NOT_APPLICABLE",
		issues: [
			{
				scope: "SETUP",
				code: "ROLE_SETUP_REQUIRED",
				message: "ROLE_NOT_REGISTERED:@tomflow/proflow-agent-product",
				relatedModuleRefs: [],
				nextCommand: "platform setup --module agent-product",
			},
		],
	});
	assert.equal(behaviorAdapter.setup(context).result.status, "ACTION_REQUIRED");
});

test("CP-REAL2-PROV-01 Product package owns complete Custom GPT provisioning material", async () => {
	const { metadata, material } = await artifacts();
	assert.equal(material.description, metadata.description);
	assert.equal(material.recommendedModel, "gpt-5-6");
	assert.deepEqual(material.capabilities, {
		webSearch: true,
		imageGeneration: false,
		codeInterpreter: false,
	});
	assert.equal(material.actionSchema, "actions/custom-gpt.openapi.yaml");
	assert.equal(material.knowledgeBundle, "knowledge/custom-gpt-knowledge.zip");
	assert.equal("knowledgeFiles" in material, false);
	const bundle = await readFile(
		new URL(`../${material.knowledgeBundle}`, import.meta.url),
	);
	assert.equal(bundle.subarray(0, 2).toString("ascii"), "PK");
});

test("CP-REAL2-PROV-01 custom-gpt setup exposes complete Product provisioning material", async () => {
	const { metadata } = await artifacts();
	const result = spawnSync(
		process.execPath,
		[
			new URL("../dist/src/cli.js", import.meta.url).pathname,
			"custom-gpt",
			"setup",
			"--gateway-url",
			"https://gateway.example.com",
		],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
	const setup = JSON.parse(result.stdout) as Record<string, unknown>;
	assert.equal(setup.description, metadata.description);
	assert.equal(setup.recommendedModel, "gpt-5-6");
	assert.deepEqual(setup.capabilities, {
		webSearch: true,
		imageGeneration: false,
		codeInterpreter: false,
	});
	assert.equal(setup.knowledgeBundle, "knowledge/custom-gpt-knowledge.zip");
	assert.equal(setup.actionSchema, "actions/custom-gpt.openapi.yaml");
	assert.equal(setup.gatewayUrl, "https://gateway.example.com");
	assert.equal("knowledgeFiles" in setup, false);
});

test("CP-REAL2-PROV-07/08 Product finalization uses one Agent-owned credential for Extension Auth and Gateway probe without stdout leakage", async (context) => {
	const workspace = await mkdtemp(join(tmpdir(), "proflow-agent-product-b5-"));
	context.after(() => rm(workspace, { recursive: true, force: true }));
	const moduleContext = { workspaceRoot: workspace };
	const extensionId = "q".repeat(32);
	const extensionInstanceId = "extension:agent-product-b5";
	const tokenFile = await ensureModuleSecretFile(
		moduleContext,
		"execution-browser-extension",
		"provisioning",
	);
	const provisioningToken = (await readFile(tokenFile, "utf8")).trim();
	const provisioningPort = deterministicLoopbackPort(
		moduleContext,
		"execution-browser-extension",
		"provisioning",
	);
	const provisioningEndpoint = `http://127.0.0.1:${provisioningPort}`;
	await writeModuleSharedFacts(moduleContext, "execution-browser-extension", {
		extensionId,
		provisioningBridgeTokenFile: tokenFile,
		provisioningBridgeEndpoint: provisioningEndpoint,
	});

	let gatewayAuthorization: string | undefined;
	const gateway = createServer((request, response) => {
		if (request.url === "/health") {
			response.writeHead(200, { "content-type": "application/json" });
			response.end('{"ok":true}');
			return;
		}
		if (request.url?.startsWith("/actions/getTask?")) {
			gatewayAuthorization = request.headers.authorization;
			response.writeHead(400, { "content-type": "application/json" });
			response.end('{"error":"TASK_NOT_FOUND"}');
			return;
		}
		response.writeHead(404);
		response.end();
	});
	await new Promise<void>((resolveListen, rejectListen) => {
		gateway.once("error", rejectListen);
		gateway.listen(0, "127.0.0.1", () => {
			gateway.off("error", rejectListen);
			resolveListen();
		});
	});
	context.after(
		() =>
			new Promise<void>((resolveClose) => gateway.close(() => resolveClose())),
	);
	const address = gateway.address();
	assert.ok(address && typeof address !== "string");
	const gatewayUrl = `http://127.0.0.1:${address.port}`;
	await writeModuleSharedFacts(moduleContext, "agent-gateway", {
		publicBaseUrl: gatewayUrl,
	});

	const carrierUrl = "https://chatgpt.com/g/g-product-b5";
	const child = spawn(
		process.execPath,
		[
			new URL("../dist/src/cli.js", import.meta.url).pathname,
			"custom-gpt",
			"finalize-role",
			"--workspace",
			workspace,
			"--carrier-url",
			carrierUrl,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	context.after(() => {
		if (child.exitCode === null) child.kill("SIGTERM");
	});
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk: string) => {
		stderr += chunk;
	});
	const exited = new Promise<number | null>((resolveExit, rejectExit) => {
		child.once("error", rejectExit);
		child.once("exit", resolveExit);
	});
	const extensionFetch = (path: string, init: RequestInit = {}) =>
		fetch(`${provisioningEndpoint}${path}`, {
			...init,
			headers: {
				authorization: `Bearer ${provisioningToken}`,
				origin: `chrome-extension://${extensionId}`,
				"content-type": "application/json",
				...(init.headers ?? {}),
			},
		});
	let hello: Response | undefined;
	for (let attempt = 0; attempt < 80; attempt += 1) {
		try {
			hello = await extensionFetch("/v1/provisioning/session/hello", {
				method: "POST",
				body: JSON.stringify({ extensionId, extensionInstanceId }),
			});
			if (hello.ok) break;
		} catch {
			// The CLI owns bridge startup; wait until its listener exists.
		}
		await new Promise<void>((resolveWait) => setTimeout(resolveWait, 25));
	}
	assert.equal(hello?.status, 200, stderr);
	const query = `?extensionInstanceId=${encodeURIComponent(extensionInstanceId)}`;
	assert.equal(
		(
			await extensionFetch(`/v1/provisioning/session/heartbeat${query}`, {
				method: "POST",
				body: "{}",
			})
		).status,
		200,
	);
	let next = await extensionFetch(`/v1/provisioning/commands/next${query}`);
	const commandDeadline = Date.now() + 2_000;
	while (next.status === 204 && Date.now() < commandDeadline) {
		await new Promise<void>((resolveWait) => setTimeout(resolveWait, 25));
		next = await extensionFetch(`/v1/provisioning/commands/next${query}`);
	}
	assert.equal(next.status, 200, stderr);
	const command = (await next.json()) as {
		commandId: string;
		type: string;
		request: { carrierUrl?: string; credential?: string };
	};
	assert.equal(command.type, "FINALIZE_CUSTOM_GPT_AUTH");
	assert.equal(command.request.carrierUrl, carrierUrl);
	const dynamicCredential = command.request.credential;
	assert.equal(typeof dynamicCredential, "string");
	assert.ok((dynamicCredential?.length ?? 0) >= 32);
	assert.equal(
		(
			await extensionFetch(`/v1/provisioning/commands/result${query}`, {
				method: "POST",
				body: JSON.stringify({
					commandId: command.commandId,
					ok: true,
					value: { status: "AUTH_UPDATED", gptId: "g-product-b5" },
				}),
			})
		).status,
		200,
	);
	assert.equal(await exited, 0, stderr);
	assert.equal(gatewayAuthorization, `Bearer ${dynamicCredential}`);
	assert.doesNotMatch(stdout, new RegExp(dynamicCredential as string));
	assert.doesNotMatch(stderr, new RegExp(dynamicCredential as string));
	assert.deepEqual(JSON.parse(stdout), {
		status: "READY",
		roleRef: "g-product-b5",
		carrierUrl,
		authStatus: "AUTH_UPDATED",
		checks: { owner: "PASS", carrier: "PASS" },
	});
});
