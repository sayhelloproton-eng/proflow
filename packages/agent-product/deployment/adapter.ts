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
		result: {
			...base,
			ok: false,
			status: "ACTION_REQUIRED",
			actionRequired: {
				action: "materialize-custom-gpt",
				description: "Apply package material in the Custom GPT editor",
			},
		},
		observedEffects: [],
	}),
	verify: () => ({
		result: {
			...base,
			checks: [
				{
					id: "agent-package-material",
					status: "PASS",
					message: "Static package material is present",
				},
			],
		},
		observedEffects: [],
	}),
	doctor: () => ({ result: base, observedEffects: [] }),
} as const;
