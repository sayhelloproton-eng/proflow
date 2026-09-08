import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	type ModuleCommandContext,
	readModuleSharedFacts,
	writeModuleSharedFacts,
} from "@tomflow/proflow-module-contract";
import { devTunnelCliPath, resolveDevTunnelCli } from "../src/cli-resolver.ts";
import {
	createDevTunnelAutomation,
	createDevTunnelRuntime,
	type DevTunnelAutomation,
	type DevTunnelLoginStatus,
	type DevTunnelRuntime,
	verifyProvisionedPublicBaseUrl,
} from "../src/resource-adapter.ts";
import { descriptor } from "./descriptor.ts";

const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;
const processEffect = "Manage the dev-tunnel public ingress process";

function loginFailureMessage(login: DevTunnelLoginStatus): string {
	switch (login) {
		case "AUTH_EXPIRED":
			return "AUTH_EXPIRED: Microsoft Dev Tunnel login token expired";
		case "NOT_LOGGED_IN":
			return "NOT_LOGGED_IN: Microsoft Dev Tunnel login is required";
		case "QUERY_TIMEOUT":
			return "QUERY_TIMEOUT: Microsoft Dev Tunnel login status query timed out";
		case "CLI_ERROR":
			return "CLI_ERROR: Microsoft Dev Tunnel login status check failed";
		default:
			return "UNKNOWN: Microsoft Dev Tunnel login status is unknown";
	}
}

function runtimeFailureIssue(login: DevTunnelLoginStatus) {
	switch (login) {
		case "AUTH_EXPIRED":
			return {
				scope: "SETUP" as const,
				code: "TUNNEL_AUTH_EXPIRED",
				message: "Microsoft Dev Tunnel login token expired",
				relatedModuleRefs: [],
				nextCommand: "platform setup --module dev-tunnel",
			};
		case "NOT_LOGGED_IN":
			return {
				scope: "SETUP" as const,
				code: "TUNNEL_LOGIN_REQUIRED",
				message: "Microsoft Dev Tunnel login is required",
				relatedModuleRefs: [],
				nextCommand: "platform setup --module dev-tunnel",
			};
		case "QUERY_TIMEOUT":
			return {
				scope: "RUNTIME" as const,
				code: "TUNNEL_LOGIN_QUERY_TIMEOUT",
				message: "Microsoft Dev Tunnel login status query timed out",
				relatedModuleRefs: [],
				nextCommand: "platform status",
			};
		case "CLI_ERROR":
			return {
				scope: "RUNTIME" as const,
				code: "TUNNEL_LOGIN_CHECK_FAILED",
				message: "Microsoft Dev Tunnel login status check failed",
				relatedModuleRefs: [],
				nextCommand: "platform status",
			};
		default:
			return {
				scope: "RUNTIME" as const,
				code: "TUNNEL_RUNTIME_FAILED",
				message: "Tunnel 运行状态检查失败",
				relatedModuleRefs: [],
				nextCommand: "platform status",
			};
	}
}

type SetupPhase = "PENDING_CREATED" | "PORT_READY" | "HOST_READY" | "READY";
type SetupState = {
	contract: "proflow.dev-tunnel-setup.v2";
	tunnelId: string;
	phase: SetupPhase;
	gatewayPort?: number;
	publicBaseUrl?: string;
};
const stateDir = (context: ModuleCommandContext) =>
	join(
		resolve(context.workspaceRoot),
		".proflow",
		"runtime",
		"external-resources",
		"dev-tunnel",
	);
const stateFile = (context: ModuleCommandContext) =>
	join(stateDir(context), "setup.json");
const processFile = (context: ModuleCommandContext) =>
	join(stateDir(context), "process.json");
async function readState(
	context: ModuleCommandContext,
): Promise<SetupState | undefined> {
	try {
		const raw = JSON.parse(
			await readFile(stateFile(context), "utf8"),
		) as Record<string, unknown>;
		if (typeof raw.tunnelId !== "string" || !raw.tunnelId) return undefined;
		if (
			raw.contract === "proflow.dev-tunnel-setup.v1" &&
			typeof raw.publicBaseUrl === "string"
		) {
			const url = new URL(raw.publicBaseUrl);
			if (url.protocol !== "https:") return undefined;
			return {
				contract: "proflow.dev-tunnel-setup.v2",
				tunnelId: raw.tunnelId,
				phase: "READY",
				publicBaseUrl: url.href,
			};
		}
		if (raw.contract !== "proflow.dev-tunnel-setup.v2") return undefined;
		if (
			raw.phase !== "PENDING_CREATED" &&
			raw.phase !== "PORT_READY" &&
			raw.phase !== "HOST_READY" &&
			raw.phase !== "READY"
		)
			return undefined;
		const gatewayPort = raw.gatewayPort;
		if (
			gatewayPort !== undefined &&
			(!Number.isInteger(gatewayPort) ||
				Number(gatewayPort) < 1 ||
				Number(gatewayPort) > 65_535)
		)
			return undefined;
		const publicBaseUrl = raw.publicBaseUrl;
		if (raw.phase === "READY") {
			if (typeof publicBaseUrl !== "string") return undefined;
			const url = new URL(publicBaseUrl);
			if (url.protocol !== "https:") return undefined;
		}
		return {
			contract: "proflow.dev-tunnel-setup.v2",
			tunnelId: raw.tunnelId,
			phase: raw.phase,
			...(typeof gatewayPort === "number" ? { gatewayPort } : {}),
			...(typeof publicBaseUrl === "string" ? { publicBaseUrl } : {}),
		};
	} catch {
		return undefined;
	}
}
async function writeState(
	context: ModuleCommandContext,
	state: SetupState,
): Promise<void> {
	await mkdir(stateDir(context), { recursive: true, mode: 0o700 });
	const tmp = `${stateFile(context)}.${process.pid}.tmp`;
	await writeFile(
		tmp,
		`${JSON.stringify(state, null, 2)}
`,
		{ encoding: "utf8", mode: 0o600 },
	);
	await rename(tmp, stateFile(context));
}
function runtime(context: ModuleCommandContext, state?: SetupState) {
	return createDevTunnelRuntime({
		command: devTunnelCliPath(),
		...(state
			? { tunnelId: state.tunnelId, publicBaseUrl: state.publicBaseUrl }
			: {}),
		processStateFile: processFile(context),
	});
}
type RuntimeFactory = (input: {
	command?: string;
	tunnelId?: string;
	publicBaseUrl?: string;
	processStateFile?: string;
	loginVerified?: boolean;
}) => DevTunnelRuntime;

async function observeStatus(
	context: ModuleCommandContext,
	createRuntime: RuntimeFactory,
) {
	const state = await readState(context);
	if (!state) {
		return {
			result: {
				...base,
				data: {
					setupStatus: "ACTION_REQUIRED" as const,
					runtimeStatus: "STOPPED" as const,
					issues: [
						{
							scope: "SETUP" as const,
							code: "TUNNEL_SETUP_REQUIRED",
							message: "尚未完成持久 Tunnel 自动配置",
							relatedModuleRefs: [],
							nextCommand: "platform setup",
						},
					],
				},
			},
			observedEffects: [],
		};
	}
	const configured =
		state.phase === "READY" && typeof state.publicBaseUrl === "string";
	const rt = createRuntime({
		command: devTunnelCliPath(),
		tunnelId: state.tunnelId,
		...(state.publicBaseUrl === undefined
			? {}
			: { publicBaseUrl: state.publicBaseUrl }),
		processStateFile: processFile(context),
	});
	const observed = await rt.status();
	const login =
		configured && observed.state !== "RUNNING"
			? await rt.loginStatus()
			: observed.login;
	const runtimeStatus =
		observed.state === "RUNNING"
			? ("RUNNING" as const)
			: observed.state === "STOPPED"
				? ("STOPPED" as const)
				: configured
					? ("FAILED" as const)
					: ("STOPPED" as const);
	const authActionRequired =
		login === "AUTH_EXPIRED" || login === "NOT_LOGGED_IN";
	const authBlocked = login === "QUERY_TIMEOUT" || login === "CLI_ERROR";
	const setupStatus = !configured
		? ("ACTION_REQUIRED" as const)
		: authActionRequired
			? ("ACTION_REQUIRED" as const)
			: authBlocked
				? ("BLOCKED" as const)
				: ("READY" as const);
	return {
		result: {
			...base,
			data: {
				setupStatus,
				runtimeStatus,
				...(!configured || runtimeStatus === "FAILED"
					? {
							issues: [
								...(!configured
									? [
											{
												scope: "SETUP" as const,
												code: "TUNNEL_SETUP_INCOMPLETE",
												message: `远程连接配置已保存，当前阶段 ${state.phase}；重新运行 Platform setup 将从此处恢复`,
												relatedModuleRefs: [],
												nextCommand: "platform setup",
											},
										]
									: []),
								...(runtimeStatus === "FAILED"
									? [runtimeFailureIssue(login)]
									: []),
							],
						}
					: {}),
			},
		},
		observedEffects: [],
	};
}

const baseBehaviorAdapter = {
	install: async (context: ModuleCommandContext) => {
		await mkdir(stateDir(context), { recursive: true, mode: 0o700 });
		const state = await readState(context);
		if (state?.phase === "READY" && state.publicBaseUrl)
			await writeModuleSharedFacts(context, descriptor.moduleRef, {
				tunnelId: state.tunnelId,
				publicBaseUrl: state.publicBaseUrl,
			});
		return { result: base, observedEffects: [] };
	},
	uninstall: async (context: ModuleCommandContext) => {
		const state = await readState(context);
		if (!state) return { result: base, observedEffects: [] };
		try {
			const stopped = await runtime(context, state).stop();
			return stopped.state === "STOPPED"
				? { result: base, observedEffects: [processEffect] }
				: {
						result: {
							...base,
							ok: false as const,
							status: "FAILED" as const,
							error: {
								code: "UNINSTALL_FAILED" as const,
								message: "dev-tunnel stop state is UNKNOWN",
								retryable: true,
							},
						},
						observedEffects: [],
					};
		} catch (error) {
			return {
				result: {
					...base,
					ok: false as const,
					status: "FAILED" as const,
					error: {
						code: "UNINSTALL_FAILED" as const,
						message:
							error instanceof Error
								? error.message
								: "failed to stop dev-tunnel",
						retryable: true,
					},
				},
				observedEffects: [],
			};
		}
	},
	status: async (context: ModuleCommandContext) =>
		observeStatus(context, createDevTunnelRuntime),
	docs: async (_context: ModuleCommandContext) => ({
		result: {
			...base,
			data: {
				docs: readFileSync(
					new URL(
						import.meta.url.includes("/dist/") ? "../../DOCS.md" : "../DOCS.md",
						import.meta.url,
					),
					"utf8",
				),
			},
		},
		observedEffects: [],
	}),
	start: async (context: ModuleCommandContext) => {
		const state = await readState(context);
		if (state?.phase !== "READY" || !state.publicBaseUrl)
			return {
				result: {
					...base,
					ok: false as const,
					status: "FAILED" as const,
					error: {
						code: "START_FAILED" as const,
						message: "dev-tunnel setup is not READY",
						retryable: true,
					},
				},
				observedEffects: [],
			};
		const rt = runtime(context, state);
		try {
			const observed = await rt.start();
			if (observed.login !== "LOGGED_IN")
				return {
					result: {
						...base,
						ok: false as const,
						status: "FAILED" as const,
						error: {
							code: "START_FAILED" as const,
							message: "Microsoft Dev Tunnel login is not ready",
							retryable: true,
						},
					},
					observedEffects: [],
				};
			return observed.state === "RUNNING"
				? {
						result: { ...base, data: observed },
						observedEffects: [processEffect],
					}
				: {
						result: {
							...base,
							ok: false as const,
							status: "FAILED" as const,
							error: {
								code: "START_FAILED" as const,
								message: "dev-tunnel did not reach RUNNING",
								retryable: true,
							},
						},
						observedEffects: [],
					};
		} catch (error) {
			return {
				result: {
					...base,
					ok: false as const,
					status: "FAILED" as const,
					error: {
						code: "START_FAILED" as const,
						message:
							error instanceof Error
								? error.message
								: "failed to start dev-tunnel",
						retryable: true,
					},
				},
				observedEffects: [],
			};
		}
	},
	stop: async (context: ModuleCommandContext) => {
		const state = await readState(context);
		if (!state) return { result: base, observedEffects: [] };
		try {
			const observed = await runtime(context, state).stop();
			return observed.state === "STOPPED"
				? { result: base, observedEffects: [processEffect] }
				: {
						result: {
							...base,
							ok: false as const,
							status: "FAILED" as const,
							error: {
								code: "STOP_FAILED" as const,
								message: "dev-tunnel stop state is UNKNOWN",
								retryable: true,
							},
						},
						observedEffects: [],
					};
		} catch (error) {
			return {
				result: {
					...base,
					ok: false as const,
					status: "FAILED" as const,
					error: {
						code: "STOP_FAILED" as const,
						message:
							error instanceof Error
								? error.message
								: "failed to stop dev-tunnel",
						retryable: true,
					},
				},
				observedEffects: [],
			};
		}
	},
} as const;

function gatewayPort(facts: Record<string, unknown> | undefined): number {
	const raw = facts?.localBaseUrl;
	if (typeof raw !== "string")
		throw new Error("agent-gateway localBaseUrl shared fact is unavailable");
	const url = new URL(raw);
	const port = Number(url.port);
	if (
		url.protocol !== "http:" ||
		url.hostname !== "127.0.0.1" ||
		!Number.isInteger(port) ||
		port < 1 ||
		port > 65_535
	)
		throw new Error("agent-gateway localBaseUrl shared fact is invalid");
	return port;
}

export function workspaceTunnelId(workspaceRoot: string): string {
	const digest = createHash("sha256")
		.update(resolve(workspaceRoot))
		.digest("hex")
		.slice(0, 24);
	return `proflow-${digest}`;
}

const setupFailed = (error: unknown) => ({
	result: {
		...base,
		ok: false as const,
		status: "FAILED" as const,
		error: {
			code: "SETUP_FAILED" as const,
			message:
				error instanceof Error ? error.message : "Dev Tunnel setup failed",
			retryable: true,
		},
	},
	observedEffects: [],
});

export function createDevTunnelBehaviorAdapter(dependencies?: {
	automation?: DevTunnelAutomation;
	createRuntime?: RuntimeFactory;
	verifyPublicBaseUrl?: (publicBaseUrl: string) => Promise<void>;
	resolveCli?: (workspaceRoot: string) => Promise<string>;
}) {
	const createRuntime = dependencies?.createRuntime ?? createDevTunnelRuntime;
	const verifyPublicBaseUrl =
		dependencies?.verifyPublicBaseUrl ?? verifyProvisionedPublicBaseUrl;
	return {
		...baseBehaviorAdapter,
		status: async (context: ModuleCommandContext) =>
			observeStatus(context, createRuntime),
		start: async (context: ModuleCommandContext) => {
			const state = await readState(context);
			if (state?.phase !== "READY" || !state.publicBaseUrl)
				return baseBehaviorAdapter.start(context);
			try {
				const cliPath = dependencies?.resolveCli
					? await dependencies.resolveCli(context.workspaceRoot)
					: (await resolveDevTunnelCli()).command;
				const rt = createRuntime({
					command: cliPath,
					tunnelId: state.tunnelId,
					publicBaseUrl: state.publicBaseUrl,
					processStateFile: processFile(context),
				});
				const observed = await rt.start();
				if (observed.login !== "LOGGED_IN")
					throw new Error(loginFailureMessage(observed.login));
				if (observed.state !== "RUNNING")
					throw new Error("dev-tunnel did not reach RUNNING");
				try {
					await verifyPublicBaseUrl(state.publicBaseUrl);
				} catch (error) {
					await rt.stop().catch(() => undefined);
					throw error;
				}
				return {
					result: { ...base, data: observed },
					observedEffects: [processEffect],
				};
			} catch (error) {
				return {
					result: {
						...base,
						ok: false as const,
						status: "FAILED" as const,
						error: {
							code: "START_FAILED" as const,
							message:
								error instanceof Error
									? error.message
									: "failed to start dev-tunnel",
							retryable: true,
						},
					},
					observedEffects: [],
				};
			}
		},
		setup: async (context: ModuleCommandContext) => {
			try {
				const previous = await readState(context);
				const cliPath = dependencies?.automation
					? devTunnelCliPath()
					: await (
							dependencies?.resolveCli ??
							(async () => (await resolveDevTunnelCli()).command)
						)(context.workspaceRoot);
				const automation =
					dependencies?.automation ??
					createDevTunnelAutomation({ command: cliPath });
				await mkdir(stateDir(context), { recursive: true, mode: 0o700 });
				const port = gatewayPort(
					await readModuleSharedFacts(context, "agent-gateway"),
				);
				await automation.ensureLogin();
				let tunnelId: string;
				let safeToStartNewHost = false;
				const stableTunnelId = workspaceTunnelId(context.workspaceRoot);
				const createAndVerifyTunnel = async (targetTunnelId: string) => {
					const createdTunnelId = await automation.createTunnel(targetTunnelId);
					if (createdTunnelId !== targetTunnelId)
						throw new Error(
							"Dev Tunnel create returned an unexpected tunnelId",
						);
					await writeState(context, {
						contract: "proflow.dev-tunnel-setup.v2",
						tunnelId: createdTunnelId,
						phase: "PENDING_CREATED",
						gatewayPort: port,
					});
					const created = await automation.inspectTunnel(createdTunnelId);
					if (created.state !== "EXISTS")
						throw new Error(
							"new Dev Tunnel could not be verified by show --json",
						);
					return createdTunnelId;
				};
				const resolveStableTunnel = async () => {
					const inspected = await automation.inspectTunnel(stableTunnelId);
					if (inspected.state === "UNKNOWN")
						throw new Error("workspace Tunnel remote state is UNKNOWN");
					if (inspected.state === "EXISTS")
						return { tunnelId: stableTunnelId, hostState: inspected.hostState };
					return {
						tunnelId: await createAndVerifyTunnel(stableTunnelId),
						hostState: "STOPPED" as const,
					};
				};
				if (previous) {
					const inspected = await automation.inspectTunnel(previous.tunnelId);
					if (inspected.state === "UNKNOWN")
						throw new Error("workspace Tunnel remote state is UNKNOWN");
					if (inspected.state === "EXISTS") {
						tunnelId = previous.tunnelId;
						safeToStartNewHost = inspected.hostState === "STOPPED";
					} else {
						const resolved = await resolveStableTunnel();
						tunnelId = resolved.tunnelId;
						safeToStartNewHost = resolved.hostState === "STOPPED";
					}
				} else {
					const resolved = await resolveStableTunnel();
					tunnelId = resolved.tunnelId;
					safeToStartNewHost = resolved.hostState === "STOPPED";
				}
				await automation.ensurePort(tunnelId, port);
				await writeState(context, {
					contract: "proflow.dev-tunnel-setup.v2",
					tunnelId,
					phase: "PORT_READY",
					gatewayPort: port,
				});
				const host = createRuntime({
					command: cliPath,
					tunnelId,
					processStateFile: processFile(context),
					loginVerified: true,
				});
				const observed = await host.status();
				let started = false;
				if (observed.state !== "RUNNING") {
					if (observed.state === "UNKNOWN" && !safeToStartNewHost)
						throw new Error(
							"Tunnel host state is UNKNOWN; refusing to start a duplicate host",
						);
					const launched = await host.start();
					if (launched.state !== "RUNNING")
						throw new Error("Dev Tunnel host did not reach RUNNING");
					started = true;
				}
				await writeState(context, {
					contract: "proflow.dev-tunnel-setup.v2",
					tunnelId,
					phase: "HOST_READY",
					gatewayPort: port,
				});
				const publicBaseUrl = await automation.discoverPublicBaseUrl(
					tunnelId,
					port,
				);
				const url = new URL(publicBaseUrl);
				if (url.protocol !== "https:")
					throw new Error("discovered publicBaseUrl must be HTTPS");
				await verifyPublicBaseUrl(url.href);
				const state: SetupState = {
					contract: "proflow.dev-tunnel-setup.v2",
					tunnelId,
					phase: "READY",
					gatewayPort: port,
					publicBaseUrl: url.href,
				};
				await writeState(context, state);
				await writeModuleSharedFacts(context, descriptor.moduleRef, {
					tunnelId,
					publicBaseUrl: state.publicBaseUrl,
				});
				return {
					result: { ...base, data: state },
					observedEffects: started ? [processEffect] : [],
				};
			} catch (error) {
				return setupFailed(error);
			}
		},
	} as const;
}

export const behaviorAdapter = createDevTunnelBehaviorAdapter();
