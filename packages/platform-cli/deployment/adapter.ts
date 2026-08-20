import type { ModuleCommandContext } from "@tomflow/proflow-module-contract";
import { descriptor } from "./descriptor.ts";

const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;
const noRuntime = {
	setupStatus: "READY",
	runtimeStatus: "NOT_APPLICABLE",
} as const;
export const behaviorAdapter = {
	install: async (_context: ModuleCommandContext) => ({
		result: base,
		observedEffects: [],
	}),
	uninstall: async (_context: ModuleCommandContext) => ({
		result: base,
		observedEffects: [],
	}),
	status: async (_context: ModuleCommandContext) => ({
		result: { ...base, data: noRuntime },
		observedEffects: [],
	}),
	setup: async (_context: ModuleCommandContext) => ({
		result: base,
		observedEffects: [],
	}),
	docs: async (_context: ModuleCommandContext) => ({
		result: { ...base, data: { docs: "DOCS.md", setup: "SETUP.md" } },
		observedEffects: [],
	}),
	start: async (_context: ModuleCommandContext) => ({
		result: base,
		observedEffects: [],
	}),
	stop: async (_context: ModuleCommandContext) => ({
		result: base,
		observedEffects: [],
	}),
} as const;
