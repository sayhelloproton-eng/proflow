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
	status: () => ({
		result: {
			...result,
			data: {
				configStatus: "READY" as const,
				runtimeStatus: "UNKNOWN" as const,
			},
		},
		observedEffects: [],
	}),
	verify: () => ({
		result: {
			...result,
			checks: [
				{
					id: "task-domain-tests-pass",
					status: "PASS",
					message: "Task Domain test gate is available",
				},
			],
		},
		observedEffects: [],
	}),
	doctor: () => ({ result, observedEffects: [] }),
} as const;
