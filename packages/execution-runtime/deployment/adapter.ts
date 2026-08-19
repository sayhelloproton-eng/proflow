import { createServer } from "node:net";

import { observeDeclaredModuleStatus } from "@tomflow/proflow-module-contract";
import { descriptor } from "./descriptor.ts";

type ProcessService = {
	start(): Promise<{ host: string; port: number }>;
	stop(): Promise<void>;
	restart(): Promise<{ host: string; port: number }>;
	status(): { readiness: "READY" | "NOT_READY" };
};

const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;

const unbound = {
	...base,
	ok: false,
	status: "ACTION_REQUIRED",
	actionRequired: {
		action: "bind-runtime",
		description: "Bind a configured Execution Runtime service",
	},
} as const;

async function listenerPreflight(listener: URL) {
	const port = listener.port === "" ? 80 : Number(listener.port);
	const host = listener.hostname.replace(/^\[(.*)\]$/, "$1");
	const address = `${host}:${port}`;
	try {
		const response = await fetch(new URL("/ready", listener), {
			signal: AbortSignal.timeout(500),
		});
		if (response.ok)
			return {
				result: {
					...base,
					checks: [
						{
							id: "execution-runtime-listener",
							status: "PASS" as const,
							message: `Execution Runtime listener ${address} is already READY`,
						},
					],
				},
				observedEffects: [],
			};
	} catch {
		// A stopped runtime is expected here; continue with a bind-only port probe.
	}
	const probe = await new Promise<{ available: boolean; message: string }>(
		(resolve) => {
			const server = createServer();
			server.once("error", (error) =>
				resolve({
					available: false,
					message: error instanceof Error ? error.message : String(error),
				}),
			);
			server.listen({ host, port, exclusive: true }, () =>
				server.close(() =>
					resolve({
						available: true,
						message: `Execution Runtime listener ${address} is available`,
					}),
				),
			);
		},
	);
	return probe.available
		? {
				result: {
					...base,
					checks: [
						{
							id: "execution-runtime-listener",
							status: "PASS" as const,
							message: probe.message,
						},
					],
				},
				observedEffects: [],
			}
		: {
				result: {
					...base,
					ok: false as const,
					status: "ACTION_REQUIRED" as const,
					actionRequired: {
						action: "free-execution-runtime-port",
						description: `Execution Runtime listener ${address} is unavailable (${probe.message}); stop the conflicting process or configure a different endpoint before platform start`,
					},
					checks: [
						{
							id: "execution-runtime-listener",
							status: "FAIL" as const,
							message: probe.message,
						},
					],
				},
				observedEffects: [],
			};
}

export function createBehaviorAdapter(
	service?: ProcessService,
	config?: Record<string, string>,
) {
	return {
		describe: () => ({ result: base, observedEffects: [] }),
		preflight: () => ({ result: base, observedEffects: [] }),
		status: () => {
			const status = service?.status();
			const ready = status?.readiness === "READY";
			const data = observeDeclaredModuleStatus(
				descriptor,
				config,
				ready ? "RUNNING" : service ? "FAILED" : "UNKNOWN",
			);
			return {
				result: { ...base, data },
				observedEffects: [],
			};
		},
		verify: () => {
			const status = service?.status();
			const ready = status?.readiness === "READY";
			return {
				result: {
					...(service && ready
						? base
						: service
							? {
									...base,
									ok: false as const,
									status: "ACTION_REQUIRED" as const,
									actionRequired: {
										action: "repair-execution-runtime",
										description: "Execution Runtime is not READY",
									},
								}
							: unbound),
					checks: [
						{
							id: "execution-runtime-critical-proofs",
							status: ready ? ("PASS" as const) : ("FAIL" as const),
							message: service
								? `Execution Runtime readiness is ${status?.readiness ?? "NOT_READY"}`
								: "No configured Execution Runtime process is bound",
						},
					],
				},
				observedEffects: [],
			};
		},
		doctor: () => ({ result: base, observedEffects: [] }),
		start: async () => ({
			result: service ? { ...base, data: await service.start() } : unbound,
			observedEffects: service
				? [...descriptor.effects.map((item) => item.description)]
				: [],
		}),
		stop: async () => {
			if (service) await service.stop();
			return {
				result: service ? base : unbound,
				observedEffects: service
					? [...descriptor.effects.map((item) => item.description)]
					: [],
			};
		},
		uninstall: async () => {
			if (service) await service.stop();
			return {
				// Uninstall is idempotent: an unbound service means there is no
				// process to stop before package removal. Runtime readiness still
				// fails closed in status/start/verify.
				result: base,
				observedEffects: service
					? descriptor.effects
							.filter((item) => item.retention === "remove")
							.map((item) => item.description)
					: [],
			};
		},
		restart: async () => ({
			result: service ? { ...base, data: await service.restart() } : unbound,
			observedEffects: service
				? [...descriptor.effects.map((item) => item.description)]
				: [],
		}),
	};
}

export const behaviorAdapter = createBehaviorAdapter();

export async function createServiceProcessBinding(input: {
	moduleRef: string;
	config: Record<string, string>;
	workspaceRoot: string;
	configByModuleRef: ReadonlyMap<string, Record<string, string>>;
}): Promise<
	| {
			serviceProcess: {
				contract: "deployment.service-process.v1";
				bin: "proflow-execution-runtime";
				startCommand: "start";
				config: Record<string, unknown>;
			};
			behaviorAdapter: Record<string, unknown>;
	  }
	| undefined
> {
	const required = [
		"databasePath",
		"projectRoot",
		"artifactRoot",
		"browserExecutorConfigPath",
		"transportCredentialFile",
		"identity.endpoint",
		"identity.tokenFile",
		"modelDecision.endpoint",
		"modelDecision.credentialFile",
	] as const;
	if (!required.every((key) => input.config[key])) return undefined;
	const platformHost = input.configByModuleRef.get("platform-host");
	const advertised = platformHost?.executionBaseUrl;
	if (!advertised) return undefined;
	const listener = new URL(advertised);
	if (listener.protocol !== "http:" || listener.pathname !== "/")
		return undefined;
	const port = listener.port === "" ? 80 : Number(listener.port);
	if (!Number.isInteger(port) || port <= 0 || port > 65_535) return undefined;
	const { parseExecutionRuntimeProcessConfig } = await import(
		"../src/service.ts"
	);
	const processConfig = parseExecutionRuntimeProcessConfig({
		host: listener.hostname,
		port,
		databasePath: input.config.databasePath,
		projectRoot: input.config.projectRoot,
		artifactRoot: input.config.artifactRoot,
		browserExecutorConfigPath: input.config.browserExecutorConfigPath,
		transportCredentialFile: input.config.transportCredentialFile,
		identity: {
			endpoint: input.config["identity.endpoint"],
			tokenFile: input.config["identity.tokenFile"],
		},
		modelDecision: {
			endpoint: input.config["modelDecision.endpoint"],
			credentialFile: input.config["modelDecision.credentialFile"],
		},
	});
	const probeAdapter = {
		describe: behaviorAdapter.describe,
		preflight: () => listenerPreflight(listener),
		verify: async () => {
			let ready = false;
			try {
				ready = (await fetch(new URL("/ready", listener))).ok;
			} catch {
				ready = false;
			}
			return {
				result: ready
					? {
							...base,
							checks: [
								{
									id: "execution-runtime-critical-proofs",
									status: "PASS" as const,
									message: "Managed Execution Runtime /ready probe passed",
								},
							],
						}
					: {
							...base,
							ok: false as const,
							status: "ACTION_REQUIRED" as const,
							actionRequired: {
								action: "repair-execution-runtime",
								description: "Managed Execution Runtime /ready probe failed",
							},
							checks: [
								{
									id: "execution-runtime-critical-proofs",
									status: "FAIL" as const,
									message: "Managed Execution Runtime /ready probe failed",
								},
							],
						},
				observedEffects: [],
			};
		},
		doctor: behaviorAdapter.doctor,
	};
	return {
		serviceProcess: {
			contract: "deployment.service-process.v1",
			bin: "proflow-execution-runtime",
			startCommand: "start",
			config: processConfig as unknown as Record<string, unknown>,
		},
		behaviorAdapter: probeAdapter,
	};
}

export async function createProductionBinding(input: {
	moduleRef: string;
	config: Record<string, string>;
	configByModuleRef: ReadonlyMap<string, Record<string, string>>;
}): Promise<{ behaviorAdapter: Record<string, unknown> } | undefined> {
	const required = [
		"databasePath",
		"projectRoot",
		"artifactRoot",
		"browserExecutorConfigPath",
		"transportCredentialFile",
		"identity.endpoint",
		"identity.tokenFile",
		"modelDecision.endpoint",
		"modelDecision.credentialFile",
	] as const;
	if (!required.every((key) => input.config[key])) return undefined;
	const platformHost = input.configByModuleRef.get("platform-host");
	const advertised = platformHost?.executionBaseUrl;
	if (!advertised) return undefined;
	const listener = new URL(advertised);
	if (listener.protocol !== "http:" || listener.pathname !== "/")
		return undefined;
	const port = listener.port === "" ? 80 : Number(listener.port);
	if (!Number.isInteger(port) || port <= 0 || port > 65_535) return undefined;
	const [
		{ createFormalExecutionRuntimeLifecycle },
		{ parseExecutionRuntimeProcessConfig },
	] = await Promise.all([
		import("../src/formal-process.ts"),
		import("../src/service.ts"),
	]);
	const service = createFormalExecutionRuntimeLifecycle({
		config: parseExecutionRuntimeProcessConfig({
			host: listener.hostname,
			port,
			databasePath: input.config.databasePath,
			projectRoot: input.config.projectRoot,
			artifactRoot: input.config.artifactRoot,
			browserExecutorConfigPath: input.config.browserExecutorConfigPath,
			transportCredentialFile: input.config.transportCredentialFile,
			identity: {
				endpoint: input.config["identity.endpoint"],
				tokenFile: input.config["identity.tokenFile"],
			},
			modelDecision: {
				endpoint: input.config["modelDecision.endpoint"],
				credentialFile: input.config["modelDecision.credentialFile"],
			},
		}),
	});
	return {
		behaviorAdapter: {
			...createBehaviorAdapter(service, input.config),
			preflight: () => listenerPreflight(listener),
		},
	};
}
