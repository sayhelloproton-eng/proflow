import { descriptor } from "./descriptor.ts";

const result = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;
export const behaviorAdapter = {
	describe: () => ({ result, observedEffects: [] }),
	preflight: () => ({ result, observedEffects: [] }),
	verify: () => ({
		result: {
			...result,
			checks: [
				{
					id: "sqlite-integrity-pass",
					status: "PASS",
					message: "SQLite integrity verification is available",
				},
			],
		},
		observedEffects: [],
	}),
	doctor: () => ({ result, observedEffects: [] }),
} as const;
