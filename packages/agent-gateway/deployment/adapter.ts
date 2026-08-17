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
export function createBehaviorAdapter(service?: GatewayProcess) {
	return {
		describe: () => ({ result: base, observedEffects: [] }),
		preflight: () => ({ result: base, observedEffects: [] }),
		status: async () => {
			const processStatus = service?.status();
			const readiness = service ? await service.readiness() : undefined;
			const ready = readiness?.status === "READY";
			return {
				result: service
					? {
							...(ready
								? base
								: {
										...base,
										ok: false as const,
										status: "ACTION_REQUIRED" as const,
										actionRequired: {
											action: "repair-gateway",
											description: "Gateway is not READY",
										},
									}),
							data: processStatus,
							checks: [
								{
									id: "gateway-readiness",
									status: ready ? ("PASS" as const) : ("FAIL" as const),
									message: `Gateway readiness is ${readiness?.status ?? "NOT_READY"}`,
								},
							],
						}
					: unbound,
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
				result: service ? base : unbound,
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

export async function createServiceProcessBinding(input: {
	moduleRef: string;
	config: Record<string, string>;
	workspaceRoot: string;
	configByModuleRef: ReadonlyMap<string, Record<string, string>>;
}): Promise<
	| {
			serviceProcess: {
				contract: "deployment.service-process.v1";
				bin: "proflow-agent-gateway";
				startCommand: "start";
				config: Record<string, unknown>;
			};
			behaviorAdapter: Record<string, unknown>;
	  }
	| undefined
> {
	const localBaseUrl = input.config.localBaseUrl;
	const publicBaseUrl = input.config.publicBaseUrl;
	const downstreamCredentialFile = input.config.downstreamCredentialFile;
	const platformHost = input.configByModuleRef.get("platform-host");
	const executionRuntime = input.configByModuleRef.get("execution-runtime");
	const stateRoot = platformHost?.stateRoot;
	const downstreamBaseUrl = executionRuntime?.["identity.endpoint"];
	if (
		!localBaseUrl ||
		!publicBaseUrl ||
		!downstreamCredentialFile ||
		!stateRoot ||
		!downstreamBaseUrl
	) {
		return undefined;
	}
	const listener = new URL(localBaseUrl);
	if (
		listener.protocol !== "http:" ||
		!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(
			listener.hostname,
		) ||
		listener.pathname !== "/"
	)
		return undefined;
	const port = listener.port === "" ? 80 : Number(listener.port);
	if (!Number.isInteger(port) || port <= 0 || port > 65_535) return undefined;
	const [{ join }, { parseAgentGatewayProcessConfig }] = await Promise.all([
		import("node:path"),
		import("../src/process.ts"),
	]);
	const processConfig = parseAgentGatewayProcessConfig({
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
	const probeService: GatewayProcess = {
		async start() {
			throw new Error("managed by Platform CLI service supervisor");
		},
		async stop() {},
		async restart() {
			throw new Error("managed by Platform CLI service supervisor");
		},
		async readiness() {
			try {
				const response = await fetch(new URL("/ready", listener));
				return {
					status: response.ok ? ("READY" as const) : ("NOT_READY" as const),
				};
			} catch {
				return { status: "NOT_READY" as const };
			}
		},
		status: () => ({
			endpoint: listener.href.replace(/\/$/, ""),
			managed: true,
		}),
	};
	return {
		serviceProcess: {
			contract: "deployment.service-process.v1",
			bin: "proflow-agent-gateway",
			startCommand: "start",
			config: processConfig as unknown as Record<string, unknown>,
		},
		behaviorAdapter: createBehaviorAdapter(probeService),
	};
}

export async function createProductionBinding(input: {
	moduleRef: string;
	config: Record<string, string>;
	workspaceRoot: string;
	configByModuleRef: ReadonlyMap<string, Record<string, string>>;
}): Promise<{ behaviorAdapter: Record<string, unknown> } | undefined> {
	const localBaseUrl = input.config.localBaseUrl;
	const publicBaseUrl = input.config.publicBaseUrl;
	const downstreamCredentialFile = input.config.downstreamCredentialFile;
	const platformHost = input.configByModuleRef.get("platform-host");
	const executionRuntime = input.configByModuleRef.get("execution-runtime");
	const stateRoot = platformHost?.stateRoot;
	const downstreamBaseUrl = executionRuntime?.["identity.endpoint"];
	if (
		!localBaseUrl ||
		!publicBaseUrl ||
		!downstreamCredentialFile ||
		!stateRoot ||
		!downstreamBaseUrl
	) {
		return undefined;
	}
	const listener = new URL(localBaseUrl);
	if (
		listener.protocol !== "http:" ||
		!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(
			listener.hostname,
		) ||
		listener.pathname !== "/"
	)
		return undefined;
	const port = listener.port === "" ? 80 : Number(listener.port);
	if (!Number.isInteger(port) || port <= 0 || port > 65_535) return undefined;

	const [
		{ join },
		{ createAgentGatewayProcess, parseAgentGatewayProcessConfig },
	] = await Promise.all([import("node:path"), import("../src/process.ts")]);
	const service = await createAgentGatewayProcess({
		config: parseAgentGatewayProcessConfig({
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
		}),
	});
	return { behaviorAdapter: createBehaviorAdapter(service) };
}
