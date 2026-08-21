import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { ModelCapabilityProfile } from "@tomflow/proflow-model-contracts";
import {
	deterministicLoopbackPort,
	ensureModuleSecretFile,
	type ModuleCommandContext,
	moduleWorkspaceStateDirectory,
	readModuleSharedFacts,
	writeModuleSharedFacts,
} from "@tomflow/proflow-module-contract";
import type { ModelRuntimeService } from "../src/service.ts";
import { descriptor } from "./descriptor.ts";

type SetupConfig = {
	fastModel: string;
	reasonModel: string;
};
const services = new Map<string, ModelRuntimeService>();
const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;
const setupPlan = {
	steps: [
		{
			id: "STEP-MODEL-RUNTIME-01",
			title: "选择 FAST 与 REASON 模型",
			state: "TODO",
			responsible: "USER",
			execution: {
				interactive: "proflow-model-runtime setup",
				nonInteractive:
					"proflow-model-runtime setup --fast-model <id> --reason-model <id>",
			},
			requiredInputs: [
				{ name: "fastModel", description: "FAST 模型 ID", sensitive: false },
				{
					name: "reasonModel",
					description: "REASON 模型 ID",
					sensitive: false,
				},
			],
			verify: "proflow-model-runtime verify",
			successCondition: "配置状态变为“已就绪”",
		},
	],
} as const;
const blockedSetupPlan = {
	steps: [
		{
			id: "STEP-MODEL-RUNTIME-02",
			title: "等待模型服务与能力事实",
			state: "BLOCKED",
			responsible: "EXTERNAL",
			execution: {
				interactive: "platform setup --module model-runtime",
				nonInteractive: "platform setup --module model-runtime",
			},
			requiredInputs: [],
			verify: "proflow-model-runtime verify",
			successCondition: "配置状态变为“已就绪”",
			blockedReason: "模型服务共享事实或模型能力验证尚不可用",
		},
	],
} as const;
const key = (context: ModuleCommandContext) => resolve(context.workspaceRoot);
const stateDir = (context: ModuleCommandContext) =>
	moduleWorkspaceStateDirectory(context, descriptor.moduleRef);
const setupPath = (context: ModuleCommandContext) =>
	join(stateDir(context), "setup.json");
const factString = (
	facts: Record<string, unknown> | undefined,
	name: string,
) => (typeof facts?.[name] === "string" ? String(facts[name]) : undefined);
async function ownFacts(context: ModuleCommandContext) {
	await mkdir(stateDir(context), { recursive: true, mode: 0o700 });
	const facts = {
		endpoint: `http://127.0.0.1:${deterministicLoopbackPort(context, descriptor.moduleRef)}`,
		transportCredentialFile: await ensureModuleSecretFile(
			context,
			descriptor.moduleRef,
			"transport",
		),
		stateRoot: stateDir(context),
	};
	await writeModuleSharedFacts(context, descriptor.moduleRef, facts);
	return facts;
}
function supplied(context: ModuleCommandContext): SetupConfig | undefined {
	const value = context.input;
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return undefined;
	const fastModel = Reflect.get(value, "fastModel"),
		reasonModel = Reflect.get(value, "reasonModel");
	return typeof fastModel === "string" &&
		fastModel &&
		typeof reasonModel === "string" &&
		reasonModel
		? { fastModel, reasonModel }
		: undefined;
}
async function readSetup(
	context: ModuleCommandContext,
): Promise<SetupConfig | undefined> {
	try {
		const raw = JSON.parse(await readFile(setupPath(context), "utf8"));
		return typeof raw.fastModel === "string" &&
			typeof raw.reasonModel === "string"
			? { fastModel: raw.fastModel, reasonModel: raw.reasonModel }
			: undefined;
	} catch {
		return undefined;
	}
}
async function profiles(_config: SetupConfig): Promise<{
	fast: ModelCapabilityProfile;
	reason: ModelCapabilityProfile;
}> {
	throw new Error(
		"model capability profile source is unavailable through an existing producer-owned contract",
	);
}

async function provider(context: ModuleCommandContext) {
	const facts = await readModuleSharedFacts(context, "model-provider-api");
	const providerBaseUrl = factString(facts, "providerBaseUrl");
	const providerCredential = factString(facts, "providerCredential");
	return providerBaseUrl ? { providerBaseUrl, providerCredential } : undefined;
}
async function configured(context: ModuleCommandContext) {
	try {
		const config = await readSetup(context);
		const p = await provider(context);
		if (!config || !p || p.providerCredential) return undefined;
		return { config, p, profiles: await profiles(config) };
	} catch {
		return undefined;
	}
}
async function running(context: ModuleCommandContext) {
	const own = await ownFacts(context);
	try {
		const token = (await readFile(own.transportCredentialFile, "utf8")).trim();
		return (
			await fetch(`${own.endpoint}/ready`, {
				headers: { authorization: `Bearer ${token}` },
				signal: AbortSignal.timeout(500),
			})
		).ok;
	} catch {
		return false;
	}
}
async function compose(
	context: ModuleCommandContext,
): Promise<ModelRuntimeService> {
	const own = await ownFacts(context);
	const ready = await configured(context);
	if (!ready)
		throw new Error(
			"model runtime setup or provider shared facts are not ready",
		);
	const processModule = await import("../src/process.ts");
	const url = new URL(own.endpoint);
	const { fast, reason } = ready.profiles;
	return processModule.createModelRuntimeProcess({
		config: processModule.parseModelRuntimeProcessConfig({
			host: url.hostname,
			port: Number(url.port),
			stateRoot: own.stateRoot,
			transportCredentialFile: own.transportCredentialFile,
			providerBaseUrl: ready.p.providerBaseUrl,
			models: {
				fast: ready.config.fastModel,
				reason: ready.config.reasonModel,
			},
			profiles: { fast, reason },
			capabilityFacts: {
				fast: {
					contextWindow: fast.contextWindow,
					maxOutputTokens: fast.maxOutputTokens,
					basis: "provider-config",
				},
				reason: {
					contextWindow: reason.contextWindow,
					maxOutputTokens: reason.maxOutputTokens,
					basis: "provider-config",
				},
			},
		}),
	});
}
const failed = (
	code: "SETUP_FAILED" | "START_FAILED" | "STOP_FAILED",
	message: string,
	retryable = true,
) => ({
	...base,
	ok: false as const,
	status: "FAILED" as const,
	error: { code, message, retryable },
});
export const behaviorAdapter = {
	install: async (context: ModuleCommandContext) => ({
		result: { ...base, data: await ownFacts(context) },
		observedEffects: [],
	}),
	uninstall: async (context: ModuleCommandContext) => {
		const service = services.get(key(context));
		if (service) {
			await service.stop();
			services.delete(key(context));
		}
		return {
			result: base,
			observedEffects: service
				? ["Runs the Model Runtime HTTP service process"]
				: [],
		};
	},
	status: async (context: ModuleCommandContext) => ({
		result: {
			...base,
			data: {
				setupStatus: (await configured(context))
					? ("READY" as const)
					: ("FAILED" as const),
				runtimeStatus: (await running(context))
					? ("RUNNING" as const)
					: ("STOPPED" as const),
			},
		},
		observedEffects: [],
	}),
	setup: async (context: ModuleCommandContext) => {
		const input = supplied(context);
		if (input) {
			await mkdir(stateDir(context), { recursive: true, mode: 0o700 });
			await writeFile(
				setupPath(context),
				`${JSON.stringify(input, null, 2)}\n`,
				{ mode: 0o600 },
			);
		}
		const config = input ?? (await readSetup(context));
		if (!config)
			return {
				result: {
					...base,
					ok: false as const,
					status: "ACTION_REQUIRED" as const,
					data: setupPlan,
					actionRequired: {
						action: "select-model-roles",
						description:
							"Choose the FAST and REASON model IDs, then run proflow-model-runtime setup --fast-model <id> --reason-model <id>.",
					},
				},
				observedEffects: [],
			};
		const p = await provider(context);
		if (!p)
			return {
				result: {
					...failed(
						"SETUP_FAILED",
						"model.provider.api producer shared facts are unavailable",
					),
					data: blockedSetupPlan,
				},
				observedEffects: [],
			};
		if (p.providerCredential)
			return {
				result: {
					...failed(
						"SETUP_FAILED",
						"providerCredential is a secretRef but no credential resolver contract is available",
						false,
					),
					data: blockedSetupPlan,
				},
				observedEffects: [],
			};
		try {
			await profiles(config);
			return { result: base, observedEffects: [] };
		} catch (error) {
			return {
				result: {
					...failed(
						"SETUP_FAILED",
						error instanceof Error
							? error.message
							: "model capability profile validation failed",
						false,
					),
					data: blockedSetupPlan,
				},
				observedEffects: [],
			};
		}
	},
	docs: async (_context: ModuleCommandContext) => ({
		result: {
			...base,
			data: {
				docs: readFileSync(new URL("../DOCS.md", import.meta.url), "utf8"),
			},
		},
		observedEffects: [],
	}),
	start: async (context: ModuleCommandContext) => {
		try {
			const service = await compose(context);
			const data = await service.start();
			services.set(key(context), service);
			return {
				result: { ...base, data },
				observedEffects: ["Runs the Model Runtime HTTP service process"],
			};
		} catch (error) {
			return {
				result: failed(
					"START_FAILED",
					error instanceof Error ? error.message : "model-runtime start failed",
				),
				observedEffects: [],
			};
		}
	},
	stop: async (context: ModuleCommandContext) => {
		const service = services.get(key(context));
		if (service) {
			await service.stop();
			services.delete(key(context));
			return {
				result: base,
				observedEffects: ["Runs the Model Runtime HTTP service process"],
			};
		}
		return {
			result: (await running(context))
				? failed(
						"STOP_FAILED",
						"model-runtime is running without an owned lifecycle handle",
					)
				: base,
			observedEffects: [],
		};
	},
} as const;
