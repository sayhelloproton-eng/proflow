import { readFile } from "node:fs/promises";

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

type DevTunnelVerificationEvidence = {
	contract: "proflow.dev-tunnel-verification.v1";
	moduleVersion: string;
	publicBaseUrl: string;
	observedAt: string;
	fileRelay: FileRelayProof;
	errorSemantics: ErrorSemanticsProof;
};

export async function readDevTunnelVerificationEvidence(
	file: string | undefined,
	publicBaseUrl: string,
): Promise<DevTunnelVerificationEvidence | undefined> {
	if (!file) return undefined;
	try {
		const raw = JSON.parse(
			await readFile(file, "utf8"),
		) as Partial<DevTunnelVerificationEvidence>;
		if (
			raw.contract !== "proflow.dev-tunnel-verification.v1" ||
			raw.moduleVersion !== descriptor.moduleVersion ||
			raw.publicBaseUrl !== publicBaseUrl ||
			typeof raw.observedAt !== "string" ||
			Number.isNaN(Date.parse(raw.observedAt)) ||
			typeof raw.fileRelay !== "object" ||
			raw.fileRelay === null ||
			typeof raw.fileRelay.verified !== "boolean" ||
			typeof raw.fileRelay.message !== "string" ||
			typeof raw.errorSemantics !== "object" ||
			raw.errorSemantics === null ||
			typeof raw.errorSemantics.rateLimit429Verified !== "boolean" ||
			typeof raw.errorSemantics.server5xxVerified !== "boolean" ||
			typeof raw.errorSemantics.message !== "string"
		)
			return undefined;
		return raw as DevTunnelVerificationEvidence;
	} catch {
		return undefined;
	}
}

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
					observedEffects: ["Manage the dev-tunnel public ingress process"],
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
					observedEffects: ["Manage the dev-tunnel public ingress process"],
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
		uninstall: async () => {
			if (!input) {
				return {
					// No bound tunnel means there is no managed external resource to
					// stop. Whole-instance uninstall must remain idempotent.
					result: success(),
					observedEffects: [],
				};
			}
			const stopped = await input.runtime.stop();
			if (stopped.state === "STOPPED") {
				return {
					result: success(),
					observedEffects: ["Manage the dev-tunnel public ingress process"],
				};
			}
			return {
				result: actionRequired(
					"complete-tunnel-stop",
					"dev-tunnel stop state is UNKNOWN; package removal cannot continue",
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
					observedEffects: ["Manage the dev-tunnel public ingress process"],
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

export async function createProductionBinding(input: {
	moduleRef: string;
	config: Record<string, string>;
}): Promise<{ behaviorAdapter: Record<string, unknown> } | undefined> {
	const publicBaseUrl = input.config.publicBaseUrl;
	if (!publicBaseUrl) return undefined;
	const { createDevTunnelRuntime } = await import("../src/resource-adapter.ts");
	const readEvidence = () =>
		readDevTunnelVerificationEvidence(
			input.config.verificationEvidenceFile,
			publicBaseUrl,
		);
	return {
		behaviorAdapter: createBehaviorAdapter({
			runtime: createDevTunnelRuntime({
				publicBaseUrl,
				...(input.config.tunnelId ? { tunnelId: input.config.tunnelId } : {}),
			}),
			verifyFileRelay: async () =>
				(await readEvidence())?.fileRelay ?? {
					verified: false,
					message:
						"dev-tunnel verification evidence is missing, stale, or invalid",
				},
			verifyErrorSemantics: async () =>
				(await readEvidence())?.errorSemantics ?? {
					rateLimit429Verified: false,
					server5xxVerified: false,
					message:
						"dev-tunnel verification evidence is missing, stale, or invalid",
				},
		}),
	};
}
