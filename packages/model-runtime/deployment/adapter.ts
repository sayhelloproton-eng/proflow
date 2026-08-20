import { observeDeclaredModuleStatus } from "@tomflow/proflow-module-contract";
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

export function createBehaviorAdapter(
	input?: { service: ModelRuntimeService; verifyProvider: LiveVerification },
	config?: Record<string, string>,
	configValid = true,
) {
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
			const inspection = input?.service.inspect();
			const running =
				inspection?.readiness === "READY" &&
				inspection.dependency.fast === "READY" &&
				inspection.dependency.reason === "READY";
			return {
				result: success(
					observeDeclaredModuleStatus(
						descriptor,
						config,
						running ? "RUNNING" : input ? "FAILED" : "UNKNOWN",
						configValid,
					),
				),
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
		uninstall: async () => {
			if (input) await input.service.stop();
			return {
				// An unbound runtime is already absent for uninstall purposes.
				// start/status/verify still fail closed until provider config exists.
				result: success(),
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
}): Promise<{ behaviorAdapter: Record<string, unknown> }> {
	const unboundBinding = (configValid = true) => ({
		behaviorAdapter: createBehaviorAdapter(
			undefined,
			input.config,
			configValid,
		),
	});
	const required = [
		"stateRoot",
		"transportCredentialFile",
		"providerBaseUrl",
		"fastModel",
		"reasonModel",
		"capabilityProfilesFile",
	] as const;
	if (!required.every((key) => input.config[key])) return unboundBinding();
	try {
		new URL(input.config.providerBaseUrl ?? "");
	} catch {
		return unboundBinding(false);
	}

	const capabilityProfilesFile = input.config.capabilityProfilesFile;
	if (!capabilityProfilesFile) return unboundBinding();
	const [fs, contracts] = await Promise.all([
		import("node:fs/promises"),
		import("@tomflow/proflow-model-contracts"),
	]);
	let fast: ReturnType<typeof contracts.modelCapabilityProfileSchema.parse>;
	let reason: ReturnType<typeof contracts.modelCapabilityProfileSchema.parse>;
	try {
		const raw: unknown = JSON.parse(
			await fs.readFile(capabilityProfilesFile, "utf8"),
		);
		if (typeof raw !== "object" || raw === null || Array.isArray(raw))
			return unboundBinding(false);
		const profilesObject = raw as Record<string, unknown>;
		fast = contracts.modelCapabilityProfileSchema.parse(profilesObject.fast);
		reason = contracts.modelCapabilityProfileSchema.parse(
			profilesObject.reason,
		);
		if (
			fast.modelRef !== input.config.fastModel ||
			reason.modelRef !== input.config.reasonModel
		)
			return unboundBinding(false);
	} catch {
		return unboundBinding(false);
	}

	const platformHost = input.configByModuleRef.get("platform-host");
	const executionRuntime = input.configByModuleRef.get("execution-runtime");
	const advertised = platformHost?.modelBaseUrl;
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
	const executionModelEndpoint = executionRuntime?.["modelDecision.endpoint"];
	if (executionModelEndpoint) {
		try {
			if (
				new URL(executionModelEndpoint).href.replace(/\/$/, "") !==
				listener.href.replace(/\/$/, "")
			)
				return unboundBinding();
		} catch {
			return unboundBinding();
		}
	}
	// A provider credential is an opaque secretRef identity. Platform CLI has no
	// raw-secret resolver by design, so an authenticated provider stays
	// fail-closed here until such a resolver is explicitly composed.
	if (input.config.providerCredential) return unboundBinding();

	const processModule = await import("../src/process.ts");
	let service: Awaited<
		ReturnType<typeof processModule.createModelRuntimeProcess>
	>;
	try {
		service = await processModule.createModelRuntimeProcess({
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
	} catch {
		return unboundBinding(false);
	}
	return {
		behaviorAdapter: createBehaviorAdapter(
			{
				service,
				verifyProvider: async () => {
					const ok = await service.verifyCapabilities();
					return {
						ok,
						message: ok
							? "Fresh production binding capability probe accepted FAST and REASON"
							: "Fresh production binding capability probe did not accept both model roles",
					};
				},
			},
			input.config,
		),
	};
}
