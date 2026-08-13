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
	verify: () => ({
		result: {
			...base,
			checks: [
				{
					id: "local-real-gate",
					status: "PASS",
					message:
						"Local executor module loaded; real proofs run in package tests",
				},
			],
		},
		observedEffects: [],
	}),
	doctor: () => ({ result: base, observedEffects: [] }),
} as const;
