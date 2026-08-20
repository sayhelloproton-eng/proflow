import { observeDeclaredModuleStatus } from "@tomflow/proflow-module-contract";
import { descriptor } from "./descriptor.ts";

type GatewayProcess = {
	start(): Promise<{ host: string; port: number }>;
	stop(): Promise<void>;
	restart(): Promise<{ host: string; port: number }>;
	readiness(): Promise<{ status: "READY" | "NOT_READY" }>;
	status(): unknown;
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
		action: "compose-gateway",
		description: "Provide owner ports and process configuration",
	},
} as const;
export function createBehaviorAdapter(
	service?: GatewayProcess,
	config?: Record<string, string>,
	configValid = true,
) {
	return {
		describe: () => ({ result: base, observedEffects: [] }),
		preflight: () => ({ result: base, observedEffects: [] }),
		status: async () => {
			const readiness = service ? await service.readiness() : undefined;
			const ready = readiness?.status === "READY";
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
			const readiness = service ? await service.readiness() : undefined;
			const ready = readiness?.status === "READY";
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
										action: "repair-gateway",
										description: "Gateway is not READY",
									},
								}
							: unbound),
					checks: [
						{
							id: "gateway-readiness",
							status: ready ? ("PASS" as const) : ("FAIL" as const),
							message: service
								? `Gateway readiness is ${readiness?.status ?? "NOT_READY"}`
								: "No configured Gateway process is bound",
						},
					],
				},
				observedEffects: [],
			};
		},
		doctor: () => ({ result: base, observedEffects: [] }),
		start: async () => ({
			result: {
				...base,
				...(service
					? { data: await service.start() }
					: {
							status: "ACTION_REQUIRED" as const,
							ok: false,
							actionRequired: {
								action: "compose-gateway",
								description: "Provide owner ports before starting Gateway",
							},
						}),
			},
			observedEffects: service ? ["Manage the declared service process"] : [],
		}),
		stop: async () => {
			if (service) await service.stop();
			return {
				result: service ? base : unbound,
				observedEffects: service ? ["Manage the declared service process"] : [],
			};
		},
		uninstall: async () => {
			if (service) await service.stop();
			return {
				// Uninstall is idempotent: an unbound service means there is no
				// process to stop before package removal. Runtime readiness still
				// fails closed in status/start/verify.
				result: base,
				observedEffects: service ? ["Manage the declared service process"] : [],
			};
		},
		restart: async () => ({
			result: {
				...base,
				...(service
					? { data: await service.restart() }
					: {
							status: "ACTION_REQUIRED" as const,
							ok: false,
							actionRequired: {
								action: "compose-gateway",
								description: "Provide owner ports before restarting Gateway",
							},
						}),
			},
			observedEffects: service ? ["Manage the declared service process"] : [],
		}),
	};
}

export const behaviorAdapter = createBehaviorAdapter();

export async function createProductionBinding(input: {
	moduleRef: string;
	config: Record<string, string>;
	workspaceRoot: string;
	configByModuleRef: ReadonlyMap<string, Record<string, string>>;
}): Promise<{ behaviorAdapter: Record<string, unknown> }> {
	const unboundBinding = (configValid = true) => ({
		behaviorAdapter: createBehaviorAdapter(
			undefined,
			input.config,
			configValid,
		),
	});
	const localBaseUrl = input.config.localBaseUrl;
	const publicBaseUrl = input.config.publicBaseUrl;
	const downstreamCredentialFile = input.config.downstreamCredentialFile;
	if (!localBaseUrl || !publicBaseUrl || !downstreamCredentialFile)
		return unboundBinding();

	let listener: URL;
	let publicUrl: URL;
	try {
		listener = new URL(localBaseUrl);
		publicUrl = new URL(publicBaseUrl);
	} catch {
		return unboundBinding(false);
	}
	if (
		listener.protocol !== "http:" ||
		!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(
			listener.hostname,
		) ||
		listener.pathname !== "/" ||
		publicUrl.protocol !== "https:"
	)
		return unboundBinding(false);
	const port = listener.port === "" ? 80 : Number(listener.port);
	if (!Number.isInteger(port) || port <= 0 || port > 65_535)
		return unboundBinding(false);

	const platformHost = input.configByModuleRef.get("platform-host");
	const executionRuntime = input.configByModuleRef.get("execution-runtime");
	const stateRoot = platformHost?.stateRoot;
	const downstreamBaseUrl = executionRuntime?.["identity.endpoint"];
	if (!stateRoot || !downstreamBaseUrl) return unboundBinding();
	try {
		const downstream = new URL(downstreamBaseUrl);
		if (
			downstream.protocol !== "http:" ||
			!["localhost", "127.0.0.1", "::1"].includes(downstream.hostname)
		)
			return unboundBinding();
	} catch {
		return unboundBinding();
	}

	const [
		{ join },
		{ createAgentGatewayProcess, parseAgentGatewayProcessConfig },
	] = await Promise.all([import("node:path"), import("../src/process.ts")]);
	let processConfig: ReturnType<typeof parseAgentGatewayProcessConfig>;
	try {
		processConfig = parseAgentGatewayProcessConfig({
			host: listener.hostname,
			port,
			publicBaseUrl,
			downstreamBaseUrl,
			credentialFile: join(
				stateRoot,
				"agent",
				"secrets",
				"role-credentials.json",
			),
			downstreamCredentialFile,
		});
	} catch {
		return unboundBinding(false);
	}
	const service = await createAgentGatewayProcess({ config: processConfig });
	return { behaviorAdapter: createBehaviorAdapter(service, input.config) };
}
