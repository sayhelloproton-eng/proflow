import { descriptor } from "./descriptor.ts";

type ProcessService = {
	start(): Promise<{ host: string; port: number }>;
	stop(): Promise<void>;
	restart(): Promise<{ host: string; port: number }>;
	status(): { readiness: "READY" | "NOT_READY" };
};

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

export function createBehaviorAdapter(service?: ProcessService) {
	return {
		describe: () => ({ result: base, observedEffects: [] }),
		preflight: () => ({ result: base, observedEffects: [] }),
		status: () => ({
			result: service ? { ...base, data: service.status() } : unbound,
			observedEffects: [],
		}),
		verify: () => ({
			result: {
				...(service ? base : unbound),
				checks: [
					{
						id: "execution-runtime-critical-proofs",
						status: service?.status().readiness === "READY" ? "PASS" : "FAIL",
						message: service
							? "Bound process exposes current durable runtime readiness"
							: "No configured Execution Runtime process is bound",
					},
				],
			},
			observedEffects: [],
		}),
		doctor: () => ({ result: base, observedEffects: [] }),
		start: async () => ({
			result: service ? { ...base, data: await service.start() } : unbound,
			observedEffects: service
				? [...descriptor.effects.map((item) => item.description)]
				: [],
		}),
		stop: async () => {
			if (service) await service.stop();
			return {
				result: service ? base : unbound,
				observedEffects: service
					? [...descriptor.effects.map((item) => item.description)]
					: [],
			};
		},
		restart: async () => ({
			result: service ? { ...base, data: await service.restart() } : unbound,
			observedEffects: service
				? [...descriptor.effects.map((item) => item.description)]
				: [],
		}),
	};
}

export const behaviorAdapter = createBehaviorAdapter();
