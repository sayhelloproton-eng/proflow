import { observeDeclaredModuleStatus } from "@tomflow/proflow-module-contract";

import { descriptor } from "./descriptor.ts";

const success = (data?: unknown) => ({
	contract: "deployment.result.v1" as const,
	ok: true,
	status: "SUCCEEDED" as const,
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
	...(data === undefined ? {} : { data }),
});

export const behaviorAdapter = {
	describe: () => ({
		result: success({ role: "deployment-governance", kind: descriptor.kind }),
		observedEffects: [],
	}),
	preflight: () => ({ result: success(), observedEffects: [] }),
	status: () => ({
		result: success(
			observeDeclaredModuleStatus(descriptor, undefined, "UNKNOWN"),
		),
		observedEffects: [],
	}),
	verify: () => ({
		result: success(),
		observedEffects: [],
	}),
	doctor: () => ({ result: success(), observedEffects: [] }),
};
