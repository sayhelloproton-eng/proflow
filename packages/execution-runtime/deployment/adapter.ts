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

export function createBehaviorAdapter(service?: ProcessService) {
	return {
		describe: () => ({ result: base, observedEffects: [] }),
		preflight: () => ({ result: base, observedEffects: [] }),
		status: () => ({
			result: service ? { ...base, data: service.status() } : unbound,
			observedEffects: [],
		}),
		verify: () => ({
			result: {
				...(service ? base : unbound),
				checks: [
					{
						id: "execution-runtime-critical-proofs",
						status: service?.status().readiness === "READY" ? "PASS" : "FAIL",
						message: service
							? "Bound process exposes current durable runtime readiness"
							: "No configured Execution Runtime process is bound",
					},
				],
			},
			observedEffects: [],
		}),
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
		restart: async () => ({
			result: service ? { ...base, data: await service.restart() } : unbound,
			observedEffects: service
				? [...descriptor.effects.map((item) => item.description)]
				: [],
		}),
	};
}

export const behaviorAdapter = createBehaviorAdapter();

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
	return { behaviorAdapter: createBehaviorAdapter(service) };
}
