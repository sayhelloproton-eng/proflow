export type CarrierAvailability = "UNKNOWN" | "AVAILABLE" | "UNAVAILABLE";
export type CarrierEvidence = "none" | "fake" | "real";

export type VerificationState =
	| "VERIFIED"
	| "UNVERIFIED"
	| "FAILED"
	| "NOT_REQUIRED";

export interface CarrierVerificationObservation {
	reachable: VerificationState;
	actionsEnabled: VerificationState;
	openApiInstalled: VerificationState;
	actionAuthValid: VerificationState;
	fileBridge: VerificationState;
	codeInterpreter: VerificationState;
	webSearch: VerificationState;
	appsDisabledWhenRequired: VerificationState;
	message?: string;
}

export interface CarrierProbeResult {
	availability: CarrierAvailability;
	evidence: CarrierEvidence;
	message: string;
}

export interface CarrierProbeInput {
	carrierUrl?: string;
	observeCarrier?: () => Promise<CarrierProbeResult>;
	observeVerification?: () => Promise<CarrierVerificationObservation>;
}

export const UNREACHABLE_CARRIER: CarrierProbeResult = {
	availability: "UNKNOWN",
	evidence: "none",
	message:
		"No real ChatGPT Custom GPT carrier is bound; reachability requires real Chrome / Custom GPT manual E2E",
};

export const UNVERIFIED_CARRIER_VERIFICATION: CarrierVerificationObservation = {
	reachable: "UNVERIFIED",
	actionsEnabled: "UNVERIFIED",
	openApiInstalled: "UNVERIFIED",
	actionAuthValid: "UNVERIFIED",
	fileBridge: "UNVERIFIED",
	codeInterpreter: "UNVERIFIED",
	webSearch: "UNVERIFIED",
	appsDisabledWhenRequired: "UNVERIFIED",
	message: "No real carrier verification observation is bound",
};

export async function probeCarrier(
	input: CarrierProbeInput | undefined,
): Promise<CarrierProbeResult> {
	if (input?.observeCarrier === undefined) return UNREACHABLE_CARRIER;
	try {
		return await input.observeCarrier();
	} catch (error) {
		return {
			availability: "UNKNOWN",
			evidence: "none",
			message: error instanceof Error ? error.message : "carrier probe failed",
		};
	}
}

export async function observeCarrierVerification(
	input: CarrierProbeInput | undefined,
): Promise<CarrierVerificationObservation> {
	if (input?.observeVerification === undefined) {
		return UNVERIFIED_CARRIER_VERIFICATION;
	}
	try {
		return await input.observeVerification();
	} catch (error) {
		return {
			...UNVERIFIED_CARRIER_VERIFICATION,
			message:
				error instanceof Error
					? error.message
					: "carrier verification probe failed",
		};
	}
}
