import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	moduleStatusObservationSchema,
	readModuleSharedFacts,
	writeModuleSharedFacts,
} from "@tomflow/proflow-module-contract";
import {
	createDevTunnelBehaviorAdapter,
	workspaceTunnelId,
} from "../deployment/adapter.ts";
import {
	createDevTunnelAutomation,
	createDevTunnelRuntime,
	discoverPublicBaseUrl,
	parseDevTunnelLoginStatus,
} from "../src/resource-adapter.ts";

const result = (stdout: string, exitCode: number | null = 0, stderr = "") => ({
	exitCode,
	stdout,
	stderr,
});

test("CP-DEV-TUNNEL-01 login JSON is authoritative and logged-out statuses are not misread from exit 0", async () => {
	assert.equal(
		parseDevTunnelLoginStatus({ status: "Logged in as user@example.test" }),
		"LOGGED_IN",
	);
	assert.equal(
		parseDevTunnelLoginStatus({ status: "Login token expired" }),
		"AUTH_EXPIRED",
	);
	assert.equal(
		parseDevTunnelLoginStatus({ status: "Not logged in" }),
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
			if (calls.length === 1)
				return result(JSON.stringify({ status: "Login token expired" }));
			if (calls.length === 2) return result("");
			return result(
				JSON.stringify({ status: "Logged in as user@example.test" }),
			);
		},
	});
	assert.equal(await automation.ensureLogin(), "LOGGED_IN");
	assert.deepEqual(calls, [
		["user", "show", "--json"],
		["user", "login", "--github", "--use-browser-auth"],
		["user", "show", "--json"],
	]);
});

test("CP-DEV-TUNNEL-01 runtime login probe preserves actionable failure classification", async () => {
	for (const fixture of [
		{ value: result("", 3, "Login token expired."), expected: "AUTH_EXPIRED" },
		{
			value: result(JSON.stringify({ status: "Login required" })),
			expected: "NOT_LOGGED_IN",
		},
		{ value: result("", null, "command timed out"), expected: "QUERY_TIMEOUT" },
		{ value: result("", 3, "service unavailable"), expected: "CLI_ERROR" },
	] as const) {
		const runtime = createDevTunnelRuntime({
			tunnelId: "fixture-tunnel",
			runCommand: async () => fixture.value,
		});
		assert.equal(await runtime.loginStatus(), fixture.expected);
	}
});

test("CP-DEV-TUNNEL-01 missing managed CLI is CLI_ERROR, never QUERY_TIMEOUT", async () => {
	const runtime = createDevTunnelRuntime({
		command: "/definitely/missing/proflow-managed-devtunnel",
		tunnelId: "fixture-tunnel",
	});
	assert.equal(await runtime.loginStatus(), "CLI_ERROR");
});

test("Module.install materializes the managed Dev Tunnel CLI after package replacement", async (context) => {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-dev-tunnel-install-cli-"),
	);
	context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
	const calls: string[] = [];
	const adapter = createDevTunnelBehaviorAdapter({
		resolveCli: async (root) => {
			calls.push(root);
			return "/fixture/managed/devtunnel";
		},
	});
	const installed = await adapter.install({ workspaceRoot });
	assert.equal(installed.result.status, "SUCCEEDED");
	assert.deepEqual(calls, [workspaceRoot]);
});

test("CP-DEV-TUNNEL-01 valid login is reused without opening browser auth", async () => {
	const calls: string[][] = [];
	const timeouts: Array<number | undefined> = [];
	const automation = createDevTunnelAutomation({
		runCommand: async (_command, args, options) => {
			calls.push(args);
			timeouts.push(options?.timeoutMs);
			return result(
				JSON.stringify({ status: "Logged in as user@example.test" }),
			);
		},
	});
	assert.equal(await automation.ensureLogin(), "LOGGED_IN");
	assert.deepEqual(calls, [["user", "show", "--json"]]);
	assert.deepEqual(timeouts, [90_000]);
});

test("CP-DEV-TUNNEL-01 post-browser login confirmation allows a slower authoritative user show", async () => {
	const calls: string[][] = [];
	const timeouts: Array<number | undefined> = [];
	const automation = createDevTunnelAutomation({
		runCommand: async (_command, args, options) => {
			calls.push(args);
			timeouts.push(options?.timeoutMs);
			if (calls.length === 1)
				return result(JSON.stringify({ status: "Login token expired" }));
			if (calls.length === 2) return result("");
			if ((options?.timeoutMs ?? 0) < 61_000)
				return result("", null, "command timed out");
			return result(JSON.stringify({ status: "Logged in as test" }));
		},
	});
	assert.equal(await automation.ensureLogin(), "LOGGED_IN");
	assert.deepEqual(calls, [
		["user", "show", "--json"],
		["user", "login", "--github", "--use-browser-auth"],
		["user", "show", "--json"],
	]);
	assert.deepEqual(timeouts, [90_000, 600_000, 90_000]);
});

test("CP-DEV-TUNNEL-01 timed-out primary login probe consumes conclusive JSON before verbose fallback", async () => {
	const calls: string[][] = [];
	const timeouts: Array<number | undefined> = [];
	const automation = createDevTunnelAutomation({
		runCommand: async (_command, args, options) => {
			calls.push(args);
			timeouts.push(options?.timeoutMs);
			if (calls.length === 1)
				return result(
					JSON.stringify({ status: "Login token expired" }),
					null,
					"command timed out",
				);
			if (calls.length === 2) return result("");
			return result(JSON.stringify({ status: "Logged in as test" }));
		},
	});
	assert.equal(await automation.ensureLogin(), "LOGGED_IN");
	assert.deepEqual(calls, [
		["user", "show", "--json"],
		["user", "login", "--github", "--use-browser-auth"],
		["user", "show", "--json"],
	]);
	assert.deepEqual(timeouts, [90_000, 600_000, 90_000]);
});

test("CP-DEV-TUNNEL-01 timed-out login probe uses explicit expired-token evidence for one browser re-auth", async () => {
	const calls: string[][] = [];
	const timeouts: Array<number | undefined> = [];
	const automation = createDevTunnelAutomation({
		runCommand: async (_command, args, options) => {
			calls.push(args);
			timeouts.push(options?.timeoutMs);
			if (calls.length === 1) return result("", null, "command timed out");
			if (calls.length === 2)
				return result(
					"",
					null,
					"Loaded cached GitHub tokens for account(s): test\nThe cached access token for GitHub account 'test' expired at 2026-09-01T21:29:54\ncommand timed out",
				);
			if (calls.length === 3) return result("");
			return result(JSON.stringify({ status: "Logged in as test" }));
		},
	});
	assert.equal(await automation.ensureLogin(), "LOGGED_IN");
	assert.deepEqual(calls, [
		["user", "show", "--json"],
		["-v", "user", "show", "--json"],
		["user", "login", "--github", "--use-browser-auth"],
		["user", "show", "--json"],
	]);
	assert.deepEqual(timeouts, [90_000, 8_000, 600_000, 90_000]);
});

test("CP-DEV-TUNNEL-02 automatic creation uses the precomputed workspace Tunnel identity", async () => {
	const calls: string[][] = [];
	const automation = createDevTunnelAutomation({
		runCommand: async (_command, args) => {
			calls.push(args);
			return result(
				JSON.stringify({
					tunnel: {
						tunnelId: "proflow-stable.jpe1",
						endpoints: [],
					},
				}),
			);
		},
	});
	const tunnelId = await automation.createTunnel("proflow-stable");
	assert.equal(tunnelId, "proflow-stable");
	assert.deepEqual(calls[0], [
		"create",
		"proflow-stable",
		"--allow-anonymous",
		"--json",
	]);
	assert.deepEqual(await automation.inspectTunnel(tunnelId), {
		state: "EXISTS",
		hostState: "STOPPED",
	});
	assert.deepEqual(calls[1], ["show", "proflow-stable", "--json"]);
});

test("cluster suffix matching does not accept a different Tunnel identity", async () => {
	const automation = createDevTunnelAutomation({
		runCommand: async () =>
			result(JSON.stringify({ tunnel: { tunnelId: "proflow-other.jpe1" } })),
	});
	await assert.rejects(
		() => automation.createTunnel("proflow-stable"),
		/unexpected tunnelId/,
	);
	assert.deepEqual(await automation.inspectTunnel("proflow-stable"), {
		state: "UNKNOWN",
		hostState: "UNKNOWN",
	});
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
			runCommand: async () => fixture[index++] ?? result("not-json"),
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

test("Dev Tunnel read-only port query retries one timeout with a wider bounded window", async () => {
	const calls: Array<{ args: string[]; timeoutMs: number | undefined }> = [];
	let attempt = 0;
	const automation = createDevTunnelAutomation({
		runCommand: async (_command, args, options) => {
			calls.push({ args, timeoutMs: options?.timeoutMs });
			attempt += 1;
			if (attempt === 1) return result("", null, "command timed out");
			return result(JSON.stringify([{ portNumber: 41705, protocol: "http" }]));
		},
	});
	assert.equal(
		await automation.ensurePort("workspace-tunnel", 41705),
		"REUSED",
	);
	assert.equal(calls.length, 2);
	assert.deepEqual(
		calls.map((call) => call.args),
		[
			["port", "list", "workspace-tunnel", "--json"],
			["port", "list", "workspace-tunnel", "--json"],
		],
	);
	assert.deepEqual(
		calls.map((call) => call.timeoutMs),
		[45_000, 45_000],
	);
});

test("Dev Tunnel CLI warning-only no-ports JSON is treated as an empty port list", async () => {
	const calls: string[][] = [];
	const automation = createDevTunnelAutomation({
		runCommand: async (_command, args) => {
			calls.push(args);
			if (args[0] === "port" && args[1] === "list")
				return result(
					JSON.stringify({ warning: "No ports found for tunnel fixture" }),
				);
			return result(JSON.stringify({ portNumber: 41705, protocol: "http" }));
		},
	});
	assert.equal(await automation.ensurePort("fixture", 41705), "CREATED");
	assert.equal(
		calls.some((args) => args[1] === "create"),
		true,
	);
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
	const stableTunnel = workspaceTunnelId(workspaceRoot);
	const calls: string[] = [];
	let exists = false;
	const automation = {
		async ensureLogin() {
			calls.push("login");
			return "LOGGED_IN" as const;
		},
		async inspectTunnel(tunnelId: string) {
			assert.equal(tunnelId, stableTunnel);
			calls.push(`tunnel:show:${tunnelId}`);
			return exists
				? { state: "EXISTS" as const, hostState: "STOPPED" as const }
				: { state: "MISSING" as const, hostState: "UNKNOWN" as const };
		},
		async createTunnel(tunnelId: string) {
			assert.equal(tunnelId, stableTunnel);
			calls.push(`tunnel:create:${tunnelId}`);
			exists = true;
			return tunnelId;
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
		`tunnel:show:${stableTunnel}`,
		`tunnel:create:${stableTunnel}`,
		`tunnel:show:${stableTunnel}`,
		`port:${stableTunnel}:41705`,
		"host:status",
		"host:start",
		`url:${stableTunnel}:41705`,
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
		contract: "proflow.dev-tunnel-setup.v2",
		tunnelId: stableTunnel,
		phase: "READY",
		gatewayPort: 41705,
		publicBaseUrl: "https://created-41705.example.test/",
	});
	assert.deepEqual(
		await readModuleSharedFacts({ workspaceRoot }, "dev-tunnel"),
		{
			tunnelId: stableTunnel,
			publicBaseUrl: "https://created-41705.example.test/",
		},
	);
	assert.deepEqual(Object.keys(state).sort(), [
		"contract",
		"gatewayPort",
		"phase",
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
	let remoteExists = false;
	const stableTunnel = workspaceTunnelId(workspaceRoot);
	const adapter = createDevTunnelBehaviorAdapter({
		automation: {
			async ensureLogin() {
				loginChecks += 1;
				return "LOGGED_IN" as const;
			},
			async inspectTunnel(tunnelId: string) {
				assert.equal(tunnelId, stableTunnel);
				return remoteExists
					? { state: "EXISTS" as const, hostState: "STOPPED" as const }
					: { state: "MISSING" as const, hostState: "UNKNOWN" as const };
			},
			async createTunnel(tunnelId: string) {
				assert.equal(tunnelId, stableTunnel);
				createCount += 1;
				remoteExists = true;
				return tunnelId;
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
		{ remote: "MISSING" as const, expectedTunnel: undefined },
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
		const stableTunnel = workspaceTunnelId(workspaceRoot);
		let stableExists = false;
		const adapter = createDevTunnelBehaviorAdapter({
			automation: {
				async ensureLogin() {
					return "LOGGED_IN" as const;
				},
				async inspectTunnel(tunnelId: string) {
					if (tunnelId === "workspace-tunnel")
						return scenario.remote === "EXISTS"
							? { state: "EXISTS" as const, hostState: "STOPPED" as const }
							: { state: "MISSING" as const, hostState: "UNKNOWN" as const };
					assert.equal(tunnelId, stableTunnel);
					return stableExists
						? { state: "EXISTS" as const, hostState: "STOPPED" as const }
						: { state: "MISSING" as const, hostState: "UNKNOWN" as const };
				},
				async createTunnel(tunnelId: string) {
					assert.equal(tunnelId, stableTunnel);
					creates += 1;
					stableExists = true;
					return tunnelId;
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
		assert.equal(rebound.tunnelId, scenario.expectedTunnel ?? stableTunnel);
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

test("missing Gateway writes no state while post-create failure persists recoverable PENDING state", async (t) => {
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
	let failedProvisionExists = false;
	const failedProvisionTunnel = workspaceTunnelId(provisionRoot);
	const failedProvision = createDevTunnelBehaviorAdapter({
		automation: {
			async ensureLogin() {
				return "LOGGED_IN" as const;
			},
			async inspectTunnel(tunnelId: string) {
				assert.equal(tunnelId, failedProvisionTunnel);
				return failedProvisionExists
					? { state: "EXISTS" as const, hostState: "STOPPED" as const }
					: { state: "MISSING" as const, hostState: "UNKNOWN" as const };
			},
			async createTunnel(tunnelId: string) {
				assert.equal(tunnelId, failedProvisionTunnel);
				failedProvisionExists = true;
				return tunnelId;
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
	assert.deepEqual(
		JSON.parse(
			await readFile(
				join(
					provisionRoot,
					".proflow/runtime/external-resources/dev-tunnel/setup.json",
				),
				"utf8",
			),
		),
		{
			contract: "proflow.dev-tunnel-setup.v2",
			tunnelId: failedProvisionTunnel,
			phase: "PENDING_CREATED",
			gatewayPort: 41705,
		},
	);
});

test("a created Tunnel is persisted as PENDING and reused after port reconciliation fails", async (t) => {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-tunnel-pending-"),
	);
	t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
	await writeModuleSharedFacts({ workspaceRoot }, "agent-gateway", {
		localBaseUrl: "http://127.0.0.1:41705",
	});
	let creates = 0;
	let portAttempts = 0;
	let pendingExists = false;
	const pendingTunnel = workspaceTunnelId(workspaceRoot);
	const adapter = createDevTunnelBehaviorAdapter({
		automation: {
			async ensureLogin() {
				return "LOGGED_IN" as const;
			},
			async inspectTunnel(tunnelId: string) {
				assert.equal(tunnelId, pendingTunnel);
				return pendingExists
					? { state: "EXISTS" as const, hostState: "STOPPED" as const }
					: { state: "MISSING" as const, hostState: "UNKNOWN" as const };
			},
			async createTunnel(tunnelId: string) {
				assert.equal(tunnelId, pendingTunnel);
				creates += 1;
				pendingExists = true;
				return tunnelId;
			},
			async ensurePort() {
				portAttempts += 1;
				if (portAttempts === 1) throw new Error("port reconcile failed");
				return "CREATED" as const;
			},
			async discoverPublicBaseUrl() {
				return "https://pending.example.test/";
			},
		},
		createRuntime: () => fakeRuntime([], "STOPPED"),
		verifyPublicBaseUrl: async () => {},
	});
	assert.equal(
		(await adapter.setup({ workspaceRoot })).result.status,
		"FAILED",
	);
	const pending = JSON.parse(
		await readFile(
			join(
				workspaceRoot,
				".proflow/runtime/external-resources/dev-tunnel/setup.json",
			),
			"utf8",
		),
	);
	assert.equal(pending.phase, "PENDING_CREATED");
	assert.equal(pending.tunnelId, pendingTunnel);
	assert.equal(
		(await adapter.setup({ workspaceRoot })).result.status,
		"SUCCEEDED",
	);
	assert.equal(creates, 1);
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

test("dev-tunnel status blocks production start preflight with explicit auth diagnosis", async (t) => {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-tunnel-auth-status-"),
	);
	t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
	const dir = join(
		workspaceRoot,
		".proflow/runtime/external-resources/dev-tunnel",
	);
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, "setup.json"),
		JSON.stringify({
			contract: "proflow.dev-tunnel-setup.v2",
			tunnelId: "tunnel-auth",
			phase: "READY",
			gatewayPort: 41705,
			publicBaseUrl: "https://auth.example.test/",
		}),
	);
	for (const fixture of [
		{
			login: "AUTH_EXPIRED" as const,
			setupStatus: "ACTION_REQUIRED",
			code: "TUNNEL_AUTH_EXPIRED",
		},
		{
			login: "NOT_LOGGED_IN" as const,
			setupStatus: "ACTION_REQUIRED",
			code: "TUNNEL_LOGIN_REQUIRED",
		},
		{
			login: "QUERY_TIMEOUT" as const,
			setupStatus: "BLOCKED",
			code: "TUNNEL_LOGIN_QUERY_TIMEOUT",
		},
		{
			login: "CLI_ERROR" as const,
			setupStatus: "BLOCKED",
			code: "TUNNEL_LOGIN_CHECK_FAILED",
		},
	] as const) {
		const adapter = createDevTunnelBehaviorAdapter({
			createRuntime: () => ({
				command: "fixture",
				async status() {
					return { state: "UNKNOWN" as const, login: "UNKNOWN" as const };
				},
				async loginStatus() {
					return fixture.login;
				},
				publicBaseUrl() {
					return "https://auth.example.test/";
				},
				async start() {
					return { state: "UNKNOWN" as const, login: fixture.login };
				},
				async stop() {
					return { state: "STOPPED" as const, login: fixture.login };
				},
				async restart() {
					return this.start();
				},
			}),
		});
		const status = await adapter.status({ workspaceRoot });
		const data = status.result.data as {
			setupStatus: string;
			runtimeStatus: string;
			issues?: Array<{ scope: string; code: string; message: string }>;
		};
		assert.doesNotThrow(() => moduleStatusObservationSchema.parse(data));
		assert.equal(data.setupStatus, fixture.setupStatus);
		assert.equal(data.runtimeStatus, "FAILED");
		assert.equal(data.issues?.[0]?.code, fixture.code);
		assert.equal(
			data.issues?.some((issue) => issue.scope === "RUNTIME"),
			true,
		);
	}

	const expiredStart = createDevTunnelBehaviorAdapter({
		resolveCli: async () => "/managed/devtunnel",
		createRuntime: () => ({
			command: "fixture",
			async status() {
				return { state: "UNKNOWN" as const, login: "UNKNOWN" as const };
			},
			async loginStatus() {
				return "AUTH_EXPIRED" as const;
			},
			publicBaseUrl() {
				return "https://auth.example.test/";
			},
			async start() {
				return { state: "UNKNOWN" as const, login: "AUTH_EXPIRED" as const };
			},
			async stop() {
				return { state: "STOPPED" as const, login: "AUTH_EXPIRED" as const };
			},
			async restart() {
				return this.start();
			},
		}),
		verifyPublicBaseUrl: async () => {},
	});
	const started = await expiredStart.start({ workspaceRoot });
	assert.equal(started.result.status, "FAILED");
	assert.equal(started.result.error?.code, "START_FAILED");
	assert.match(started.result.error?.message ?? "", /^AUTH_EXPIRED:/);
});

test("dev-tunnel start waits for public ingress readiness and cleans failed host", async (t) => {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-tunnel-start-ready-"),
	);
	t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
	const dir = join(
		workspaceRoot,
		".proflow/runtime/external-resources/dev-tunnel",
	);
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, "setup.json"),
		JSON.stringify({
			contract: "proflow.dev-tunnel-setup.v2",
			tunnelId: "tunnel-ready",
			phase: "READY",
			gatewayPort: 41705,
			publicBaseUrl: "https://ready.example.test/",
		}),
	);
	let starts = 0;
	let stops = 0;
	const runtime = {
		command: "fixture",
		async status() {
			return { state: "STOPPED" as const, login: "LOGGED_IN" as const };
		},
		async loginStatus() {
			return "LOGGED_IN" as const;
		},
		publicBaseUrl() {
			return "https://ready.example.test/";
		},
		async start() {
			starts += 1;
			return { state: "RUNNING" as const, login: "LOGGED_IN" as const };
		},
		async stop() {
			stops += 1;
			return { state: "STOPPED" as const, login: "LOGGED_IN" as const };
		},
		async restart() {
			return this.start();
		},
	};
	let verifications = 0;
	const runtimeCommands: string[] = [];
	let resolves = 0;
	const ready = createDevTunnelBehaviorAdapter({
		resolveCli: async (root) => {
			resolves += 1;
			assert.equal(root, workspaceRoot);
			return "/managed/devtunnel";
		},
		createRuntime: (input) => {
			runtimeCommands.push(input.command ?? "");
			return runtime;
		},
		verifyPublicBaseUrl: async (url) => {
			verifications += 1;
			assert.equal(url, "https://ready.example.test/");
		},
	});
	assert.equal(
		(await ready.start({ workspaceRoot })).result.status,
		"SUCCEEDED",
	);
	assert.equal(starts, 1);
	assert.equal(resolves, 1);
	assert.deepEqual(runtimeCommands, ["/managed/devtunnel"]);
	assert.equal(verifications, 1);
	assert.equal(stops, 0);
	const failing = createDevTunnelBehaviorAdapter({
		resolveCli: async () => "/managed/devtunnel",
		createRuntime: () => runtime,
		verifyPublicBaseUrl: async () => {
			throw new Error("public ingress not ready");
		},
	});
	const failed = await failing.start({ workspaceRoot });
	assert.equal(failed.result.status, "FAILED");
	assert.match(failed.result.error?.message ?? "", /public ingress not ready/);
	assert.equal(starts, 2);
	assert.equal(stops, 1);
});
