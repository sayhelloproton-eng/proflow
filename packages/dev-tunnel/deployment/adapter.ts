import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolveDevTunnelCli } from "@tomflow/proflow-devtunnel-cli";
import {
	type ModuleCommandContext,
	readModuleSharedFacts,
	writeModuleSharedFacts,
} from "@tomflow/proflow-module-contract";
import {
	createDevTunnelAutomation,
	createDevTunnelRuntime,
	type DevTunnelAutomation,
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
type SetupPhase = "PENDING_CREATED" | "PORT_READY" | "HOST_READY" | "READY";
type SetupState = {
	contract: "proflow.dev-tunnel-setup.v2";
	tunnelId: string;
	phase: SetupPhase;
	gatewayPort?: number;
	publicBaseUrl?: string;
	cliPath?: string;
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
		const cliPath = raw.cliPath;
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
			...(typeof cliPath === "string" ? { cliPath } : {}),
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
		...(state?.cliPath ? { command: state.cliPath } : {}),
		...(state
			? { tunnelId: state.tunnelId, publicBaseUrl: state.publicBaseUrl }
			: {}),
		processStateFile: processFile(context),
	});
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
	status: async (context: ModuleCommandContext) => {
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
		const rt = runtime(context, state);
		const login = await rt.loginStatus();
		const observed = await rt.status();
		const configured =
			state?.phase === "READY" &&
			typeof state.publicBaseUrl === "string" &&
			login === "LOGGED_IN";
		const runtimeStatus =
			observed.state === "RUNNING"
				? ("RUNNING" as const)
				: observed.state === "STOPPED"
					? ("STOPPED" as const)
					: configured
						? ("FAILED" as const)
						: ("STOPPED" as const);
		return {
			result: {
				...base,
				data: {
					setupStatus: configured
						? ("READY" as const)
						: ("ACTION_REQUIRED" as const),
					runtimeStatus,
					...(!configured || runtimeStatus === "FAILED"
						? {
								issues: [
									...(!configured
										? [
												{
													scope: "SETUP" as const,
													code: "TUNNEL_LOGIN_REQUIRED",
													message:
														state && state.phase !== "READY"
															? `远程连接配置已保存，当前阶段 ${state.phase}；重新运行 Platform setup 将从此处恢复`
															: "Dev Tunnel CLI 尚未登录或配置未保存",
													relatedModuleRefs: [],
											nextCommand: "platform setup",
												},
											]
										: []),
									...(runtimeStatus === "FAILED"
										? [
												{
													scope: "RUNTIME" as const,
													code: "TUNNEL_RUNTIME_FAILED",
													message: "Tunnel 运行状态检查失败",
													relatedModuleRefs: [],
											nextCommand: "platform status",
												},
											]
										: []),
								],
							}
						: {}),
				},
			},
			observedEffects: [],
		};
	},
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
		if ((await rt.loginStatus()) !== "LOGGED_IN")
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
		try {
			const observed = await rt.start();
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

type RuntimeFactory = (input: {
	command?: string;
	tunnelId?: string;
	publicBaseUrl?: string;
	processStateFile?: string;
}) => DevTunnelRuntime;

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
		setup: async (context: ModuleCommandContext) => {
			try {
				const previous = await readState(context);
				const cliPath =
					previous?.cliPath ??
					(dependencies?.automation
						? "devtunnel"
						: await (
								dependencies?.resolveCli ??
								(async (workspaceRoot) =>
									(await resolveDevTunnelCli({ workspaceRoot })).command)
							)(context.workspaceRoot));
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
				const createAndVerifyTunnel = async () => {
					const createdTunnelId = await automation.createTunnel();
					const created = await automation.inspectTunnel(createdTunnelId);
					if (created.state !== "EXISTS")
						throw new Error(
							"new Dev Tunnel could not be verified by show --json",
						);
					await writeState(context, {
						contract: "proflow.dev-tunnel-setup.v2",
						tunnelId: createdTunnelId,
						phase: "PENDING_CREATED",
						gatewayPort: port,
						cliPath,
					});
					return createdTunnelId;
				};
				if (previous) {
					const inspected = await automation.inspectTunnel(previous.tunnelId);
					if (inspected.state === "UNKNOWN")
						throw new Error("workspace Tunnel remote state is UNKNOWN");
					if (inspected.state === "EXISTS") {
						tunnelId = previous.tunnelId;
						safeToStartNewHost = inspected.hostState === "STOPPED";
					} else {
						tunnelId = await createAndVerifyTunnel();
						safeToStartNewHost = true;
					}
				} else {
					tunnelId = await createAndVerifyTunnel();
					safeToStartNewHost = true;
				}
				await automation.ensurePort(tunnelId, port);
				await writeState(context, {
					contract: "proflow.dev-tunnel-setup.v2",
					tunnelId,
					phase: "PORT_READY",
					gatewayPort: port,
					cliPath,
				});
				const host = createRuntime({
					tunnelId,
					processStateFile: processFile(context),
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
					cliPath,
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
					cliPath,
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
