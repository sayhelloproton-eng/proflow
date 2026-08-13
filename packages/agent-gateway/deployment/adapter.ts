import { descriptor } from "./descriptor.ts";

const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;
export const behaviorAdapter = {
	describe: () => ({ result: base, observedEffects: [] }),
	preflight: () => ({ result: base, observedEffects: [] }),
	status: () => ({
		result: { ...base, data: { state: "COMPOSED_EXTERNALLY" } },
		observedEffects: [],
	}),
	verify: () => ({
		result: {
			...base,
			checks: [
				{
					id: "gateway-readiness",
					status: "PASS",
					message: "Gateway public package exposes runtime readiness",
				},
			],
		},
		observedEffects: [],
	}),
	doctor: () => ({ result: base, observedEffects: [] }),
	start: () => ({
		result: {
			...base,
			status: "ACTION_REQUIRED",
			ok: false,
			actionRequired: {
				action: "compose-gateway",
				description: "Provide owner ports before starting Gateway",
			},
		},
		observedEffects: [],
	}),
	stop: () => ({ result: base, observedEffects: [] }),
	restart: () => ({
		result: {
			...base,
			status: "ACTION_REQUIRED",
			ok: false,
			actionRequired: {
				action: "compose-gateway",
				description: "Provide owner ports before restarting Gateway",
			},
		},
		observedEffects: [],
	}),
} as const;
