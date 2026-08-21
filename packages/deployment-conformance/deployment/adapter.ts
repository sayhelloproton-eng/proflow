import { readFileSync } from "node:fs";
import { descriptor } from "./descriptor.ts";

const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;

const success = () => ({ result: base, observedEffects: [] as string[] });

export const behaviorAdapter = {
	install: success,
	uninstall: success,
	status: () => ({
		result: {
			...base,
			data: {
				setupStatus: "READY" as const,
				runtimeStatus: "NOT_APPLICABLE" as const,
			},
		},
		observedEffects: [] as string[],
	}),
	setup: success,
	docs: () => ({
		result: {
			...base,
			data: {
				docs: readFileSync(new URL("../DOCS.md", import.meta.url), "utf8"),
			},
		},
		observedEffects: [] as string[],
	}),
	start: success,
	stop: success,
} as const;
