import type { ModelRuntimeService } from "../src/service.ts";
import { descriptor } from "./descriptor.ts";

type LiveVerification = () => Promise<{ ok: boolean; message: string }>;

const success = (data?: unknown) => ({
	contract: "deployment.result.v1" as const,
	ok: true,
	status: "SUCCEEDED" as const,
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
	...(data === undefined ? {} : { data }),
});

const actionRequired = (action: string, description: string) => ({
	contract: "deployment.result.v1" as const,
	ok: false,
	status: "ACTION_REQUIRED" as const,
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
	actionRequired: { action, description },
});

export function createBehaviorAdapter(input?: {
	service: ModelRuntimeService;
	verifyProvider: LiveVerification;
}) {
	return {
		describe: () => ({
			result: success({ publicApi: ["infer", "getRuntimeStatus"] }),
			observedEffects: [],
		}),
		preflight: () => ({
			result: input
				? success()
				: actionRequired(
						"configure-provider",
						"Bind a runtime service and real provider verifier",
					),
			observedEffects: [],
		}),
		status: () => {
			const inspection = input ? input.service.inspect() : undefined;
			if (!inspection)
				return {
					result: actionRequired(
						"configure-provider",
						"No Model Runtime service is bound",
					),
					observedEffects: [],
				};
			const dependency = inspection.dependency;
			const ready =
				inspection.readiness === "READY" &&
				dependency.fast === "READY" &&
				dependency.reason === "READY";
			return {
				result: {
					...(ready
						? success()
						: actionRequired(
								"repair-model-runtime",
								"Model Runtime process is not fully READY (roles/lane/provider unavailable)",
							)),
					checks: [
						{
							id: "runtime-status-fresh",
							status:
								inspection.readiness === "READY"
									? ("PASS" as const)
									: ("FAIL" as const),
							message: `Model Runtime readiness is ${inspection.readiness}`,
						},
						{
							id: "fast-role-available",
							status:
								dependency.fast === "READY"
									? ("PASS" as const)
									: ("FAIL" as const),
							message: `FAST role is ${dependency.fast}`,
						},
						{
							id: "reason-role-available",
							status:
								dependency.reason === "READY"
									? ("PASS" as const)
									: ("FAIL" as const),
							message: `REASON role is ${dependency.reason}`,
						},
					],
				},
				observedEffects: [],
			};
		},
		verify: async () => {
			if (!input)
				return {
					result: actionRequired(
						"configure-provider",
						"Real provider verification is required",
					),
					observedEffects: [],
				};
			const proof = await input.verifyProvider();
			return {
				result: proof.ok
					? {
							...success(),
							checks: [
								{
									id: "real-provider-capabilities",
									status: "PASS" as const,
									message: proof.message,
								},
							],
						}
					: {
							...actionRequired("repair-provider", proof.message),
							checks: [
								{
									id: "real-provider-capabilities",
									status: "FAIL" as const,
									message: proof.message,
								},
							],
						},
				observedEffects: ["Calls the configured model provider API"],
			};
		},
		doctor: () => ({
			result: input
				? {
						...success(),
						checks: [
							{
								id: "provider-diagnostics",
								status: "PASS" as const,
								message: "Provider verifier and runtime service are bound",
							},
						],
					}
				: actionRequired(
						"configure-provider",
						"Provider URL, role models, and optional credential reference are required",
					),
			observedEffects: [],
		}),
		start: async () => ({
			result: input
				? success(await input.service.start())
				: actionRequired(
						"configure-provider",
						"Cannot start without a bound runtime",
					),
			observedEffects: input
				? ["Runs the Model Runtime HTTP service process"]
				: [],
		}),
		stop: async () => {
			if (input) await input.service.stop();
			return {
				result: input
					? success()
					: actionRequired("configure-provider", "No bound runtime to stop"),
				observedEffects: input
					? ["Runs the Model Runtime HTTP service process"]
					: [],
			};
		},
		restart: async () => {
			if (!input)
				return {
					result: actionRequired(
						"configure-provider",
						"No bound runtime to restart",
					),
					observedEffects: [],
				};
			await input.service.stop();
			const address = await input.service.start();
			return {
				result: success(address),
				observedEffects: ["Runs the Model Runtime HTTP service process"],
			};
		},
	};
}

export const behaviorAdapter = createBehaviorAdapter();

export async function createProductionBinding(input: {
	moduleRef: string;
	config: Record<string, string>;
	configByModuleRef: ReadonlyMap<string, Record<string, string>>;
}): Promise<{ behaviorAdapter: Record<string, unknown> } | undefined> {
	const required = [
		"stateRoot",
		"transportCredentialFile",
		"providerBaseUrl",
		"fastModel",
		"reasonModel",
		"capabilityProfilesFile",
	] as const;
	if (!required.every((key) => input.config[key])) return undefined;
	const platformHost = input.configByModuleRef.get("platform-host");
	const executionRuntime = input.configByModuleRef.get("execution-runtime");
	const advertised = platformHost?.modelBaseUrl;
	if (!advertised) return undefined;
	const listener = new URL(advertised);
	if (listener.protocol !== "http:" || listener.pathname !== "/")
		return undefined;
	const port = listener.port === "" ? 80 : Number(listener.port);
	if (!Number.isInteger(port) || port <= 0 || port > 65_535) return undefined;
	const executionModelEndpoint = executionRuntime?.["modelDecision.endpoint"];
	if (
		executionModelEndpoint &&
		new URL(executionModelEndpoint).href.replace(/\/$/, "") !==
			listener.href.replace(/\/$/, "")
	)
		return undefined;
	// A provider credential is an opaque secretRef identity. Platform CLI has no
	// raw-secret resolver by design, so an authenticated provider stays
	// fail-closed here until such a resolver is explicitly composed.
	if (input.config.providerCredential) return undefined;
	const capabilityProfilesFile = input.config.capabilityProfilesFile;
	if (!capabilityProfilesFile) return undefined;

	const [fs, contracts, processModule] = await Promise.all([
		import("node:fs/promises"),
		import("@tomflow/proflow-model-contracts"),
		import("../src/process.ts"),
	]);
	const raw: unknown = JSON.parse(
		await fs.readFile(capabilityProfilesFile, "utf8"),
	);
	if (typeof raw !== "object" || raw === null || Array.isArray(raw))
		throw new TypeError("capabilityProfilesFile must contain an object");
	const profilesObject = raw as Record<string, unknown>;
	const fast = contracts.modelCapabilityProfileSchema.parse(
		profilesObject.fast,
	);
	const reason = contracts.modelCapabilityProfileSchema.parse(
		profilesObject.reason,
	);
	if (fast.modelRef !== input.config.fastModel)
		throw new TypeError(
			"FAST capability profile modelRef must match fastModel",
		);
	if (reason.modelRef !== input.config.reasonModel)
		throw new TypeError(
			"REASON capability profile modelRef must match reasonModel",
		);

	const service = await processModule.createModelRuntimeProcess({
		config: processModule.parseModelRuntimeProcessConfig({
			host: listener.hostname,
			port,
			stateRoot: input.config.stateRoot,
			transportCredentialFile: input.config.transportCredentialFile,
			providerBaseUrl: input.config.providerBaseUrl,
			models: {
				fast: input.config.fastModel,
				reason: input.config.reasonModel,
			},
			profiles: { fast, reason },
			capabilityFacts: {
				fast: {
					contextWindow: fast.contextWindow,
					maxOutputTokens: fast.maxOutputTokens,
					basis: "provider-config",
				},
				reason: {
					contextWindow: reason.contextWindow,
					maxOutputTokens: reason.maxOutputTokens,
					basis: "provider-config",
				},
			},
		}),
	});
	return {
		behaviorAdapter: createBehaviorAdapter({
			service,
			verifyProvider: async () => {
				const inspection = service.inspect();
				const ok =
					inspection.dependency.fast === "READY" &&
					inspection.dependency.reason === "READY";
				return {
					ok,
					message: ok
						? "Fresh production binding capability probe accepted FAST and REASON"
						: "Fresh production binding capability probe did not accept both model roles",
				};
			},
		}),
	};
}
