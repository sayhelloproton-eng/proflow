import { readFile } from "node:fs/promises";

import type {
	ChromeRuntimeObservation,
	ChromeRuntimeProbe,
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

const observedEffect =
	"Observes the Chrome runtime and MV3 extension prerequisite";

export function createBehaviorAdapter(input?: { probe: ChromeRuntimeProbe }) {
	const observe = async (): Promise<ChromeRuntimeObservation> => {
		if (!input) return { available: false, extensionLoaded: false };
		return input.probe();
	};

	return {
		describe: () => ({
			result: success({
				observes:
					"Chrome runtime availability, version, and MV3 extension prerequisite",
			}),
			observedEffects: [],
		}),
		preflight: () => ({
			result: input
				? success()
				: actionRequired(
						"bind-chrome-probe",
						"Bind a real Chrome runtime probe before observing availability",
					),
			observedEffects: [],
		}),
		status: async () => {
			if (!input) {
				return {
					result: actionRequired(
						"bind-chrome-probe",
						"No Chrome runtime probe is bound",
					),
					observedEffects: [],
				};
			}
			const observation = await observe();
			const message = observation.available
				? `Chrome runtime observed: ${observation.resourceVersion ?? "unknown version"}`
				: "Chrome runtime is not available on this host";
			return {
				result: observation.available
					? {
							...success(),
							...(observation.resourceVersion === undefined
								? {}
								: { resourceVersion: observation.resourceVersion }),
							checks: [
								{ id: "chrome-status", status: "PASS" as const, message },
							],
						}
					: {
							...actionRequired("install-or-expose-chrome", message),
							checks: [
								{ id: "chrome-status", status: "FAIL" as const, message },
							],
						},
				observedEffects: [observedEffect],
			};
		},
		verify: async () => {
			if (!input) {
				return {
					result: actionRequired(
						"bind-chrome-probe",
						"Real Chrome verification requires a bound probe",
					),
					observedEffects: [],
				};
			}
			const observation = await observe();
			if (!observation.available) {
				const message = "Chrome runtime is not available on this host";
				return {
					result: {
						...actionRequired("install-or-expose-chrome", message),
						checks: [
							{ id: "chrome-version", status: "FAIL" as const, message },
							{
								id: "chrome-extension-prerequisite",
								status: "FAIL" as const,
								message:
									"MV3 extension prerequisite cannot be verified without Chrome",
							},
						],
					},
					observedEffects: [observedEffect],
				};
			}
			const versionMessage = `Chrome runtime version observed: ${observation.resourceVersion ?? "unknown version"}`;
			if (observation.extensionLoaded) {
				return {
					result: {
						...success(),
						checks: [
							{
								id: "chrome-version",
								status: "PASS" as const,
								message: versionMessage,
							},
							{
								id: "chrome-extension-prerequisite",
								status: "PASS" as const,
								message: "MV3 extension load and authorization are verified",
							},
						],
					},
					observedEffects: [observedEffect],
				};
			}
			return {
				result: {
					...actionRequired(
						"load-and-verify-extension",
						"Load and verify the unpacked MV3 extension in the real Chrome profile",
					),
					checks: [
						{
							id: "chrome-version",
							status: "PASS" as const,
							message: versionMessage,
						},
						{
							id: "chrome-extension-prerequisite",
							status: "FAIL" as const,
							message:
								"MV3 extension load and authorization cannot be automated and have not been verified",
						},
					],
				},
				observedEffects: [observedEffect],
			};
		},
		doctor: async () => {
			if (!input) {
				return {
					result: actionRequired(
						"bind-chrome-probe",
						"Chrome diagnostics require a bound probe",
					),
					observedEffects: [],
				};
			}
			const observation = await observe();
			const message = observation.available
				? "Chrome runtime is reachable; extension load remains a manual prerequisite"
				: "Chrome runtime is not available on this host";
			return {
				result: observation.available
					? {
							...success(),
							checks: [
								{
									id: "chrome-diagnostics",
									status: "PASS" as const,
									message,
								},
							],
						}
					: {
							...actionRequired("install-or-expose-chrome", message),
							checks: [
								{
									id: "chrome-diagnostics",
									status: "FAIL" as const,
									message,
								},
							],
						},
				observedEffects: [observedEffect],
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
	const { probeChromeRuntime } = await import("../src/resource-adapter.ts");
	const chromeExecutablePath = input.config.chromeExecutablePath;
	const browserConfig = input.configByModuleRef.get(
		"execution-browser-extension",
	);
	const evidenceFile = browserConfig?.verificationEvidenceFile;
	const hasVerifiedExtensionEvidence = async (): Promise<boolean> => {
		if (!evidenceFile) return false;
		try {
			const raw = JSON.parse(await readFile(evidenceFile, "utf8")) as Record<
				string,
				unknown
			>;
			return (
				raw.contract === "proflow.browser-extension-verification.v1" &&
				typeof raw.extensionId === "string" &&
				raw.extensionId.length >= 16 &&
				raw.serviceWorker === "RUNNING" &&
				typeof raw.observedAt === "string" &&
				!Number.isNaN(Date.parse(raw.observedAt))
			);
		} catch {
			return false;
		}
	};
	return {
		behaviorAdapter: createBehaviorAdapter({
			probe: async () => {
				const observed = await probeChromeRuntime(chromeExecutablePath);
				return {
					...observed,
					extensionLoaded:
						observed.available && (await hasVerifiedExtensionEvidence()),
				};
			},
		}),
	};
}
