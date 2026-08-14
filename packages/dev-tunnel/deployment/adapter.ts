import type { ModuleOperationResult } from "@tomflow/proflow-module-contract";
import type {
	DevTunnelRuntime,
	ErrorSemanticsProof,
	FileRelayProof,
	PublicIngressVerification,
} from "../src/resource-adapter.ts";
import { verifyPublicIngress } from "../src/resource-adapter.ts";
import { descriptor } from "./descriptor.ts";

const success = (data?: unknown): ModuleOperationResult => ({
	contract: "deployment.result.v1" as const,
	ok: true,
	status: "SUCCEEDED" as const,
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
	...(data === undefined ? {} : { data }),
});

const actionRequired = (
	action: string,
	description: string,
): ModuleOperationResult => ({
	contract: "deployment.result.v1" as const,
	ok: false,
	status: "ACTION_REQUIRED" as const,
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
	actionRequired: { action, description },
});

type CheckStatus = "PASS" | "FAIL" | "WARN" | "SKIP";

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
		doctor: async () => {
			if (!input) {
				return {
					result: actionRequired(
						"configure-tunnel",
						"dev-tunnel login and public ingress configuration are required for diagnostics",
					),
					observedEffects: [],
				};
			}
			const login = await input.runtime.loginStatus();
			const status = await input.runtime.status();
			const publicBaseUrl = input.runtime.publicBaseUrl();
			const checks: { id: string; status: CheckStatus; message: string }[] = [
				{
					id: "tunnel-login",
					status: login === "LOGGED_IN" ? "PASS" : "FAIL",
					message: `login status is ${login}`,
				},
				{
					id: "tunnel-state",
					status:
						status.state === "RUNNING"
							? "PASS"
							: status.state === "STOPPED"
								? "WARN"
								: "FAIL",
					message: `tunnel state is ${status.state}`,
				},
				{
					id: "tunnel-public-url",
					status: publicBaseUrl === undefined ? "FAIL" : "PASS",
					message:
						publicBaseUrl === undefined
							? "publicBaseUrl is not configured"
							: `publicBaseUrl is ${publicBaseUrl}`,
				},
			];
			const healthy =
				login === "LOGGED_IN" &&
				status.state === "RUNNING" &&
				publicBaseUrl !== undefined;
			return {
				result: healthy
					? { ...success(), checks }
					: {
							...actionRequired(
								"repair-tunnel",
								"dev-tunnel resource is not healthy",
							),
							checks,
						},
				observedEffects: [],
			};
		},
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
			if (!input) {
				return {
					result: actionRequired(
						"configure-tunnel",
						"No bound dev-tunnel resource to stop",
					),
					observedEffects: [],
				};
			}
			const stopped = await input.runtime.stop();
			if (stopped.state === "STOPPED") {
				return {
					result: success(),
					observedEffects: ["Stops the dev-tunnel public ingress process"],
				};
			}
			return {
				result: actionRequired(
					"complete-tunnel-stop",
					"dev-tunnel stop state is UNKNOWN; cannot confirm the tunnel stopped",
				),
				observedEffects: [],
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
			const stopped = await input.runtime.stop();
			if (stopped.state !== "STOPPED") {
				return {
					result: actionRequired(
						"complete-tunnel-stop",
						"Cannot restart: dev-tunnel stop state is UNKNOWN",
					),
					observedEffects: [],
				};
			}
			try {
				const observation = await input.runtime.start();
				return {
					result: success(observation),
					observedEffects: ["Restarts the dev-tunnel public ingress process"],
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
	};
}

function failureReason(verification: PublicIngressVerification): string {
	const failed = verification.checks.find((check) => check.status === "FAIL");
	return failed?.message ?? "public ingress verification did not pass";
}

export const behaviorAdapter = createBehaviorAdapter();
