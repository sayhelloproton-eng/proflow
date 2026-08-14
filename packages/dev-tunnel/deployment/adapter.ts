import {
	type DevTunnelRuntime,
	type ErrorSemanticsProof,
	type FileRelayProof,
	type PublicIngressVerification,
	verifyPublicIngress,
} from "../src/resource-adapter.ts";
import { descriptor } from "./descriptor.ts";

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
	runtime: DevTunnelRuntime;
	verifyErrorSemantics?: () => Promise<ErrorSemanticsProof>;
	verifyFileRelay?: () => Promise<FileRelayProof>;
}) {
	return {
		describe: () => ({
			result: success({
				publicApi: ["status", "verify", "doctor", "start", "stop", "restart"],
			}),
			observedEffects: [],
		}),
		preflight: () => ({
			result: input
				? success()
				: actionRequired(
						"configure-tunnel",
						"Bind a dev-tunnel resource with login status and a public HTTPS ingress",
					),
			observedEffects: [],
		}),
		status: async () => {
			if (!input) {
				return {
					result: actionRequired(
						"configure-tunnel",
						"No dev-tunnel resource is bound",
					),
					observedEffects: [],
				};
			}
			const observation = await input.runtime.status();
			return {
				result: {
					...success(),
					checks: [
						{
							id: "tunnel-status",
							status:
								observation.state === "RUNNING"
									? ("PASS" as const)
									: ("WARN" as const),
							message: `dev-tunnel state is ${observation.state}`,
						},
					],
				},
				observedEffects: [],
			};
		},
		verify: async () => {
			if (!input) {
				return {
					result: actionRequired(
						"configure-tunnel",
						"A live dev-tunnel resource is required for public ingress verification",
					),
					observedEffects: [],
				};
			}
			if ((await input.runtime.loginStatus()) !== "LOGGED_IN") {
				return {
					result: actionRequired(
						"complete-tunnel-login",
						"Complete the interactive dev-tunnel login before verifying public ingress",
					),
					observedEffects: [],
				};
			}
			const publicBaseUrl = input.runtime.publicBaseUrl();
			if (publicBaseUrl === undefined) {
				return {
					result: actionRequired(
						"configure-tunnel",
						"publicBaseUrl must be configured before public ingress verification",
					),
					observedEffects: [],
				};
			}
			const verification = await verifyPublicIngress(publicBaseUrl, {
				...(input.verifyErrorSemantics === undefined
					? {}
					: { verifyErrorSemantics: input.verifyErrorSemantics }),
				...(input.verifyFileRelay === undefined
					? {}
					: { verifyFileRelay: input.verifyFileRelay }),
			});
			return {
				result: verification.ok
					? { ...success(), checks: verification.checks }
					: {
							...actionRequired(
								"repair-tunnel-ingress",
								failureReason(verification),
							),
							checks: verification.checks,
						},
				observedEffects: verification.reachable
					? ["Probes the dev-tunnel public HTTPS ingress"]
					: [],
			};
		},
		doctor: () => ({
			result: input
				? {
						...success(),
						checks: [
							{
								id: "tunnel-diagnostics",
								status: "PASS" as const,
								message:
									"dev-tunnel resource and public ingress verifier are bound",
							},
						],
					}
				: actionRequired(
						"configure-tunnel",
						"dev-tunnel login and public ingress configuration are required for diagnostics",
					),
			observedEffects: [],
		}),
		start: async () => {
			if (!input) {
				return {
					result: actionRequired(
						"configure-tunnel",
						"Cannot start without a bound dev-tunnel resource",
					),
					observedEffects: [],
				};
			}
			if ((await input.runtime.loginStatus()) !== "LOGGED_IN") {
				return {
					result: actionRequired(
						"complete-tunnel-login",
						"Complete the interactive dev-tunnel login before starting the tunnel",
					),
					observedEffects: [],
				};
			}
			try {
				const observation = await input.runtime.start();
				return {
					result: success(observation),
					observedEffects: ["Runs the dev-tunnel public ingress process"],
				};
			} catch (error) {
				return {
					result: actionRequired(
						"start-tunnel",
						error instanceof Error
							? error.message
							: "failed to start the dev-tunnel process",
					),
					observedEffects: [],
				};
			}
		},
		stop: async () => {
			if (input) await input.runtime.stop();
			return {
				result: input
					? success()
					: actionRequired(
							"configure-tunnel",
							"No bound dev-tunnel resource to stop",
						),
				observedEffects: input
					? ["Stops the dev-tunnel public ingress process"]
					: [],
			};
		},
		restart: async () => {
			if (!input) {
				return {
					result: actionRequired(
						"configure-tunnel",
						"No bound dev-tunnel resource to restart",
					),
					observedEffects: [],
				};
			}
			if ((await input.runtime.loginStatus()) !== "LOGGED_IN") {
				return {
					result: actionRequired(
						"complete-tunnel-login",
						"Complete the interactive dev-tunnel login before restarting the tunnel",
					),
					observedEffects: [],
				};
			}
			await input.runtime.stop();
			const observation = await input.runtime.start();
			return {
				result: success(observation),
				observedEffects: ["Restarts the dev-tunnel public ingress process"],
			};
		},
	};
}

function failureReason(verification: PublicIngressVerification): string {
	const failed = verification.checks.find((check) => check.status === "FAIL");
	return failed?.message ?? "public ingress verification did not pass";
}

export const behaviorAdapter = createBehaviorAdapter();
