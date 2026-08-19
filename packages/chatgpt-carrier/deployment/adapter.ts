import { readFile } from "node:fs/promises";

import {
	type CarrierProbeInput,
	type CarrierProbeResult,
	type CarrierVerificationObservation,
	observeCarrierVerification,
	probeCarrier,
	UNVERIFIED_CARRIER_VERIFICATION,
	type VerificationState,
} from "../src/resource-adapter.ts";
import { descriptor } from "./descriptor.ts";

const OBSERVED_EFFECT = "Observes the ChatGPT Custom GPT carrier";

const success = (data?: unknown) => ({
	contract: "deployment.result.v1" as const,
	ok: true,
	status: "SUCCEEDED" as const,
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
	...(data === undefined ? {} : { data }),
});

// Custom GPT create/edit is Web-only; the frozen runtime flow references
// `actionRequired.kind = WEB` but the frozen `humanActionSchema` only carries
// `action` + `description`, so Web-only is encoded in the action id/description.
const actionRequired = (action: string, description: string) => ({
	contract: "deployment.result.v1" as const,
	ok: false,
	status: "ACTION_REQUIRED" as const,
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
	actionRequired: { action, description },
});

type CheckStatus = "PASS" | "FAIL" | "WARN" | "SKIP";

function checkStatus(state: VerificationState): CheckStatus {
	switch (state) {
		case "VERIFIED":
			return "PASS";
		case "FAILED":
			return "FAIL";
		case "NOT_REQUIRED":
			return "SKIP";
		case "UNVERIFIED":
			return "WARN";
	}
}

type CarrierVerificationKey = Exclude<
	keyof CarrierVerificationObservation,
	"message"
>;

const VERIFY_CHECKS: {
	key: CarrierVerificationKey;
	id: string;
	description: string;
}[] = [
	{
		key: "reachable",
		id: "carrier-role-reachable",
		description: "Custom GPT role/carrier is reachable",
	},
	{
		key: "actionsEnabled",
		id: "carrier-actions-schema",
		description: "Static Actions OpenAPI schema is current",
	},
	{
		key: "openApiInstalled",
		id: "carrier-openapi",
		description: "OpenAPI schema is installed on the carrier",
	},
	{
		key: "actionAuthValid",
		id: "carrier-auth",
		description: "Action auth is valid",
	},
	{
		key: "fileBridge",
		id: "carrier-file-bridge",
		description: "File Bridge is usable",
	},
	{
		key: "codeInterpreter",
		id: "carrier-code-interpreter",
		description: "Code interpreter is available when required",
	},
	{
		key: "webSearch",
		id: "carrier-web-search",
		description: "Web search is available when required",
	},
	{
		key: "appsDisabledWhenRequired",
		id: "carrier-apps-disabled",
		description: "Apps are disabled when required",
	},
];

const REQUIRED_KEYS = new Set<CarrierVerificationKey>([
	"reachable",
	"actionsEnabled",
	"openApiInstalled",
	"actionAuthValid",
]);

type CarrierHealth = "HEALTHY" | "UNVERIFIED" | "FAILED";

// Single shared reality evaluator used by preflight / verify / doctor so they
// never diverge on what "healthy" means. Reachability alone can never be HEALTHY.
function evaluateCarrierObservation(
	observation: CarrierVerificationObservation,
): CarrierHealth {
	const anyFailed = VERIFY_CHECKS.some(
		(check) => observation[check.key] === "FAILED",
	);
	if (anyFailed) return "FAILED";
	const requiredOk = [...REQUIRED_KEYS].every(
		(key) => observation[key] === "VERIFIED",
	);
	if (!requiredOk) return "UNVERIFIED";
	const conditionalOk = VERIFY_CHECKS.filter(
		(check) => !REQUIRED_KEYS.has(check.key),
	).every(
		(check) =>
			observation[check.key] === "VERIFIED" ||
			observation[check.key] === "NOT_REQUIRED",
	);
	return conditionalOk ? "HEALTHY" : "UNVERIFIED";
}

function buildVerificationChecks(observation: CarrierVerificationObservation) {
	return VERIFY_CHECKS.map((check) => ({
		id: check.id,
		status: checkStatus(observation[check.key]),
		message: check.description,
	}));
}

function claimsFrom(probe: CarrierProbeResult) {
	const isReachable =
		probe.availability === "AVAILABLE" && probe.evidence === "real";
	return {
		readinessClaim: isReachable ? ("READY" as const) : ("NOT_READY" as const),
		readinessEvidence: probe.evidence,
		externalAvailabilityClaim: probe.availability,
		externalAvailabilityEvidence: probe.evidence,
	};
}

function reachable(probe: CarrierProbeResult): boolean {
	return probe.availability === "AVAILABLE" && probe.evidence === "real";
}

export function createBehaviorAdapter(input?: CarrierProbeInput) {
	return {
		describe: () => ({
			result: success({
				resourceIdentity: descriptor.moduleRef,
				carrierKind: "custom-gpt",
				observableLifecycle: ["status", "verify", "doctor"],
			}),
			observedEffects: [],
		}),
		preflight: async () => {
			const observation = await observeCarrierVerification(input);
			const health = evaluateCarrierObservation(observation);
			return {
				result:
					health === "HEALTHY"
						? success()
						: actionRequired(
								"materialize-custom-gpt-carrier",
								observation.message ??
									"Custom GPT carrier prerequisites are not yet verified",
							),
				observedEffects: [],
			};
		},
		status: async () => {
			const probe = await probeCarrier(input);
			const isReachable = reachable(probe);
			return {
				result: isReachable
					? {
							...success(),
							checks: [
								{
									id: "carrier-status",
									status: "PASS" as const,
									message: probe.message,
								},
							],
						}
					: {
							...actionRequired(
								"materialize-custom-gpt-carrier",
								probe.message,
							),
							checks: [
								{
									id: "carrier-status",
									status: "WARN" as const,
									message: probe.message,
								},
							],
						},
				observedEffects: isReachable ? [OBSERVED_EFFECT] : [],
				...claimsFrom(probe),
			};
		},
		verify: async () => {
			const observation = await observeCarrierVerification(input);
			const checks = buildVerificationChecks(observation);
			const health = evaluateCarrierObservation(observation);
			return {
				result:
					health === "HEALTHY"
						? { ...success(), checks }
						: {
								...actionRequired(
									"verify-carrier",
									observation.message ??
										"Carrier verification is incomplete: reachability alone does not prove schema/auth/File Bridge correctness",
								),
								checks,
							},
				observedEffects:
					observation.reachable === "VERIFIED" ? [OBSERVED_EFFECT] : [],
				readinessClaim:
					health === "HEALTHY" ? ("READY" as const) : ("NOT_READY" as const),
			};
		},
		doctor: async () => {
			const observation = await observeCarrierVerification(input);
			const health = evaluateCarrierObservation(observation);
			return {
				result:
					health === "HEALTHY"
						? {
								...success(),
								checks: [
									{
										id: "carrier-diagnostics",
										status: "PASS" as const,
										message:
											"Carrier observation satisfies required and conditional prerequisites",
									},
								],
							}
						: {
								...actionRequired(
									"verify-carrier",
									observation.message ??
										"Carrier prerequisites are not fully verified",
								),
								checks: [
									{
										id: "carrier-diagnostics",
										status: "FAIL" as const,
										message:
											"Carrier observation does not satisfy required prerequisites",
									},
								],
							},
				observedEffects: [],
			};
		},
	};
}

export const behaviorAdapter = createBehaviorAdapter();

type CarrierVerificationEvidenceFile = {
	contract: "proflow.chatgpt-carrier-verification.v1";
	carrierUrl: string;
	observedAt: string;
	reachable: VerificationState;
	actionsEnabled: VerificationState;
	openApiInstalled: VerificationState;
	actionAuthValid: VerificationState;
	fileBridge: VerificationState;
	codeInterpreter: VerificationState;
	webSearch: VerificationState;
	appsDisabledWhenRequired: VerificationState;
	message?: string;
};

const VERIFICATION_STATES = new Set<VerificationState>([
	"VERIFIED",
	"UNVERIFIED",
	"FAILED",
	"NOT_REQUIRED",
]);

async function readProductionVerificationEvidence(
	file: string | undefined,
	carrierUrl: string,
): Promise<CarrierVerificationObservation> {
	if (!file)
		return {
			...UNVERIFIED_CARRIER_VERIFICATION,
			message: "verificationEvidenceFile is not configured",
		};
	try {
		const raw = JSON.parse(
			await readFile(file, "utf8"),
		) as Partial<CarrierVerificationEvidenceFile>;
		const keys = [
			"reachable",
			"actionsEnabled",
			"openApiInstalled",
			"actionAuthValid",
			"fileBridge",
			"codeInterpreter",
			"webSearch",
			"appsDisabledWhenRequired",
		] as const;
		if (
			raw.contract !== "proflow.chatgpt-carrier-verification.v1" ||
			raw.carrierUrl !== carrierUrl ||
			typeof raw.observedAt !== "string" ||
			Number.isNaN(Date.parse(raw.observedAt)) ||
			!keys.every((key) =>
				VERIFICATION_STATES.has(raw[key] as VerificationState),
			)
		) {
			return {
				...UNVERIFIED_CARRIER_VERIFICATION,
				message:
					"Custom GPT verification evidence is malformed or bound to a different carrier URL",
			};
		}
		return {
			reachable: raw.reachable as VerificationState,
			actionsEnabled: raw.actionsEnabled as VerificationState,
			openApiInstalled: raw.openApiInstalled as VerificationState,
			actionAuthValid: raw.actionAuthValid as VerificationState,
			fileBridge: raw.fileBridge as VerificationState,
			codeInterpreter: raw.codeInterpreter as VerificationState,
			webSearch: raw.webSearch as VerificationState,
			appsDisabledWhenRequired:
				raw.appsDisabledWhenRequired as VerificationState,
			...(typeof raw.message === "string" ? { message: raw.message } : {}),
		};
	} catch (error) {
		return {
			...UNVERIFIED_CARRIER_VERIFICATION,
			message:
				error instanceof Error
					? error.message
					: "Custom GPT verification evidence could not be read",
		};
	}
}

export function createProductionBinding(input: {
	moduleRef: string;
	config: Record<string, string>;
}): { behaviorAdapter: Record<string, unknown> } {
	const carrierUrl = input.config.carrierUrl ?? "https://chatgpt.com/";
	const verificationEvidenceFile = input.config.verificationEvidenceFile;
	return {
		behaviorAdapter: createBehaviorAdapter({
			carrierUrl,
			observeVerification: () =>
				readProductionVerificationEvidence(
					verificationEvidenceFile,
					carrierUrl,
				),
			async observeCarrier() {
				try {
					const response = await fetch(carrierUrl, {
						method: "HEAD",
						redirect: "follow",
						signal: AbortSignal.timeout(5_000),
					});
					if (response.ok) {
						return {
							availability: "AVAILABLE" as const,
							evidence: "real" as const,
							message: "Configured Custom GPT carrier URL is reachable",
						};
					}
					if (response.status === 401 || response.status === 403) {
						const verification = await readProductionVerificationEvidence(
							verificationEvidenceFile,
							carrierUrl,
						);
						if (evaluateCarrierObservation(verification) === "HEALTHY") {
							return {
								availability: "AVAILABLE" as const,
								evidence: "real" as const,
								message: `Carrier URL is protected (HTTP ${response.status}) and verified Web carrier evidence is healthy`,
							};
						}
					}
					return {
						availability: "UNAVAILABLE" as const,
						evidence: "real" as const,
						message: `Carrier URL returned HTTP ${response.status}`,
					};
				} catch (error) {
					return {
						availability: "UNKNOWN" as const,
						evidence: "real" as const,
						message:
							error instanceof Error
								? error.message
								: "Carrier reachability observation failed",
					};
				}
			},
		}),
	};
}
