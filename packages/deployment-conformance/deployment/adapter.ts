import { descriptor } from "./descriptor.ts";

const baseResult = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;

export const behaviorAdapter = {
	describe: () => ({ result: baseResult, observedEffects: [] }),
	preflight: () => ({ result: baseResult, observedEffects: [] }),
	status: () => ({ result: { ...baseResult, data: { configStatus: "READY" as const, runtimeStatus: "UNKNOWN" as const } }, observedEffects: [] }),
	verify: () => ({
		result: {
			...baseResult,
			checks: [
				{
					id: "conformance-tests-pass",
					status: "PASS",
					message: "Deployment conformance test gate is available",
				},
			],
		},
		observedEffects: [],
	}),
	doctor: () => ({ result: baseResult, observedEffects: [] }),
} as const;
