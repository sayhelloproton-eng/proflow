import type {
	DeploymentCheck,
	ModuleOperationResult,
} from "@tomflow/proflow-module-contract";
import type { ProviderProbeResult } from "../src/resource-adapter.ts";
import { createProviderProbe } from "../src/resource-adapter.ts";
import { descriptor } from "./descriptor.ts";

export type ProviderProbe = () => Promise<ProviderProbeResult>;

export type CapabilityVerification = () => Promise<{
	ok: boolean;
	message: string;
}>;

type AdapterObservation = {
	result: ModuleOperationResult;
	observedEffects: string[];
};

const PROBE_EFFECT =
	"Probes the configured OpenAI-compatible model provider API";

const success = (data?: unknown): ModuleOperationResult => ({
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
	...(data === undefined ? {} : { data }),
});

const actionRequired = (
	action: string,
	description: string,
): ModuleOperationResult => ({
	contract: "deployment.result.v1",
	ok: false,
	status: "ACTION_REQUIRED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
	actionRequired: { action, description },
});

const reachabilityCheck = (
	message: string,
	reachable: boolean,
): DeploymentCheck => ({
	id: "provider-reachability",
	status: reachable ? "PASS" : "FAIL",
	message,
});

const authCheck = (
	message: string,
	authenticated: boolean,
): DeploymentCheck => ({
	id: "provider-auth",
	status: authenticated ? "PASS" : "FAIL",
	message,
});

export function createBehaviorAdapter(input?: {
	probeProvider?: ProviderProbe;
	verifyCapabilities?: CapabilityVerification;
}) {
	const probe = input?.probeProvider;
	const verifyCapabilities = input?.verifyCapabilities;
	return {
		describe: (): AdapterObservation => ({
			result: success({
				resourceIdentity: "model.provider.api",
				resourceIdentityVersion: "1.0.0",
				lifecycle: ["describe", "preflight", "status", "verify", "doctor"],
			}),
			observedEffects: [],
		}),
		preflight: (): AdapterObservation => ({
			result: probe
				? success()
				: actionRequired(
						"configure-provider",
						"Configure providerBaseUrl (providerCredential is optional) for the model provider API",
					),
			observedEffects: [],
		}),
		status: async (): Promise<AdapterObservation> => {
			if (!probe) {
				return {
					result: {
						...actionRequired(
							"configure-provider",
							"No model provider API is configured",
						),
						checks: [
							{
								id: "provider-status",
								status: "FAIL",
								message: "provider base URL is not configured",
							},
						],
					},
					observedEffects: [],
				};
			}
			const observation = await probe();
			return {
				result: observation.reachable
					? {
							...success(),
							checks: [
								{
									id: "provider-status",
									status: "PASS",
									message: observation.message,
								},
							],
						}
					: {
							...actionRequired("repair-provider", observation.message),
							checks: [
								{
									id: "provider-status",
									status: "FAIL",
									message: observation.message,
								},
							],
						},
				observedEffects: [],
			};
		},
		verify: async (): Promise<AdapterObservation> => {
			if (!probe) {
				return {
					result: {
						...actionRequired(
							"configure-provider",
							"Provider reachability and auth cannot be verified without a configured provider",
						),
						checks: [
							reachabilityCheck("provider base URL is not configured", false),
							authCheck("provider credential is not configured", false),
						],
					},
					observedEffects: [],
				};
			}
			const observation = await probe();
			const reachability = reachabilityCheck(
				observation.message,
				observation.reachable,
			);
			const auth = authCheck(observation.message, observation.authenticated);
			if (!observation.reachable || !observation.authenticated) {
				return {
					result: {
						...actionRequired("repair-provider", observation.message),
						checks: [reachability, auth],
					},
					observedEffects: [PROBE_EFFECT],
				};
			}
			if (!verifyCapabilities) {
				return {
					result: {
						...success({ capabilityVerificationOwner: "model-runtime" }),
						checks: [reachability, auth],
					},
					observedEffects: [PROBE_EFFECT],
				};
			}
			const capabilities = await verifyCapabilities();
			const capabilityCheck: DeploymentCheck = {
				id: "provider-capabilities",
				status: capabilities.ok ? "PASS" : "FAIL",
				message: capabilities.message,
			};
			if (!capabilities.ok) {
				return {
					result: {
						...actionRequired("repair-provider", capabilities.message),
						checks: [reachability, auth, capabilityCheck],
					},
					observedEffects: [PROBE_EFFECT],
				};
			}
			return {
				result: {
					...success(),
					checks: [reachability, auth, capabilityCheck],
				},
				observedEffects: [PROBE_EFFECT],
			};
		},
		doctor: async (): Promise<AdapterObservation> => {
			if (!probe) {
				return {
					result: {
						...actionRequired(
							"configure-provider",
							"providerBaseUrl is required for diagnostics (providerCredential is optional)",
						),
						checks: [
							{
								id: "provider-diagnostics",
								status: "FAIL",
								message: "provider configuration is missing",
							},
						],
					},
					observedEffects: [],
				};
			}
			const observation = await probe();
			const capabilityNote =
				verifyCapabilities === undefined
					? "capability verification is not yet injected"
					: "capability verification is available";
			const healthy = observation.reachable && observation.authenticated;
			const message = healthy
				? `provider API reachable and authenticated (${capabilityNote})`
				: `${observation.message} (${capabilityNote})`;
			return {
				result: healthy
					? {
							...success(),
							checks: [
								{
									id: "provider-diagnostics",
									status: "PASS",
									message,
								},
							],
						}
					: {
							...actionRequired("repair-provider", message),
							checks: [
								{
									id: "provider-diagnostics",
									status: "FAIL",
									message,
								},
							],
						},
				observedEffects: [PROBE_EFFECT],
			};
		},
	};
}

export const behaviorAdapter = createBehaviorAdapter();

// providerCredential is a secretRef identity, not a raw token, so the production
// probe stays unauthenticated; a credential-rejecting provider reports false.
export function createProductionBinding(input: {
	moduleRef: string;
	config: Record<string, string>;
}): { behaviorAdapter: Record<string, unknown> } | undefined {
	const baseUrl = input.config.providerBaseUrl;
	if (baseUrl === undefined || baseUrl === "") return undefined;
	return {
		behaviorAdapter: createBehaviorAdapter({
			probeProvider: createProviderProbe({ baseUrl }),
		}),
	};
}
