import { descriptor } from "./descriptor.ts";

type GatewayProcess = {
	start(): Promise<{ host: string; port: number }>;
	stop(): Promise<void>;
	restart(): Promise<{ host: string; port: number }>;
	readiness(): Promise<{ status: "READY" | "NOT_READY" }>;
	status(): unknown;
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
		action: "compose-gateway",
		description: "Provide owner ports and process configuration",
	},
} as const;
export function createBehaviorAdapter(service?: GatewayProcess) {
	return {
		describe: () => ({ result: base, observedEffects: [] }),
		preflight: () => ({ result: base, observedEffects: [] }),
		status: () => ({
			result: service ? { ...base, data: service.status() } : unbound,
			observedEffects: [],
		}),
		verify: async () => ({
			result: {
				...(service ? base : unbound),
				checks: [
					{
						id: "gateway-readiness",
						status:
							service && (await service.readiness()).status === "READY"
								? "PASS"
								: "FAIL",
						message: service
							? "Bound Gateway process reports current dependency readiness"
							: "No configured Gateway process is bound",
					},
				],
			},
			observedEffects: [],
		}),
		doctor: () => ({ result: base, observedEffects: [] }),
		start: async () => ({
			result: {
				...base,
				...(service
					? { data: await service.start() }
					: {
							status: "ACTION_REQUIRED" as const,
							ok: false,
							actionRequired: {
								action: "compose-gateway",
								description: "Provide owner ports before starting Gateway",
							},
						}),
			},
			observedEffects: service ? ["Manage the declared service process"] : [],
		}),
		stop: async () => {
			if (service) await service.stop();
			return {
				result: service ? base : unbound,
				observedEffects: service ? ["Manage the declared service process"] : [],
			};
		},
		restart: async () => ({
			result: {
				...base,
				...(service
					? { data: await service.restart() }
					: {
							status: "ACTION_REQUIRED" as const,
							ok: false,
							actionRequired: {
								action: "compose-gateway",
								description: "Provide owner ports before restarting Gateway",
							},
						}),
			},
			observedEffects: service ? ["Manage the declared service process"] : [],
		}),
	};
}

export const behaviorAdapter = createBehaviorAdapter();
