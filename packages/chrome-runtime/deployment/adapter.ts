import { readFileSync } from "node:fs";

import type { ModuleCommandContext } from "@tomflow/proflow-module-contract";
import type {
	ChromeRuntimeInstaller,
	ChromeRuntimeProbe,
} from "../src/resource-adapter.ts";
import {
	installChromeRuntime,
	probeChromeRuntime,
} from "../src/resource-adapter.ts";
import { descriptor } from "./descriptor.ts";

const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;
const observedEffect =
	"Ensures and observes the Google Chrome runtime availability";

const failed = (code: "INSTALL_FAILED" | "SETUP_FAILED", message: string) => ({
	...base,
	ok: false as const,
	status: "FAILED" as const,
	error: { code, message, retryable: true },
});

export function createBehaviorAdapter(
	probe: ChromeRuntimeProbe = () => probeChromeRuntime(),
	installer: ChromeRuntimeInstaller = () => installChromeRuntime(),
) {
	const ensureChrome = async () => {
		let observation = await probe();
		if (observation.available) return observation;
		await installer();
		observation = await probe();
		if (!observation.available) throw new Error("CHROME_INSTALL_VERIFY_FAILED");
		return observation;
	};
	return {
		install: async (_context: ModuleCommandContext) => {
			try {
				const observation = await ensureChrome();
				return {
					result: { ...base, data: observation },
					observedEffects: [observedEffect],
				};
			} catch (error) {
				return {
					result: failed(
						"INSTALL_FAILED",
						error instanceof Error
							? error.message
							: "Chrome auto-install failed",
					),
					observedEffects: [observedEffect],
				};
			}
		},
		uninstall: async (_context: ModuleCommandContext) => ({
			result: base,
			observedEffects: [],
		}),
		status: async (_context: ModuleCommandContext) => {
			const observation = await probe();
			return {
				result: {
					...base,
					data: {
						setupStatus: observation.available
							? ("READY" as const)
							: ("ACTION_REQUIRED" as const),
						runtimeStatus: "NOT_APPLICABLE" as const,
						...(observation.available
							? {}
							: {
									issues: [
										{
											scope: "SETUP" as const,
											code: "CHROME_UNAVAILABLE",
											message: "未检测到可用的 Google Chrome",
											relatedModuleRefs: [],
											nextCommand: "platform install",
										},
									],
								}),
					},
				},
				observedEffects: [observedEffect],
				externalAvailabilityClaim: observation.available
					? ("AVAILABLE" as const)
					: ("UNAVAILABLE" as const),
				externalAvailabilityEvidence: "real" as const,
			};
		},
		setup: async (_context: ModuleCommandContext) => {
			try {
				const observation = await ensureChrome();
				return {
					result: { ...base, data: observation },
					observedEffects: [observedEffect],
				};
			} catch (error) {
				return {
					result: failed(
						"SETUP_FAILED",
						error instanceof Error
							? error.message
							: "Chrome auto-install failed",
					),
					observedEffects: [observedEffect],
				};
			}
		},
		docs: async (_context: ModuleCommandContext) => ({
			result: {
				...base,
				data: {
					docs: readFileSync(
						new URL(
							import.meta.url.includes("/dist/")
								? "../../DOCS.md"
								: "../DOCS.md",
							import.meta.url,
						),
						"utf8",
					),
				},
			},
			observedEffects: [],
		}),
		start: async (_context: ModuleCommandContext) => ({
			result: base,
			observedEffects: [],
		}),
		stop: async (_context: ModuleCommandContext) => ({
			result: base,
			observedEffects: [],
		}),
	};
}
export const behaviorAdapter = createBehaviorAdapter();
