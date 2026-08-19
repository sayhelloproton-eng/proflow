import {
	inferenceRequestSchema,
	MODEL_CONTRACT_DESCRIPTOR,
} from "../src/index.ts";
import { descriptor } from "./descriptor.ts";

const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;

export const behaviorAdapter = {
	describe: () => ({
		result: { ...base, data: MODEL_CONTRACT_DESCRIPTOR },
		observedEffects: [],
	}),
	preflight: () => ({ result: base, observedEffects: [] }),
	status: () => ({ result: { ...base, data: { configStatus: "READY" as const, runtimeStatus: "UNKNOWN" as const } }, observedEffects: [] }),
	verify: () => {
		const valid = inferenceRequestSchema.safeParse({
			contractVersion: "1.0.0",
			specRef: "verification.probe.v1",
			mode: "fast",
			priority: "background",
			trace: { callerRef: "deployment:model-contracts" },
			payload: {},
		}).success;
		return {
			result: {
				...base,
				ok: valid,
				status: valid ? ("SUCCEEDED" as const) : ("FAILED" as const),
				checks: [
					{
						id: "model-contract-boundaries",
						status: valid ? ("PASS" as const) : ("FAIL" as const),
						message: valid
							? "Model boundary schemas loaded and validated a typed probe"
							: "Model boundary schema verification failed",
					},
				],
				...(!valid
					? {
							error: {
								code: "VERIFY_FAILED",
								message: "Model contract boundary probe failed",
								retryable: false,
							},
						}
					: {}),
			},
			observedEffects: [],
		};
	},
	doctor: () => ({ result: base, observedEffects: [] }),
} as const;
