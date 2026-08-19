import { parseExecuteCapabilityRequest } from "../src/index.ts";
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
			ok: true,
			status: "SUCCEEDED",
			checks: [
				{
					id: "execution-contract-boundaries",
					status: "PASS",
					message: parseExecuteCapabilityRequest({
						contract: "execution",
						contractVersion: "1.0.0",
						callerRef: "deployment:execution-contracts",
						idempotencyKey: "verification",
						capability: "file.read",
						input: { path: "README.md" },
					})
						? "Execution contract boundary validated a typed probe"
						: "Execution contract boundary probe failed",
				},
			],
		},
		observedEffects: [],
	}),
	doctor: () => ({ result: base, observedEffects: [] }),
} as const;
