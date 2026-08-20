import { observeDeclaredModuleStatus } from "@tomflow/proflow-module-contract";
import { descriptor } from "./descriptor.ts";

type PlatformHostService = {
	start(): Promise<{ host: string; port: number }>;
	stop(): Promise<void>;
	restart(): Promise<{ host: string; port: number }>;
	status(): Promise<{ readiness: "READY" | "NOT_READY" }>;
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
		action: "compose-platform-host",
		description: "Provide validated Host configuration and owner transports",
	},
} as const;

export function createBehaviorAdapter(
	service?: PlatformHostService,
	config?: Record<string, string>,
	configValid = true,
) {
	return {
		describe: () => ({ result: base, observedEffects: [] }),
		preflight: () => ({ result: base, observedEffects: [] }),
		status: async () => {
			const status = service ? await service.status() : undefined;
			const ready = status?.readiness === "READY";
			const data = observeDeclaredModuleStatus(
				descriptor,
				config,
				ready ? "RUNNING" : service ? "FAILED" : "UNKNOWN",
				configValid,
			);
			return {
				result: { ...base, data },
				observedEffects: [],
			};
		},
		verify: async () => {
			const status = service ? await service.status() : undefined;
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
										action: "repair-platform-host",
										description: "Platform Host is not READY",
									},
								}
							: unbound),
					checks: [
						{
							id: "platform-host-readiness",
							status: ready ? ("PASS" as const) : ("FAIL" as const),
							message: service
								? `Platform Host readiness is ${status?.readiness ?? "NOT_READY"}`
								: "No configured Host process is bound",
						},
					],
				},
				observedEffects: [],
			};
		},
		doctor: () => ({ result: base, observedEffects: [] }),
		start: async () => ({
			result: service ? { ...base, data: await service.start() } : unbound,
			observedEffects: service ? ["Manage the platform-host process"] : [],
		}),
		stop: async () => {
			if (service) await service.stop();
			return {
				result: service ? base : unbound,
				observedEffects: service ? ["Manage the platform-host process"] : [],
			};
		},
		restart: async () => ({
			result: service ? { ...base, data: await service.restart() } : unbound,
			observedEffects: service ? ["Manage the platform-host process"] : [],
		}),
		uninstall: async () => {
			if (service) await service.stop();
			return {
				// Uninstall is idempotent: an unbound service means there is no
				// process to stop before package removal. Runtime readiness still
				// fails closed in status/start/verify.
				result: base,
				observedEffects: service ? ["Manage the platform-host process"] : [],
			};
		},
	};
}

export const behaviorAdapter = createBehaviorAdapter();

const REQUIRED_CONFIG = [
	"stateRoot",
	"workspaceRoot",
	"gatewayTransportCredentialFile",
	"executionBaseUrl",
	"executionTransportCredentialFile",
	"modelBaseUrl",
	"modelTransportCredentialFile",
] as const;

// Binds the real Host process only when materialized owner config and required
// dependency composition are available. Unbound bindings still carry owner
// config so status remains authoritative. The heavy src import is deferred
// until a real binding is requested.
export async function createProductionBinding(input: {
	moduleRef: string;
	config: Record<string, string>;
	configByModuleRef: ReadonlyMap<string, Record<string, string>>;
}): Promise<{ behaviorAdapter: Record<string, unknown> }> {
	const config = input.config;
	const unboundBinding = (configValid = true) => ({
		behaviorAdapter: createBehaviorAdapter(undefined, config, configValid),
	});
	if (!REQUIRED_CONFIG.every((key) => config[key] !== undefined))
		return unboundBinding();

	// The Platform Host's public loopback endpoint is already a cross-module
	// contract: Execution calls it through identity.endpoint. Reuse that
	// materialized endpoint as the listener instead of binding an ephemeral port
	// that no dependent module could discover after `start`.
	const executionRuntime = input.configByModuleRef.get("execution-runtime");
	const advertised = executionRuntime?.["identity.endpoint"];
	if (!advertised) return unboundBinding();
	let listener: URL;
	try {
		listener = new URL(advertised);
	} catch {
		return unboundBinding();
	}
	if (listener.protocol !== "http:" || listener.pathname !== "/")
		return unboundBinding();
	const port = listener.port === "" ? 80 : Number(listener.port);
	if (!Number.isInteger(port) || port <= 0 || port > 65_535)
		return unboundBinding();

	const { createPlatformHost, parsePlatformHostConfig } = await import(
		"../src/index.ts"
	);
	let hostConfig: ReturnType<typeof parsePlatformHostConfig>;
	try {
		hostConfig = parsePlatformHostConfig({
			stateRoot: config.stateRoot,
			workspaceRoot: config.workspaceRoot,
			host: listener.hostname,
			port,
			executionBaseUrl: config.executionBaseUrl,
			executionTransportCredentialFile: config.executionTransportCredentialFile,
			modelBaseUrl: config.modelBaseUrl,
			modelTransportCredentialFile: config.modelTransportCredentialFile,
			gatewayTransportCredentialFile: config.gatewayTransportCredentialFile,
			roles: [],
		});
	} catch {
		return unboundBinding(false);
	}
	const host = createPlatformHost({ config: hostConfig });
	const service: PlatformHostService = {
		start: () => host.start(),
		stop: () => host.stop(),
		restart: () => host.restart(),
		status: async () => ({ readiness: (await host.status()).readiness }),
	};
	return { behaviorAdapter: createBehaviorAdapter(service, input.config) };
}
