import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const harnessPath = new URL("./real-carrier-e2e-harness.ts", import.meta.url);

async function freePort() {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") assert.fail("missing port");
	await new Promise<void>((resolve) => server.close(() => resolve()));
	return address.port;
}

test("real Carrier harness emits the exact Execution approval fingerprint without starting services", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-carrier-fingerprint-"));
	const requestPath = join(root, "request.json");
	await writeFile(
		requestPath,
		JSON.stringify({
			contract: "execution",
			contractVersion: "1.0.0",
			callerRef: "g-controller",
			roleRef: "g-controller",
			taskId: "task:carrier",
			idempotencyKey: "worker-create:carrier",
			capability: "worker.create",
			input: {
				roleRef: "g-dev",
				roleUrl: "https://chatgpt.com/g/g-dev",
				bootstrapFingerprint: "bootstrap:carrier",
			},
		}),
	);
	const { stdout } = await exec(process.execPath, [
		"--experimental-strip-types",
		harnessPath.pathname,
		"fingerprint",
		"--request",
		requestPath,
	]);
	assert.match(JSON.parse(stdout).inputFingerprint, /^sha256:[a-f0-9]{64}$/);
});

test("real Carrier harness rejects unsafe or incomplete runtime configuration before effects", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-carrier-config-"));
	const configPath = join(root, "config.json");
	await writeFile(
		configPath,
		JSON.stringify({
			stateRoot: ".proflow",
			projectRoot: ".",
			publicGatewayUrl: "http://127.0.0.1:8080",
			extensionId: "not-an-extension-id",
			modelConfigPath: "model.json",
			approvalFile: "approvals.json",
			ports: {
				model: 45001,
				execution: 45001,
				host: 45001,
				gateway: 45001,
				bridge: 45001,
				control: 45001,
			},
			roles: [],
		}),
	);
	await assert.rejects(
		() =>
			exec(process.execPath, [
				"--experimental-strip-types",
				harnessPath.pathname,
				"start",
				"--config",
				configPath,
			]),
		/(publicGatewayUrl|extensionId|stateRoot|roles)/,
	);
});

test("real Carrier harness starts the formal stack and exposes only authenticated loopback control", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-carrier-stack-"));
	const stateRoot = join(root, ".proflow");
	const projectRoot = join(root, "project");
	await mkdir(projectRoot);
	await writeFile(
		join(projectRoot, "package.json"),
		'{"name":"carrier-proof"}',
	);
	const provider = createServer(async (request, response) => {
		let body = "";
		for await (const chunk of request) body += String(chunk);
		const model = (JSON.parse(body) as { model: string }).model;
		const output = JSON.stringify({
			decision: "HEALTHY",
			confidence: 1,
			reasonCode: "ALL_CHECKS_PASS",
			rationale: "all checks pass",
		});
		response.setHeader("content-type", "application/json");
		response.end(
			JSON.stringify({
				id: "provider:carrier-proof",
				choices: [
					{
						message: {
							content:
								model === "reason-model"
									? `<think>bounded</think>${output}`
									: output,
						},
					},
				],
			}),
		);
	});
	await new Promise<void>((resolve) =>
		provider.listen(0, "127.0.0.1", resolve),
	);
	context.after(
		() => new Promise<void>((resolve) => provider.close(() => resolve())),
	);
	const providerAddress = provider.address();
	if (!providerAddress || typeof providerAddress === "string")
		assert.fail("missing provider port");
	const modelConfigPath = join(root, "model.json");
	const profile = {
		inputModalities: ["text"],
		structuredOutput: "native",
		contextWindow: 32_000,
		maxOutputTokens: 2_048,
	};
	await writeFile(
		modelConfigPath,
		JSON.stringify({
			stateRoot,
			providerBaseUrl: `http://127.0.0.1:${providerAddress.port}/v1/`,
			models: { fast: "fast-model", reason: "reason-model" },
			profiles: {
				fast: {
					...profile,
					modelRef: "fast-model",
					reasoningModes: ["no-thinking"],
				},
				reason: {
					...profile,
					modelRef: "reason-model",
					reasoningModes: ["thinking"],
				},
			},
			capabilityFacts: {
				fast: {
					contextWindow: 32_000,
					maxOutputTokens: 2_048,
					basis: "bounded-probe",
				},
				reason: {
					contextWindow: 32_000,
					maxOutputTokens: 2_048,
					basis: "bounded-probe",
				},
			},
		}),
	);
	const approvalFile = join(root, "approvals.json");
	await writeFile(
		approvalFile,
		JSON.stringify({
			contract: "proflow.execution.operator-approval-ledger.v1",
			approvals: [],
		}),
	);
	await chmod(approvalFile, 0o600);
	const ports = {
		model: await freePort(),
		execution: await freePort(),
		host: await freePort(),
		gateway: await freePort(),
		bridge: await freePort(),
		control: await freePort(),
	};
	const configPath = join(root, "config.json");
	await writeFile(
		configPath,
		JSON.stringify({
			stateRoot,
			projectRoot,
			publicGatewayUrl: "https://gateway.example",
			extensionId: "a".repeat(32),
			modelConfigPath,
			approvalFile,
			ports,
			roles: [
				{
					agentPackageRef: "@tomflow/proflow-agent-product",
					registeredPackageVersion: "0.1.0",
					roleRef: "g-product",
					carrierUrl: "https://chatgpt.com/g/g-product",
				},
				{
					agentPackageRef: "@tomflow/proflow-agent-controller-dev",
					registeredPackageVersion: "0.1.0",
					roleRef: "g-controller",
					carrierUrl: "https://chatgpt.com/g/g-controller",
				},
				{
					agentPackageRef: "@tomflow/proflow-agent-test-ops",
					registeredPackageVersion: "0.1.0",
					roleRef: "g-test",
					carrierUrl: "https://chatgpt.com/g/g-test",
				},
			],
		}),
	);
	const child = spawn(
		process.execPath,
		[
			"--experimental-strip-types",
			harnessPath.pathname,
			"start",
			"--config",
			configPath,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	context.after(() => {
		if (!child.killed) child.kill("SIGTERM");
	});
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error(`harness start timeout: ${stderr}`)),
			10_000,
		);
		const poll = () => {
			if (stdout.includes('"status":"RUNNING"')) {
				clearTimeout(timeout);
				resolve();
			} else if (child.exitCode !== null) {
				clearTimeout(timeout);
				reject(new Error(`harness exited: ${stderr}`));
			} else setTimeout(poll, 20);
		};
		poll();
	});
	const state = JSON.parse(
		await readFile(join(stateRoot, "real-carrier-state.json"), "utf8"),
	) as {
		controlEndpoint: string;
		controlTokenPath: string;
		executionUrl: string;
		localGatewayUrl: string;
	};
	assert.equal(
		(await fetch(`${state.executionUrl}/executions/not-authorized`)).status,
		401,
	);
	assert.equal((await fetch(`${state.controlEndpoint}/status`)).status, 401);
	const token = (await readFile(state.controlTokenPath, "utf8")).trim();
	const status = await fetch(`${state.controlEndpoint}/status`, {
		headers: { authorization: `Bearer ${token}` },
	});
	assert.equal(status.status, 200);
	const snapshot = (await status.json()) as {
		bridge: { online: boolean };
		host: { readiness: string };
	};
	assert.equal(snapshot.bridge.online, false);
	assert.equal(snapshot.host.readiness, "READY");
	const credentials = JSON.parse(
		await readFile(
			join(stateRoot, "agent", "secrets", "role-credentials.json"),
			"utf8",
		),
	) as Record<string, string>;
	const created = await fetch(`${state.localGatewayUrl}/actions/createTask`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${credentials["g-product"]}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			taskId: "task:carrier-plan",
			title: "Carrier plan",
			objective: "Prove formal real Carrier planning",
			plan: {
				nodes: [
					{
						nodeId: "node:carrier-dev",
						title: "Develop",
						objective: "Use real dev Worker",
						requiredRoleRef: "g-controller",
						inputDocuments: [],
						outputDocuments: [],
					},
					{
						nodeId: "node:carrier-test",
						title: "Test",
						objective: "Use real test Worker",
						requiredRoleRef: "g-test",
						inputDocuments: [],
						outputDocuments: [],
					},
				],
			},
			roleBindings: [
				{ roleRef: "g-product", workerRef: "c-product-real" },
				{ roleRef: "g-controller", workerRef: null },
				{ roleRef: "g-test", workerRef: null },
			],
			idempotencyKey: "carrier-plan-create",
		}),
	});
	assert.equal(created.status, 200);
	const controlHeaders = {
		authorization: `Bearer ${token}`,
		"content-type": "application/json",
	};
	const authorized = await fetch(`${state.controlEndpoint}/task/authorize`, {
		method: "POST",
		headers: controlHeaders,
		body: JSON.stringify({
			taskId: "task:carrier-plan",
			expectedTaskVersion: 1,
			authorizedByRef: "human:carrier-test",
			idempotencyKey: "carrier-plan-authorize",
		}),
	});
	assert.equal(authorized.status, 200);
	const provisionPlan = (await fetch(
		`${state.controlEndpoint}/task/provision-plan?taskId=task%3Acarrier-plan`,
		{ headers: { authorization: `Bearer ${token}` } },
	).then((response) => response.json())) as {
		requests: Array<{ capability: string; input: { roleRef: string } }>;
	};
	assert.deepEqual(
		provisionPlan.requests.map((request) => [
			request.capability,
			request.input.roleRef,
		]),
		[
			["worker.create", "g-controller"],
			["worker.create", "g-test"],
		],
	);
	child.kill("SIGTERM");
	await new Promise<void>((resolve, reject) => {
		child.once("exit", (code) =>
			code === 0
				? resolve()
				: reject(new Error(`harness exit ${code}: ${stderr}`)),
		);
	});
});
