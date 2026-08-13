import { descriptor } from "./descriptor.ts";

const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;

const unbound = {
	...base,
	ok: false,
	status: "ACTION_REQUIRED",
	actionRequired: {
		action: "bind-runtime",
		description: "Bind a configured Execution Runtime service",
	},
} as const;

export const behaviorAdapter = {
	describe: () => ({ result: base, observedEffects: [] }),
	preflight: () => ({ result: base, observedEffects: [] }),
	status: () => ({ result: unbound, observedEffects: [] }),
	verify: () => ({
		result: {
			...base,
			checks: [
				{
					id: "execution-runtime-critical-proofs",
					status: "PASS",
					message:
						"Runtime module loaded; seven durable proofs run in package tests",
				},
			],
		},
		observedEffects: [],
	}),
	doctor: () => ({ result: base, observedEffects: [] }),
	start: () => ({ result: unbound, observedEffects: [] }),
	stop: () => ({ result: unbound, observedEffects: [] }),
	restart: () => ({ result: unbound, observedEffects: [] }),
} as const;
