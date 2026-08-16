import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPlatformHost, parsePlatformHostConfig } from "../src/index.ts";

async function dependencyServer() {
	let ready = true;
	let release: (() => void) | undefined;
	let entered: (() => void) | undefined;
	const requestEntered = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const server = createServer(async (request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.url === "/ready") {
			response.statusCode = ready ? 200 : 503;
			response.end(JSON.stringify({ status: ready ? "READY" : "NOT_READY" }));
			return;
		}
		if (request.url === "/executions") {
			entered?.();
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			response.end(
				JSON.stringify({
					executionRef: "execution:host-proof",
					status: "SUCCEEDED",
				}),
			);
			return;
		}
		response.end(JSON.stringify({ status: "READY" }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		assert.fail("missing dependency port");
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		requestEntered,
		setReady(value: boolean) {
			ready = value;
		},
		release() {
			release?.();
		},
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

function config(stateRoot: string, workspaceRoot: string, baseUrl: string) {
	return parsePlatformHostConfig({
		stateRoot,
		workspaceRoot,
		host: "127.0.0.1",
		port: 0,
		executionBaseUrl: baseUrl,
		modelBaseUrl: baseUrl,
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
	});
}

test("CP-HOST-01 + CP-HOST-02 composition root wires owner packages/public clients and owns no business repository", async () => {
	const packageJson = JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), "utf8"),
	) as { dependencies?: Record<string, string> };
	assert.equal(
		packageJson.dependencies?.["@tomflow/proflow-task-orchestration"] !==
			undefined,
		true,
	);
	assert.equal(
		packageJson.dependencies?.["@tomflow/proflow-agent-runtime"] !== undefined,
		true,
	);

	const source = await readFile(
		new URL("../src/index.ts", import.meta.url),
		"utf8",
	);
	for (const forbidden of [
		"TaskObserverStore",
		"SystemAssessmentRepository",
		"ExecutionRepository",
		"BrowserFrameRegistry",
		"UniversalScheduler",
	])
		assert.doesNotMatch(source, new RegExp(forbidden, "i"));

	const packageEntries = await readdir(new URL("..", import.meta.url));
	assert.equal(packageEntries.includes("src"), true);
	assert.equal(packageEntries.includes("tests"), true);
});

test("CP-HOST-03 local transport is loopback-only, restartable, and shutdown drains in-flight requests", async () => {
	assert.throws(
		() =>
			parsePlatformHostConfig({
				stateRoot: "/tmp/.proflow",
				workspaceRoot: "/tmp/project",
				executionBaseUrl: "https://execution.example",
				modelBaseUrl: "http://127.0.0.1:9001",
			}),
		/loopback HTTP/,
	);

	const root = await mkdtemp(join(tmpdir(), "proflow-platform-host-"));
	const dependency = await dependencyServer();
	const host = createPlatformHost({
		config: config(
			join(root, ".proflow"),
			join(root, "project"),
			dependency.baseUrl,
		),
	});
	try {
		const first = await host.start();
		const baseUrl = `http://${first.host}:${first.port}`;
		assert.equal((await fetch(`${baseUrl}/ready`)).status, 200);

		const inFlight = fetch(`${baseUrl}/actions/executeCapability`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				authenticatedRoleRef: "g-controller",
				input: {
					capability: "project.inspect",
					input: {},
					idempotencyKey: "host-drain",
				},
			}),
		});
		await dependency.requestEntered;
		let stopped = false;
		const stopping = host.stop().then(() => {
			stopped = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.equal(stopped, false);
		dependency.release();
		await inFlight;
		await stopping;
		assert.equal((await host.status()).process, "STOPPED");

		const restarted = await host.start();
		assert.equal(
			(await fetch(`http://${restarted.host}:${restarted.port}/ready`)).status,
			200,
		);
	} finally {
		dependency.release();
		await host.stop();
		await dependency.close();
	}
});

test("PRESMOKE-B6-A1 Gateway-to-platform-host actions require an independent transport bearer when configured", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "proflow-platform-host-gateway-auth-"),
	);
	const stateRoot = join(root, ".proflow");
	const transportCredentialFile = join(root, "gateway-to-host.token");
	const transportCredential = "gateway-to-host-transport-credential";
	await writeFile(transportCredentialFile, `${transportCredential}\n`, {
		mode: 0o600,
	});
	const dependency = await dependencyServer();
	const hostConfig = parsePlatformHostConfig({
		...config(stateRoot, join(root, "project"), dependency.baseUrl),
		gatewayTransportCredentialFile: transportCredentialFile,
	});
	const host = createPlatformHost({ config: hostConfig });
	try {
		const started = await host.start();
		const baseUrl = `http://${started.host}:${started.port}`;
		const body = JSON.stringify({
			authenticatedRoleRef: "g-controller",
			input: { taskId: "task:missing" },
		});
		const unauthenticated = await fetch(`${baseUrl}/actions/getTask`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
		});
		assert.equal(unauthenticated.status, 401);
		assert.equal(
			((await unauthenticated.json()) as { error: string }).error,
			"GATEWAY_TRANSPORT_AUTH_FAILED",
		);

		const authenticated = await fetch(`${baseUrl}/actions/getTask`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${transportCredential}`,
				"content-type": "application/json",
			},
			body,
		});
		assert.notEqual(authenticated.status, 401);
	} finally {
		await host.stop();
		await dependency.close();
	}
});

test("PRESMOKE-B6-C1 browser structured logs use authenticated local ingestion, bounded typed axes, and reject secret-shaped fields", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "proflow-platform-host-browser-log-"),
	);
	const stateRoot = join(root, ".proflow");
	const dependency = await dependencyServer();
	const host = createPlatformHost({
		config: config(stateRoot, join(root, "project"), dependency.baseUrl),
	});
	try {
		const started = await host.start();
		const baseUrl = `http://${started.host}:${started.port}`;
		const token = (
			await readFile(
				join(stateRoot, "browser", "secrets", "task-application.token"),
				"utf8",
			)
		).trim();
		const withoutAuth = await fetch(`${baseUrl}/application/log`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				timestamp: new Date().toISOString(),
				level: "INFO",
				component: "browser-carrier",
			}),
		});
		assert.equal(withoutAuth.status, 401);

		const entry = {
			timestamp: new Date().toISOString(),
			level: "INFO",
			component: "browser-carrier",
			capability: "browser.submit",
			operation: "SUBMIT",
			status: "SUCCEEDED",
			correlationId: "correlation:1",
			taskId: "task:1",
			nodeId: "node:1",
			runNo: 2,
			roleRef: "g-dev",
			workerRef: "c-dev",
			executionRef: "execution:1",
			operationRef: "command:1",
			tabId: 7,
		};
		const accepted = await fetch(`${baseUrl}/application/log`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(entry),
		});
		assert.equal(accepted.status, 200);
		const rejectedSecret = await fetch(`${baseUrl}/application/log`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ ...entry, authorization: "Bearer DO-NOT-LOG" }),
		});
		assert.equal(rejectedSecret.status, 400);

		const text = await readFile(
			join(stateRoot, "logs", "browser-extension", "events.jsonl"),
			"utf8",
		);
		const persisted = JSON.parse(text.trim()) as Record<string, unknown>;
		assert.equal(persisted.executionRef, "execution:1");
		assert.equal(persisted.taskId, "task:1");
		assert.equal(persisted.workerRef, "c-dev");
		assert.equal(persisted.operationRef, "command:1");
		assert.equal(persisted.tabId, 7);
		assert.doesNotMatch(text, /DO-NOT-LOG|authorization/i);
	} finally {
		await host.stop();
		await dependency.close();
	}
});

test("CP-HOST-04 dependency unavailability is reported as dependency health, never invented Domain READY/System Assessment", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-platform-host-health-"));
	const dependency = await dependencyServer();
	const host = createPlatformHost({
		config: config(
			join(root, ".proflow"),
			join(root, "project"),
			dependency.baseUrl,
		),
	});
	try {
		const started = await host.start();
		dependency.setReady(false);
		const response = await fetch(
			`http://${started.host}:${started.port}/ready`,
		);
		const body = await response.text();
		assert.match(body, /NOT_READY|dependency/i);
		assert.doesNotMatch(
			body,
			/systemAssessment|overallSystemHealth|taskReady/i,
		);
	} finally {
		await host.stop();
		await dependency.close();
	}
});

test("CP-HOST-05 restart rebuilds composition and has no host mutation replay/cache truth", async () => {
	const source = await readFile(
		new URL("../src/index.ts", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(
		source,
		/mutationReplay|replayJournal|businessStateMirror|assessmentCache/i,
	);
	assert.match(source, /restart|createPlatformHost/i);
});

test("PRESMOKE-B3-APP-01 Extension Task application surface is loopback-authenticated and calls Task owner queries", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-platform-host-app-"));
	const stateRoot = join(root, ".proflow");
	const dependency = await dependencyServer();
	const host = createPlatformHost({
		config: config(stateRoot, join(root, "project"), dependency.baseUrl),
	});
	try {
		const started = await host.start();
		const baseUrl = `http://${started.host}:${started.port}`;
		const unauthenticated = await fetch(`${baseUrl}/application/task`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ operation: "task.list", input: {} }),
		});
		assert.equal(unauthenticated.status, 401);

		const token = (
			await readFile(
				join(stateRoot, "browser", "secrets", "task-application.token"),
				"utf8",
			)
		).trim();
		assert.ok(token.length >= 32);
		const response = await fetch(`${baseUrl}/application/task`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ operation: "task.list", input: {} }),
		});
		assert.equal(response.status, 200);
		const value = (await response.json()) as { tasks?: unknown[] };
		assert.deepEqual(value.tasks, []);
	} finally {
		await host.stop();
		await dependency.close();
	}
});

test("PRESMOKE-B4-APPROVAL-03 human Approval application has a dedicated token and cannot self-report actor/decision authority", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-platform-host-approval-"));
	const stateRoot = join(root, ".proflow");
	const dependency = await dependencyServer();
	const host = createPlatformHost({
		config: config(stateRoot, join(root, "project"), dependency.baseUrl),
	});
	try {
		const started = await host.start();
		const baseUrl = `http://${started.host}:${started.port}`;
		assert.equal(
			(
				await fetch(`${baseUrl}/application/approval`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ operation: "approval.list", input: {} }),
				})
			).status,
			401,
		);
		const approvalToken = (
			await readFile(
				join(stateRoot, "browser", "secrets", "approval-application.token"),
				"utf8",
			)
		).trim();
		const taskToken = (
			await readFile(
				join(stateRoot, "browser", "secrets", "task-application.token"),
				"utf8",
			)
		).trim();
		assert.notEqual(approvalToken, taskToken);
		assert.ok(approvalToken.length >= 32);
		const response = await fetch(`${baseUrl}/application/approval`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${approvalToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ operation: "approval.list", input: {} }),
		});
		assert.equal(response.status, 200);
	} finally {
		await host.stop();
		await dependency.close();
	}
});

test("PRESMOKE-B4-IDENTITY-01 execution-runtime identity admission uses a dedicated loopback credential and platform-host owner facts", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-platform-host-identity-"));
	const stateRoot = join(root, ".proflow");
	const dependency = await dependencyServer();
	const host = createPlatformHost({
		config: config(stateRoot, join(root, "project"), dependency.baseUrl),
	});
	try {
		const started = await host.start();
		const baseUrl = `http://${started.host}:${started.port}`;
		assert.equal(
			(await fetch(`${baseUrl}/internal/execution/identity/ready`)).status,
			401,
		);
		const token = (
			await readFile(
				join(stateRoot, "execution", "secrets", "execution-identity.token"),
				"utf8",
			)
		).trim();
		const ready = await fetch(`${baseUrl}/internal/execution/identity/ready`, {
			headers: { authorization: `Bearer ${token}` },
		});
		assert.equal(ready.status, 200);
		const denied = await fetch(`${baseUrl}/internal/execution/authorize`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				callerRef: "unknown-role",
				idempotencyKey: "identity",
				capability: "file.read",
				input: { path: "x" },
			}),
		});
		assert.equal(denied.status, 200);
		assert.equal(
			((await denied.json()) as { authorized: boolean }).authorized,
			false,
		);
	} finally {
		await host.stop();
		await dependency.close();
	}
});

test("PRESMOKE-B4-HOST-READ execution reads re-admit durable Task/Role/Worker scope", async () => {
	const source = await readFile(
		new URL("../src/index.ts", import.meta.url),
		"utf8",
	);
	assert.match(source, /const admitExecutionRead = async/);
	assert.match(source, /EXECUTION_CALLER_MISMATCH/);
	assert.match(source, /EXECUTION_ROLE_SCOPE_MISMATCH/);
	assert.match(source, /EXECUTION_WORKER_SCOPE_REQUIRED/);
	assert.match(
		source,
		/await admitTaskParticipant\([\s\S]*?record\.taskId[\s\S]*?record\.workerRef/,
	);
	assert.match(
		source,
		/operationId === "readExecutionOutput"[\s\S]*?execution\.invoke\("getExecution"[\s\S]*?admitExecutionRead/,
	);
});

test("PRESMOKE-B4-HOST-FILE-01 Carrier File Bridge materialization carries stable Execution idempotency and canonical role/worker scope", async () => {
	const source = await readFile(
		new URL("../src/index.ts", import.meta.url),
		"utf8",
	);
	const start = source.indexOf(
		'await execution.invoke("materializeExternalFiles"',
	);
	assert.notEqual(start, -1);
	const section = source.slice(Math.max(0, start - 400), start + 900);
	assert.match(section, /input\.idempotencyKey/);
	assert.match(section, /carrier-file-materialization/);
	assert.match(section, /correlationId: taskMutationIdempotencyKey/);
	assert.match(section, /roleRef: authenticatedRoleRef/);
	assert.match(section, /workerRef: actorRef/);
});

test("RF-AGT-GW-14 platform-host rejects group/world-readable Gateway transport credential", async (t) => {
	if (process.platform === "win32") return t.skip("POSIX mode proof");
	const root = await mkdtemp(
		join(tmpdir(), "proflow-platform-host-gateway-permissions-"),
	);
	const stateRoot = join(root, ".proflow");
	const transportCredentialFile = join(root, "gateway-to-host.token");
	await writeFile(
		transportCredentialFile,
		"gateway-to-host-transport-credential\n",
		{ mode: 0o600 },
	);
	await chmod(transportCredentialFile, 0o644);
	const dependency = await dependencyServer();
	const host = createPlatformHost({
		config: parsePlatformHostConfig({
			...config(stateRoot, join(root, "project"), dependency.baseUrl),
			gatewayTransportCredentialFile: transportCredentialFile,
		}),
	});
	try {
		await assert.rejects(
			() => host.start(),
			/GATEWAY_TRANSPORT_CREDENTIAL_PERMISSIONS_INVALID/,
		);
	} finally {
		await host.stop();
		await dependency.close();
	}
});

async function securedExecutionServer(credential: string) {
	const authorizations: Array<string | undefined> = [];
	const server = createServer(async (request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.url === "/ready") {
			authorizations.push(request.headers.authorization);
			if (request.headers.authorization !== `Bearer ${credential}`) {
				response.statusCode = 401;
				response.end(
					JSON.stringify({ error: "EXECUTION_TRANSPORT_AUTH_FAILED" }),
				);
				return;
			}
			response.end(JSON.stringify({ status: "READY" }));
			return;
		}
		if (request.url === "/executions" && request.method === "POST") {
			authorizations.push(request.headers.authorization);
			if (request.headers.authorization !== `Bearer ${credential}`) {
				response.statusCode = 401;
				response.end(
					JSON.stringify({ error: "EXECUTION_TRANSPORT_AUTH_FAILED" }),
				);
				return;
			}
			response.end(
				JSON.stringify({
					executionRef: "execution:secured",
					status: "SUCCEEDED",
				}),
			);
			return;
		}
		authorizations.push(request.headers.authorization);
		if (request.headers.authorization !== `Bearer ${credential}`) {
			response.statusCode = 401;
			response.end(
				JSON.stringify({ error: "EXECUTION_TRANSPORT_AUTH_FAILED" }),
			);
			return;
		}
		response.end(JSON.stringify({ status: "READY" }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		assert.fail("missing execution port");
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		authorizations,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

test("PRESMOKE-B6-HOST-EXEC-01 Host→Execution transport credential is wired from config and business routes carry the Bearer", async () => {
	const executionCredential = "execution-runtime-transport-credential-value";
	const execution = await securedExecutionServer(executionCredential);
	const model = await dependencyServer();
	const root = await mkdtemp(
		join(tmpdir(), "proflow-platform-host-exec-auth-"),
	);
	const correctFile = join(root, "execution-correct.token");
	const wrongFile = join(root, "execution-wrong.token");
	await writeFile(correctFile, `${executionCredential}\n`, { mode: 0o600 });
	await writeFile(wrongFile, "wrong-execution-runtime-transport-credential\n", {
		mode: 0o600,
	});

	async function build(executionTransportCredentialFile?: string) {
		const stateRoot = join(
			await mkdtemp(join(tmpdir(), "proflow-platform-host-exec-auth-state-")),
			".proflow",
		);
		return createPlatformHost({
			config: parsePlatformHostConfig({
				...config(
					stateRoot,
					join(
						await mkdtemp(
							join(tmpdir(), "proflow-platform-host-exec-auth-ws-"),
						),
					),
					execution.baseUrl,
				),
				modelBaseUrl: model.baseUrl,
				...(executionTransportCredentialFile
					? { executionTransportCredentialFile }
					: {}),
			}),
		});
	}

	const correct = await build(correctFile);
	try {
		const started = await correct.start();
		const status = await correct.status();
		assert.equal(status.dependencies.execution.status, "READY");
		assert.equal(status.dependencies.execution.liveness, "UP");

		const action = await fetch(
			`http://${started.host}:${started.port}/actions/executeCapability`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					authenticatedRoleRef: "g-controller",
					input: {
						capability: "project.inspect",
						input: {},
						idempotencyKey: "host-exec-auth",
					},
				}),
			},
		);
		assert.equal(action.status, 200);
		const body = (await action.json()) as {
			executionRef?: string;
			status?: string;
		};
		assert.equal(body.status, "SUCCEEDED");
		assert.ok(
			execution.authorizations.includes(`Bearer ${executionCredential}`),
			"business route must carry the Execution transport Bearer",
		);
	} finally {
		await correct.stop();
	}

	const wrong = await build(wrongFile);
	try {
		await wrong.start();
		const status = await wrong.status();
		assert.equal(status.dependencies.execution.status, "NOT_READY");
	} finally {
		await wrong.stop();
	}

	const missing = await build(undefined);
	try {
		await missing.start();
		const status = await missing.status();
		assert.equal(status.dependencies.execution.status, "NOT_READY");
	} finally {
		await missing.stop();
	}

	assert.ok(
		execution.authorizations.includes(
			`Bearer wrong-execution-runtime-transport-credential`,
		),
		"wrong Bearer must be observed (and rejected) on Execution /ready",
	);
	assert.ok(
		execution.authorizations.includes(undefined),
		"missing Authorization must be observed (and rejected) on Execution /ready",
	);
	await execution.close();
	await model.close();
});
