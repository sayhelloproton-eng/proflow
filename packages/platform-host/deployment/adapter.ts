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

export function createBehaviorAdapter(service?: PlatformHostService) {
	return {
		describe: () => ({ result: base, observedEffects: [] }),
		preflight: () => ({ result: base, observedEffects: [] }),
		status: async () => ({
			result: service ? { ...base, data: await service.status() } : unbound,
			observedEffects: [],
		}),
		verify: async () => {
			const status = service ? await service.status() : undefined;
			return {
				result: {
					...(service ? base : unbound),
					checks: [
						{
							id: "platform-host-readiness",
							status: status?.readiness === "READY" ? "PASS" : "FAIL",
							message: service
								? "Bound Host reports current owner readiness"
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
	};
}

export const behaviorAdapter = createBehaviorAdapter();

const REQUIRED_CONFIG = [
	"stateRoot",
	"workspaceRoot",
	"executionBaseUrl",
	"modelBaseUrl",
] as const;

// Binds the real Host process only when the materialized config is complete;
// otherwise stays unbound so the CLI's catalog falls back to the fail-closed
// default. The heavy src import is deferred until a real binding is requested.
export async function createProductionBinding(input: {
	moduleRef: string;
	config: Record<string, string>;
}): Promise<{ behaviorAdapter: Record<string, unknown> } | undefined> {
	const config = input.config;
	if (!REQUIRED_CONFIG.every((key) => config[key] !== undefined)) {
		return undefined;
	}
	const { createPlatformHost, parsePlatformHostConfig } = await import(
		"../src/index.ts"
	);
	const hostConfig = parsePlatformHostConfig({
		stateRoot: config.stateRoot,
		workspaceRoot: config.workspaceRoot,
		host: config.host ?? "127.0.0.1",
		port: config.port === undefined ? 0 : Number(config.port),
		executionBaseUrl: config.executionBaseUrl,
		modelBaseUrl: config.modelBaseUrl,
		...(config.gatewayTransportCredentialFile
			? {
					gatewayTransportCredentialFile: config.gatewayTransportCredentialFile,
				}
			: {}),
		...(config.executionTransportCredentialFile
			? {
					executionTransportCredentialFile:
						config.executionTransportCredentialFile,
				}
			: {}),
		...(config.modelTransportCredentialFile
			? { modelTransportCredentialFile: config.modelTransportCredentialFile }
			: {}),
		roles: [],
	});
	const host = createPlatformHost({ config: hostConfig });
	const service: PlatformHostService = {
		start: () => host.start(),
		stop: () => host.stop(),
		restart: () => host.restart(),
		status: async () => ({ readiness: (await host.status()).readiness }),
	};
	return { behaviorAdapter: createBehaviorAdapter(service) };
}
