import { constants } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { ModuleCommandContext } from "@tomflow/proflow-module-contract";
import { descriptor } from "./descriptor.ts";

const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;
const roots = (context: ModuleCommandContext) => ({
	projectRoot: resolve(context.workspaceRoot),
	artifactRoot: join(
		resolve(context.workspaceRoot),
		".proflow",
		"artifacts",
		"execution",
	),
});
async function ready(context: ModuleCommandContext): Promise<boolean> {
	const { projectRoot, artifactRoot } = roots(context);
	try {
		const project = await stat(projectRoot);
		if (!project.isDirectory()) return false;
		await access(projectRoot, constants.R_OK | constants.W_OK);
		await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
		await access(artifactRoot, constants.R_OK | constants.W_OK);
		return true;
	} catch {
		return false;
	}
}
const noRuntime = {
	setupStatus: "READY",
	runtimeStatus: "NOT_APPLICABLE",
} as const;
export const behaviorAdapter = {
	install: async (context: ModuleCommandContext) => {
		const { artifactRoot } = roots(context);
		await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
		return { result: { ...base, data: roots(context) }, observedEffects: [] };
	},
	uninstall: async (_context: ModuleCommandContext) => ({
		result: base,
		observedEffects: [],
	}),
	status: async (context: ModuleCommandContext) => ({
		result: {
			...base,
			data: (await ready(context))
				? noRuntime
				: {
						setupStatus: "FAILED" as const,
						runtimeStatus: "NOT_APPLICABLE" as const,
					},
		},
		observedEffects: [],
	}),
	setup: async (context: ModuleCommandContext) => ({
		result: (await ready(context))
			? base
			: {
					...base,
					ok: false as const,
					status: "FAILED" as const,
					error: {
						code: "SETUP_FAILED" as const,
						message:
							"execution-local deterministic workspace paths are not writable",
						retryable: true,
					},
				},
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
