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
	status: () => ({ result, observedEffects: [] }),
	verify: () => ({
		result: {
			...result,
			checks: [
				{
					id: "migration-state-pass",
					status: "PASS",
					message: "Migration verification primitive is available",
				},
			],
		},
		observedEffects: [],
	}),
	doctor: () => ({ result, observedEffects: [] }),
	migrate: () => ({
		result,
		observedEffects: ["applies declared SQLite migrations when configured"],
	}),
} as const;
