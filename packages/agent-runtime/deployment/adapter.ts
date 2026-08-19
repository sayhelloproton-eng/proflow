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
	status: () => ({ result: { ...base, data: { configStatus: "READY" as const, runtimeStatus: "UNKNOWN" as const } }, observedEffects: [] }),
	verify: () => ({
		result: {
			...base,
			checks: [
				{
					id: "agent-runtime-boundary",
					status: "PASS",
					message: "Agent runtime is loaded through its public package",
				},
			],
		},
		observedEffects: [],
	}),
	doctor: () => ({ result: base, observedEffects: [] }),
} as const;
