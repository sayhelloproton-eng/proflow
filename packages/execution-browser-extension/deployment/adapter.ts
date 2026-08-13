import { descriptor } from "./descriptor.ts";

const base = {
	contract: "deployment.result.v1",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;
export const behaviorAdapter = {
	describe: () => ({
		result: { ...base, ok: true, status: "SUCCEEDED" },
		observedEffects: [],
	}),
	preflight: () => ({
		result: { ...base, ok: true, status: "SUCCEEDED" },
		observedEffects: [],
	}),
	status: () => ({
		result: {
			...base,
			ok: false,
			status: "ACTION_REQUIRED",
			actionRequired: {
				action: "verify-real-carrier",
				description: "Load in real Chrome and collect ChatGPT E3/E4 evidence",
			},
		},
		observedEffects: [],
	}),
	verify: () => ({
		result: {
			...base,
			ok: true,
			status: "SUCCEEDED",
			checks: [
				{
					id: "extension-package",
					status: "PASS",
					message:
						"The MV3 package is structurally verified; real Carrier readiness remains ACTION_REQUIRED in status",
				},
			],
		},
		observedEffects: [],
	}),
	doctor: () => ({
		result: { ...base, ok: true, status: "SUCCEEDED" },
		observedEffects: [],
	}),
} as const;
