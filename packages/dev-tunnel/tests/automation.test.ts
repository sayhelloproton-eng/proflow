import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	readModuleSharedFacts,
	writeModuleSharedFacts,
} from "@tomflow/proflow-module-contract";
import { createDevTunnelBehaviorAdapter } from "../deployment/adapter.ts";
import {
	createDevTunnelAutomation,
	discoverPublicBaseUrl,
	parseDevTunnelLoginStatus,
} from "../src/resource-adapter.ts";

const result = (stdout: string, exitCode: number | null = 0, stderr = "") => ({
	exitCode,
	stdout,
	stderr,
});

test("CP-DEV-TUNNEL-01 login JSON is authoritative and expired status is not misread from exit 0", async () => {
	assert.equal(
		parseDevTunnelLoginStatus({ status: "Logged in as user@example.test" }),
		"LOGGED_IN",
	);
	assert.equal(
		parseDevTunnelLoginStatus({ status: "Login token expired" }),
		"NOT_LOGGED_IN",
	);
	assert.equal(
		parseDevTunnelLoginStatus({ status: "something new" }),
		"UNKNOWN",
	);

	const calls: string[][] = [];
	const automation = createDevTunnelAutomation({
		runCommand: async (_command, args) => {
			calls.push(args);
			if (args[0] === "--version") return result("1.0.2030");
			if (calls.length === 2)
				return result(JSON.stringify({ status: "Login token expired" }));
			if (calls.length === 3) return result("");
			return result(
				JSON.stringify({ status: "Logged in as user@example.test" }),
			);
		},
	});
	assert.equal(await automation.ensureLogin(), "LOGGED_IN");
	assert.deepEqual(calls, [
		["--version"],
		["user", "show", "--json"],
		["user", "login", "--github", "--use-browser-auth"],
		["user", "show", "--json"],
	]);
});

test("CP-DEV-TUNNEL-01 valid login is reused without opening browser auth", async () => {
	const calls: string[][] = [];
	const automation = createDevTunnelAutomation({
		runCommand: async (_command, args) => {
			calls.push(args);
			if (args[0] === "--version") return result("1.0.2030");
			return result(
				JSON.stringify({ status: "Logged in as user@example.test" }),
			);
		},
	});
	assert.equal(await automation.ensureLogin(), "LOGGED_IN");
	assert.deepEqual(calls, [["--version"], ["user", "show", "--json"]]);
});

test("CP-DEV-TUNNEL-02 automatic creation is anonymous, randomly identified by the provider, and verified by exact show", async () => {
	const calls: string[][] = [];
	const automation = createDevTunnelAutomation({
		runCommand: async (_command, args) => {
			calls.push(args);
			if (args[0] === "create")
				return result(
					JSON.stringify({ tunnelId: "provider-generated", endpoints: [] }),
				);
			return result(
				JSON.stringify({ tunnelId: "provider-generated", endpoints: [] }),
			);
		},
	});
	const tunnelId = await automation.createTunnel();
	assert.equal(tunnelId, "provider-generated");
	assert.deepEqual(calls[0], ["create", "--allow-anonymous", "--json"]);
	assert.deepEqual(await automation.inspectTunnel(tunnelId), {
		state: "EXISTS",
		hostState: "STOPPED",
	});
	assert.deepEqual(calls[1], ["show", "provider-generated", "--json"]);
});

test("CP-DEV-TUNNEL-01 cancelled login and unknown login fail closed", async () => {
	for (const fixture of [
		[
			result(JSON.stringify({ status: "Login required" })),
			result("", 1, "cancelled"),
		],
		[result("not-json")],
	] as const) {
		let index = 0;
		const automation = createDevTunnelAutomation({
			runCommand: async (_command, args) =>
				args[0] === "--version"
					? result("1.0.2030")
					: (fixture[index++] ?? result("not-json")),
		});
		await assert.rejects(() => automation.ensureLogin());
	}
});

test("CP-DEV-TUNNEL-04 port reconciliation is idempotent and bounded", async () => {
	const cases = [
		{
			ports: [{ portNumber: 41705, protocol: "http" }],
			expected: "REUSED",
			expectedMutations: [],
		},
		{
			ports: [],
			expected: "CREATED",
			expectedMutations: [
				[
					"port",
					"create",
					"workspace-tunnel",
					"--port-number",
					"41705",
					"--protocol",
					"http",
					"--json",
				],
			],
		},
		{
			ports: [{ portNumber: 41705, protocol: "auto" }],
			expected: "UPDATED",
			expectedMutations: [
				[
					"port",
					"delete",
					"workspace-tunnel",
					"--port-number",
					"41705",
					"--json",
				],
				[
					"port",
					"create",
					"workspace-tunnel",
					"--port-number",
					"41705",
					"--protocol",
					"http",
					"--json",
				],
			],
		},
	] as const;
	for (const fixture of cases) {
		const calls: string[][] = [];
		const automation = createDevTunnelAutomation({
			runCommand: async (_command, args) => {
				calls.push(args);
				if (args[0] === "port" && args[1] === "list")
					return result(JSON.stringify(fixture.ports));
				return args[1] === "delete"
					? result(JSON.stringify({ deleted: true }))
					: result(JSON.stringify({ portNumber: 41705, protocol: "http" }));
			},
		});
		assert.equal(
			await automation.ensurePort("workspace-tunnel", 41705),
			fixture.expected,
		);
		assert.deepEqual(calls[0], ["port", "list", "workspace-tunnel", "--json"]);
		assert.deepEqual(calls.slice(1), fixture.expectedMutations);
	}
});

test("CP-DEV-TUNNEL-04 protocol drift stops after exact-port delete failure and never claims reconciliation", async () => {
	const calls: string[][] = [];
	const automation = createDevTunnelAutomation({
		runCommand: async (_command, args) => {
			calls.push(args);
			if (args[1] === "list")
				return result(
					JSON.stringify([{ portNumber: 41705, protocol: "auto" }]),
				);
			return result("", 1, "delete failed");
		},
	});
	await assert.rejects(
		() => automation.ensurePort("workspace-tunnel", 41705),
		/port delete/,
	);
	assert.equal(
		calls.some((args) => args[1] === "create"),
		false,
	);
});

test("CP-DEV-TUNNEL-05 public URL discovery selects the current Gateway port and rejects unsafe values", () => {
	const ports = [
		{
			portNumber: 3000,
			protocol: "http",
			portForwardingUris: ["https://other-3000.example.test/"],
		},
		{
			portNumber: 41705,
			protocol: "http",
			portForwardingUris: ["https://current-41705.example.test/"],
		},
	];
	assert.equal(
		discoverPublicBaseUrl(ports, 41705),
		"https://current-41705.example.test/",
	);
	assert.throws(
		() => discoverPublicBaseUrl(ports, 49999),
		/current Gateway port/,
	);
	assert.throws(
		() =>
			discoverPublicBaseUrl(
				[
					{
						portNumber: 41705,
						protocol: "http",
						portForwardingUris: ["http://unsafe.example.test/"],
					},
				],
				41705,
			),
		/HTTPS/,
	);
});

function fakeRuntime(
	calls: string[],
	initial: "RUNNING" | "STOPPED" | "UNKNOWN",
) {
	let state = initial;
	return {
		command: "fixture",
		async status() {
			calls.push("host:status");
			return { state, login: "LOGGED_IN" as const };
		},
		async loginStatus() {
			return "LOGGED_IN" as const;
		},
		publicBaseUrl() {
			return undefined;
		},
		async start() {
			calls.push("host:start");
			state = "RUNNING";
			return { state, login: "LOGGED_IN" as const };
		},
		async stop() {
			state = "STOPPED";
			return { state, login: "LOGGED_IN" as const };
		},
		async restart() {
			return this.start();
		},
	};
}

test("CP-DEV-TUNNEL-03 single-call setup consumes the Gateway-owned endpoint fact", async (t) => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), "proflow-tunnel-auto-"));
	t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
	await writeModuleSharedFacts({ workspaceRoot }, "agent-gateway", {
		localBaseUrl: "http://127.0.0.1:41705",
	});
	const calls: string[] = [];
	const automation = {
		async ensureLogin() {
			calls.push("login");
			return "LOGGED_IN" as const;
		},
		async inspectTunnel(tunnelId: string) {
			assert.equal(tunnelId, "created-tunnel");
			calls.push("tunnel:show:created-tunnel");
			return { state: "EXISTS" as const, hostState: "STOPPED" as const };
		},
		async createTunnel() {
			calls.push("tunnel:create");
			return "created-tunnel";
		},
		async ensurePort(tunnelId: string, port: number) {
			calls.push(`port:${tunnelId}:${port}`);
			return "CREATED" as const;
		},
		async discoverPublicBaseUrl(tunnelId: string, port: number) {
			calls.push(`url:${tunnelId}:${port}`);
			return "https://created-41705.example.test/";
		},
	};
	const adapter = createDevTunnelBehaviorAdapter({
		automation,
		createRuntime: () => fakeRuntime(calls, "UNKNOWN"),
		verifyPublicBaseUrl: async () => {},
	});
	const setup = await adapter.setup({ workspaceRoot });
	assert.equal(setup.result.status, "SUCCEEDED");
	assert.deepEqual(calls, [
		"login",
		"tunnel:create",
		"tunnel:show:created-tunnel",
		"port:created-tunnel:41705",
		"host:status",
		"host:start",
		"url:created-tunnel:41705",
	]);
	const state = JSON.parse(
		await readFile(
			join(
				workspaceRoot,
				".proflow/runtime/external-resources/dev-tunnel/setup.json",
			),
			"utf8",
		),
	);
	assert.deepEqual(state, {
		contract: "proflow.dev-tunnel-setup.v1",
		tunnelId: "created-tunnel",
		publicBaseUrl: "https://created-41705.example.test/",
	});
	assert.deepEqual(
		await readModuleSharedFacts({ workspaceRoot }, "dev-tunnel"),
		{
			tunnelId: "created-tunnel",
			publicBaseUrl: "https://created-41705.example.test/",
		},
	);
	assert.deepEqual(Object.keys(state).sort(), [
		"contract",
		"publicBaseUrl",
		"tunnelId",
	]);
});

test("CP-DEV-TUNNEL-06 repeated setup keeps Tunnel and port identity stable without login or host replay", async (t) => {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-tunnel-idempotent-"),
	);
	t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
	await writeModuleSharedFacts({ workspaceRoot }, "agent-gateway", {
		localBaseUrl: "http://127.0.0.1:41705",
	});
	let createCount = 0;
	let loginChecks = 0;
	let portChecks = 0;
	let hostStarts = 0;
	let hostState: "RUNNING" | "UNKNOWN" = "UNKNOWN";
	const adapter = createDevTunnelBehaviorAdapter({
		automation: {
			async ensureLogin() {
				loginChecks += 1;
				return "LOGGED_IN" as const;
			},
			async inspectTunnel() {
				return { state: "EXISTS" as const, hostState: "STOPPED" as const };
			},
			async createTunnel() {
				createCount += 1;
				return "stable-tunnel";
			},
			async ensurePort() {
				portChecks += 1;
				return portChecks === 1 ? ("CREATED" as const) : ("REUSED" as const);
			},
			async discoverPublicBaseUrl() {
				return "https://stable-41705.example.test/";
			},
		},
		createRuntime: () => ({
			command: "fixture",
			async status() {
				return { state: hostState, login: "LOGGED_IN" as const };
			},
			async loginStatus() {
				return "LOGGED_IN" as const;
			},
			publicBaseUrl() {
				return undefined;
			},
			async start() {
				hostStarts += 1;
				hostState = "RUNNING";
				return { state: hostState, login: "LOGGED_IN" as const };
			},
			async stop() {
				return { state: "STOPPED" as const, login: "LOGGED_IN" as const };
			},
			async restart() {
				return this.start();
			},
		}),
		verifyPublicBaseUrl: async () => {},
	});
	assert.equal(
		(await adapter.setup({ workspaceRoot })).result.status,
		"SUCCEEDED",
	);
	const path = join(
		workspaceRoot,
		".proflow/runtime/external-resources/dev-tunnel/setup.json",
	);
	const firstState = await readFile(path, "utf8");
	assert.equal(
		(await adapter.setup({ workspaceRoot })).result.status,
		"SUCCEEDED",
	);
	assert.equal(await readFile(path, "utf8"), firstState);
	assert.equal(createCount, 1);
	assert.equal(loginChecks, 2);
	assert.equal(portChecks, 2);
	assert.equal(hostStarts, 1);
});

test("CP-DEV-TUNNEL-02 CP-DEV-TUNNEL-07 workspace reuse, remote rebind, and UNKNOWN host fail-closed", async (t) => {
	for (const scenario of [
		{ remote: "EXISTS" as const, expectedTunnel: "workspace-tunnel" },
		{ remote: "MISSING" as const, expectedTunnel: "replacement-tunnel" },
	]) {
		const workspaceRoot = await mkdtemp(
			join(tmpdir(), "proflow-tunnel-reuse-"),
		);
		t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
		await writeModuleSharedFacts({ workspaceRoot }, "agent-gateway", {
			localBaseUrl: "http://127.0.0.1:41705",
		});
		const stateDir = join(
			workspaceRoot,
			".proflow/runtime/external-resources/dev-tunnel",
		);
		await mkdir(stateDir, { recursive: true });
		await writeFile(
			join(stateDir, "setup.json"),
			JSON.stringify({
				contract: "proflow.dev-tunnel-setup.v1",
				tunnelId: "workspace-tunnel",
				publicBaseUrl: "https://old.example.test/",
			}),
		);
		let creates = 0;
		const adapter = createDevTunnelBehaviorAdapter({
			automation: {
				async ensureLogin() {
					return "LOGGED_IN" as const;
				},
				async inspectTunnel(tunnelId: string) {
					if (tunnelId === "replacement-tunnel")
						return { state: "EXISTS" as const, hostState: "STOPPED" as const };
					assert.equal(tunnelId, "workspace-tunnel");
					return scenario.remote === "EXISTS"
						? { state: "EXISTS" as const, hostState: "STOPPED" as const }
						: { state: "MISSING" as const, hostState: "UNKNOWN" as const };
				},
				async createTunnel() {
					creates += 1;
					return "replacement-tunnel";
				},
				async ensurePort() {
					return "REUSED" as const;
				},
				async discoverPublicBaseUrl(tunnelId: string) {
					return `https://${tunnelId}.example.test/`;
				},
			},
			createRuntime: () => fakeRuntime([], "STOPPED"),
			verifyPublicBaseUrl: async () => {},
		});
		assert.equal(
			(await adapter.setup({ workspaceRoot })).result.status,
			"SUCCEEDED",
		);
		assert.equal(creates, scenario.remote === "MISSING" ? 1 : 0);
		const rebound = JSON.parse(
			await readFile(join(stateDir, "setup.json"), "utf8"),
		);
		assert.equal(rebound.tunnelId, scenario.expectedTunnel);
	}

	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-tunnel-unknown-"),
	);
	t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
	await writeModuleSharedFacts({ workspaceRoot }, "agent-gateway", {
		localBaseUrl: "http://127.0.0.1:41705",
	});
	const stateDir = join(
		workspaceRoot,
		".proflow/runtime/external-resources/dev-tunnel",
	);
	await mkdir(stateDir, { recursive: true });
	await writeFile(
		join(stateDir, "setup.json"),
		JSON.stringify({
			contract: "proflow.dev-tunnel-setup.v1",
			tunnelId: "workspace-tunnel",
			publicBaseUrl: "https://old.example.test/",
		}),
	);
	const calls: string[] = [];
	const adapter = createDevTunnelBehaviorAdapter({
		automation: {
			async ensureLogin() {
				return "LOGGED_IN" as const;
			},
			async inspectTunnel() {
				return { state: "EXISTS" as const, hostState: "UNKNOWN" as const };
			},
			async createTunnel() {
				return "unused";
			},
			async ensurePort() {
				return "REUSED" as const;
			},
			async discoverPublicBaseUrl() {
				return "https://unused.example.test/";
			},
		},
		createRuntime: () => fakeRuntime(calls, "UNKNOWN"),
		verifyPublicBaseUrl: async () => {},
	});
	const setup = await adapter.setup({ workspaceRoot });
	assert.equal(setup.result.status, "FAILED");
	assert.equal(calls.includes("host:start"), false);
});

test("missing Gateway producer fact and provisioning failure never write READY state", async (t) => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), "proflow-tunnel-fail-"));
	t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
	const adapter = createDevTunnelBehaviorAdapter({
		automation: {
			async ensureLogin() {
				return "LOGGED_IN" as const;
			},
			async inspectTunnel() {
				return { state: "MISSING" as const, hostState: "UNKNOWN" as const };
			},
			async createTunnel() {
				return "unused";
			},
			async ensurePort() {
				throw new Error("port reconcile failed");
			},
			async discoverPublicBaseUrl() {
				return "https://unused.example.test/";
			},
		},
		createRuntime: () => fakeRuntime([], "STOPPED"),
		verifyPublicBaseUrl: async () => {},
	});
	assert.equal(
		(await adapter.setup({ workspaceRoot })).result.status,
		"FAILED",
	);
	await assert.rejects(() =>
		readFile(
			join(
				workspaceRoot,
				".proflow/runtime/external-resources/dev-tunnel/setup.json",
			),
		),
	);

	const provisionRoot = await mkdtemp(
		join(tmpdir(), "proflow-tunnel-port-fail-"),
	);
	t.after(() => rm(provisionRoot, { recursive: true, force: true }));
	await writeModuleSharedFacts(
		{ workspaceRoot: provisionRoot },
		"agent-gateway",
		{
			localBaseUrl: "http://127.0.0.1:41705",
		},
	);
	const failedProvision = createDevTunnelBehaviorAdapter({
		automation: {
			async ensureLogin() {
				return "LOGGED_IN" as const;
			},
			async inspectTunnel() {
				return { state: "EXISTS" as const, hostState: "STOPPED" as const };
			},
			async createTunnel() {
				return "created-but-not-ready";
			},
			async ensurePort() {
				throw new Error("port reconcile failed");
			},
			async discoverPublicBaseUrl() {
				return "https://unused.example.test/";
			},
		},
		createRuntime: () => fakeRuntime([], "STOPPED"),
		verifyPublicBaseUrl: async () => {},
	});
	assert.equal(
		(await failedProvision.setup({ workspaceRoot: provisionRoot })).result
			.status,
		"FAILED",
	);
	await assert.rejects(() =>
		readFile(
			join(
				provisionRoot,
				".proflow/runtime/external-resources/dev-tunnel/setup.json",
			),
		),
	);
});

test("CP-DEV-TUNNEL-01 failed browser login performs no Tunnel mutation", async (t) => {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-tunnel-login-fail-"),
	);
	t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
	await writeModuleSharedFacts({ workspaceRoot }, "agent-gateway", {
		localBaseUrl: "http://127.0.0.1:41705",
	});
	let createCount = 0;
	const adapter = createDevTunnelBehaviorAdapter({
		automation: {
			async ensureLogin() {
				throw new Error("GitHub browser authentication failed");
			},
			async inspectTunnel() {
				assert.fail("Tunnel inspection must not run after login failure");
			},
			async createTunnel() {
				createCount += 1;
				return "must-not-exist";
			},
			async ensurePort() {
				assert.fail("port mutation must not run after login failure");
			},
			async discoverPublicBaseUrl() {
				assert.fail("URL discovery must not run after login failure");
			},
		},
		createRuntime: () => fakeRuntime([], "UNKNOWN"),
		verifyPublicBaseUrl: async () => {},
	});
	assert.equal(
		(await adapter.setup({ workspaceRoot })).result.status,
		"FAILED",
	);
	assert.equal(createCount, 0);
});
