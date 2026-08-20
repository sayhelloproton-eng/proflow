import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { ModuleCommandContext } from "@tomflow/proflow-module-contract";
import type { ChromeRuntimeProbe } from "../src/resource-adapter.ts";
import { probeChromeRuntime } from "../src/resource-adapter.ts";
import { descriptor } from "./descriptor.ts";

const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;
const observedEffect =
	"Observes the Chrome runtime and MV3 extension prerequisite";
const configPath = (context: ModuleCommandContext) =>
	join(
		resolve(context.workspaceRoot),
		".proflow",
		"config",
		"chrome-runtime.json",
	);
async function readOverride(
	context: ModuleCommandContext,
): Promise<string | undefined> {
	try {
		const raw: unknown = JSON.parse(
			await readFile(configPath(context), "utf8"),
		);
		if (typeof raw !== "object" || raw === null || Array.isArray(raw))
			return undefined;
		const value = Reflect.get(raw, "chromeExecutablePath");
		return typeof value === "string" && value.length > 0 ? value : undefined;
	} catch {
		return undefined;
	}
}
function setupInput(context: ModuleCommandContext): string | undefined {
	const input = context.input;
	if (typeof input !== "object" || input === null || Array.isArray(input))
		return undefined;
	const value = Reflect.get(input, "chromeExecutablePath");
	return typeof value === "string" && value.length > 0 ? value : undefined;
}
export function createBehaviorAdapter(
	probe: ChromeRuntimeProbe = () => probeChromeRuntime(),
) {
	const observe = async (context: ModuleCommandContext) => {
		const override = await readOverride(context);
		return override ? probeChromeRuntime(override) : probe();
	};
	return {
		install: async (context: ModuleCommandContext) => {
			await mkdir(dirname(configPath(context)), {
				recursive: true,
				mode: 0o700,
			});
			return { result: base, observedEffects: [] };
		},
		uninstall: async (_context: ModuleCommandContext) => ({
			result: base,
			observedEffects: [],
		}),
		status: async (context: ModuleCommandContext) => {
			const observation = await observe(context);
			return {
				result: {
					...base,
					data: {
						setupStatus: observation.available
							? ("READY" as const)
							: ("ACTION_REQUIRED" as const),
						runtimeStatus: observation.available
							? ("RUNNING" as const)
							: ("STOPPED" as const),
					},
				},
				observedEffects: [observedEffect],
				externalAvailabilityClaim: observation.available
					? ("AVAILABLE" as const)
					: ("UNAVAILABLE" as const),
				externalAvailabilityEvidence: "real" as const,
			};
		},
		setup: async (context: ModuleCommandContext) => {
			let observation = await observe(context);
			if (observation.available)
				return { result: base, observedEffects: [observedEffect] };
			const explicit = setupInput(context);
			if (explicit) {
				await mkdir(dirname(configPath(context)), {
					recursive: true,
					mode: 0o700,
				});
				await writeFile(
					configPath(context),
					`${JSON.stringify({ chromeExecutablePath: explicit }, null, 2)}\n`,
					{ encoding: "utf8", mode: 0o600 },
				);
				observation = await probeChromeRuntime(explicit);
				if (observation.available)
					return { result: base, observedEffects: [observedEffect] };
			}
			return {
				result: {
					...base,
					ok: false as const,
					status: "ACTION_REQUIRED" as const,
					actionRequired: {
						action: "install-or-expose-chrome",
						description: `Install a supported Chrome/Chromium runtime and rerun platform setup --module chrome-runtime --workspace ${JSON.stringify(context.workspaceRoot)}; if auto-detection still fails, rerun with --input '{"chromeExecutablePath":"<absolute-path>"}'.`,
					},
				},
				observedEffects: [observedEffect],
			};
		},
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
	};
}
export const behaviorAdapter = createBehaviorAdapter();
