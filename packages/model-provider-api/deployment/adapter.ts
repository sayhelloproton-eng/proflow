import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
	type ModuleCommandContext,
	writeModuleSharedFacts,
} from "@tomflow/proflow-module-contract";
import type { ProviderProbeResult } from "../src/resource-adapter.ts";
import { createProviderProbe } from "../src/resource-adapter.ts";
import { descriptor } from "./descriptor.ts";

export type ProviderProbe = () => Promise<ProviderProbeResult>;
type ProviderSetupConfig = {
	providerBaseUrl: string;
	providerCredential?: string;
};
const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;
const effect = "Probes the configured OpenAI-compatible model provider API";
const configPath = (context: ModuleCommandContext) =>
	join(
		resolve(context.workspaceRoot),
		".proflow",
		"config",
		"model-provider-api.json",
	);
async function readConfig(
	context: ModuleCommandContext,
): Promise<ProviderSetupConfig | undefined> {
	try {
		const raw: unknown = JSON.parse(
			await readFile(configPath(context), "utf8"),
		);
		if (typeof raw !== "object" || raw === null || Array.isArray(raw))
			return undefined;
		const providerBaseUrl = Reflect.get(raw, "providerBaseUrl");
		const providerCredential = Reflect.get(raw, "providerCredential");
		if (typeof providerBaseUrl !== "string" || providerBaseUrl.length === 0)
			return undefined;
		return {
			providerBaseUrl,
			...(typeof providerCredential === "string" &&
			providerCredential.length > 0
				? { providerCredential }
				: {}),
		};
	} catch {
		return undefined;
	}
}
function inputConfig(
	context: ModuleCommandContext,
): ProviderSetupConfig | undefined {
	const input = context.input;
	if (typeof input !== "object" || input === null || Array.isArray(input))
		return undefined;
	const providerBaseUrl = Reflect.get(input, "providerBaseUrl");
	const providerCredential = Reflect.get(input, "providerCredential");
	if (typeof providerBaseUrl !== "string" || providerBaseUrl.length === 0)
		return undefined;
	return {
		providerBaseUrl,
		...(typeof providerCredential === "string" && providerCredential.length > 0
			? { providerCredential }
			: {}),
	};
}
async function probe(
	config: ProviderSetupConfig,
): Promise<ProviderProbeResult> {
	return createProviderProbe({ baseUrl: config.providerBaseUrl })();
}
export const behaviorAdapter = {
	install: async (context: ModuleCommandContext) => {
		await mkdir(dirname(configPath(context)), { recursive: true, mode: 0o700 });
		const config = await readConfig(context);
		if (config)
			await writeModuleSharedFacts(context, descriptor.moduleRef, config);
		return { result: base, observedEffects: [] };
	},
	uninstall: async (_context: ModuleCommandContext) => ({
		result: base,
		observedEffects: [],
	}),
	status: async (context: ModuleCommandContext) => {
		const config = await readConfig(context);
		if (!config)
			return {
				result: {
					...base,
					data: {
						setupStatus: "ACTION_REQUIRED" as const,
						runtimeStatus: "STOPPED" as const,
					},
				},
				observedEffects: [],
			};
		const observation = await probe(config);
		const credentialResolverMissing =
			Boolean(config.providerCredential) && !observation.authenticated;
		return {
			result: {
				...base,
				data: {
					setupStatus:
						observation.reachable && observation.authenticated
							? ("READY" as const)
							: credentialResolverMissing
								? ("FAILED" as const)
								: ("ACTION_REQUIRED" as const),
					runtimeStatus:
						observation.reachable && observation.authenticated
							? ("RUNNING" as const)
							: ("STOPPED" as const),
				},
			},
			observedEffects: [effect],
			externalAvailabilityClaim: observation.reachable
				? ("AVAILABLE" as const)
				: ("UNAVAILABLE" as const),
			externalAvailabilityEvidence: "real" as const,
		};
	},
	setup: async (context: ModuleCommandContext) => {
		const supplied = inputConfig(context);
		if (supplied) {
			await mkdir(dirname(configPath(context)), {
				recursive: true,
				mode: 0o700,
			});
			await writeFile(
				configPath(context),
				`${JSON.stringify(supplied, null, 2)}\n`,
				{ encoding: "utf8", mode: 0o600 },
			);
		}
		const config = supplied ?? (await readConfig(context));
		if (!config)
			return {
				result: {
					...base,
					ok: false as const,
					status: "ACTION_REQUIRED" as const,
					actionRequired: {
						action: "configure-provider",
						description:
							"Provide providerBaseUrl and, when required, providerCredential to Module.setup.",
					},
				},
				observedEffects: [],
			};
		await writeModuleSharedFacts(context, descriptor.moduleRef, config);
		const observation = await probe(config);
		if (observation.reachable && observation.authenticated)
			return { result: base, observedEffects: [effect] };
		if (config.providerCredential)
			return {
				result: {
					...base,
					ok: false as const,
					status: "FAILED" as const,
					error: {
						code: "SETUP_FAILED" as const,
						message:
							"providerCredential is a secretRef, but no provider credential resolver contract is available to this Module",
						retryable: false,
					},
				},
				observedEffects: [effect],
			};
		return {
			result: {
				...base,
				ok: false as const,
				status: "ACTION_REQUIRED" as const,
				actionRequired: {
					action: "repair-provider",
					description: observation.message,
				},
			},
			observedEffects: [effect],
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
} as const;
