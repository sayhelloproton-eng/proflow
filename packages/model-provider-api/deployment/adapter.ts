import { readFileSync } from "node:fs";
import {
	chmod,
	mkdir,
	readFile,
	rename,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import {
	type ModuleCommandContext,
	moduleWorkspaceStateDirectory,
	writeModuleSharedFacts,
} from "@tomflow/proflow-module-contract";
import {
	type ProviderModel,
	type ProviderProbeConfig,
	type ProviderProbeResult,
	probeProvider,
} from "../src/resource-adapter.ts";
import { descriptor } from "./descriptor.ts";

type ProviderObservation = {
	contract: "proflow.model-provider-observation.v1";
	providerBaseUrl: string;
	models: readonly ProviderModel[];
	verifiedAt: string;
	providerCredentialFile?: string;
};

type ProviderAdapterDependencies = {
	probe?: (config: ProviderProbeConfig) => Promise<ProviderProbeResult>;
	now?: () => string;
};

type Resolution =
	| { status: "READY"; observation: ProviderObservation }
	| {
			status:
				| "PROVIDER_ENDPOINT_REQUIRED"
				| "PROVIDER_ENDPOINT_INVALID"
				| "PROVIDER_UNREACHABLE"
				| "PROVIDER_PROTOCOL_INVALID"
				| "PROVIDER_AUTH_REQUIRED"
				| "PROVIDER_AUTH_FAILED";
			message: string;
	  };

const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;
const effect = "Probes the configured OpenAI-compatible model provider API";

const stateDirectory = (context: ModuleCommandContext) =>
	moduleWorkspaceStateDirectory(context, descriptor.moduleRef);
const observationPath = (context: ModuleCommandContext) =>
	join(stateDirectory(context), "provider-observation.json");
const credentialPath = (context: ModuleCommandContext) =>
	join(stateDirectory(context), "secrets", "provider.token");

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

function endpoint(value: unknown): string | undefined {
	const candidate = text(value);
	if (!candidate) return undefined;
	try {
		const url = new URL(candidate);
		return url.protocol === "http:" || url.protocol === "https:"
			? candidate
			: undefined;
	} catch {
		return undefined;
	}
}

function models(value: unknown): readonly ProviderModel[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const parsed: ProviderModel[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null || Array.isArray(item))
			return undefined;
		const id = text(Reflect.get(item, "id"));
		if (!id) return undefined;
		const object = text(Reflect.get(item, "object"));
		const ownedBy = text(Reflect.get(item, "ownedBy"));
		const created = Reflect.get(item, "created");
		if (created !== undefined && !Number.isSafeInteger(created))
			return undefined;
		parsed.push({
			id,
			...(object ? { object } : {}),
			...(typeof created === "number" ? { created } : {}),
			...(ownedBy ? { ownedBy } : {}),
		});
	}
	return parsed;
}

function parseObservation(value: unknown): ProviderObservation | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return undefined;
	if (
		Reflect.get(value, "contract") !== "proflow.model-provider-observation.v1"
	)
		return undefined;
	const providerBaseUrl = endpoint(Reflect.get(value, "providerBaseUrl"));
	const inventory = models(Reflect.get(value, "models"));
	const verifiedAt = text(Reflect.get(value, "verifiedAt"));
	const providerCredentialFile = text(
		Reflect.get(value, "providerCredentialFile"),
	);
	if (!providerBaseUrl || !inventory || !verifiedAt) return undefined;
	if (!Number.isFinite(Date.parse(verifiedAt))) return undefined;
	return {
		contract: "proflow.model-provider-observation.v1",
		providerBaseUrl,
		models: inventory,
		verifiedAt,
		...(providerCredentialFile ? { providerCredentialFile } : {}),
	};
}

async function readObservation(
	context: ModuleCommandContext,
): Promise<ProviderObservation | undefined> {
	try {
		return parseObservation(
			JSON.parse(await readFile(observationPath(context), "utf8")),
		);
	} catch {
		return undefined;
	}
}

async function publish(
	context: ModuleCommandContext,
	observation: ProviderObservation,
): Promise<void> {
	await mkdir(stateDirectory(context), { recursive: true, mode: 0o700 });
	const target = observationPath(context);
	const temporary = `${target}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(observation, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await rename(temporary, target);
	await writeModuleSharedFacts(context, descriptor.moduleRef, {
		providerBaseUrl: observation.providerBaseUrl,
		protocol: "openai-compatible",
		models: observation.models,
		inventoryObservedAt: observation.verifiedAt,
		...(observation.providerCredentialFile
			? { providerCredentialFile: observation.providerCredentialFile }
			: {}),
	});
}

async function readCredential(
	path: string | undefined,
): Promise<string | undefined> {
	if (!path) return undefined;
	try {
		const info = await stat(path);
		if (process.platform !== "win32" && (info.mode & 0o077) !== 0)
			return undefined;
		return text(await readFile(path, "utf8"));
	} catch {
		return undefined;
	}
}

async function saveCredential(
	context: ModuleCommandContext,
	credential: string,
): Promise<string> {
	const path = credentialPath(context);
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await writeFile(path, `${credential}\n`, { encoding: "utf8", mode: 0o600 });
	if (process.platform !== "win32") await chmod(path, 0o600);
	return path;
}

function inputRecord(
	context: ModuleCommandContext,
): Record<string, unknown> | undefined {
	return typeof context.input === "object" &&
		context.input !== null &&
		!Array.isArray(context.input)
		? (context.input as Record<string, unknown>)
		: undefined;
}

function suppliedEndpoint(context: ModuleCommandContext): {
	value?: string;
	invalid: boolean;
} {
	const raw = inputRecord(context)?.providerBaseUrl;
	if (raw === undefined) return { invalid: false };
	const value = endpoint(raw);
	return value ? { value, invalid: false } : { invalid: true };
}

function suppliedCredential(context: ModuleCommandContext): string | undefined {
	return text(inputRecord(context)?.providerCredential);
}

function setupPlan(resolution: Exclude<Resolution, { status: "READY" }>) {
	const auth = resolution.status === "PROVIDER_AUTH_REQUIRED";
	const endpointRequired =
		resolution.status === "PROVIDER_ENDPOINT_REQUIRED" ||
		resolution.status === "PROVIDER_ENDPOINT_INVALID";
	return {
		steps: [
			{
				id: "STEP-MODEL-PROVIDER-API-01",
				title: auth
					? "提供模型服务凭据"
					: endpointRequired
						? "提供模型服务 URL"
						: "恢复模型服务连接",
				description: resolution.message,
				state: "TODO" as const,
				responsible: "USER" as const,
				execution: {
					interactive: "pnpm exec -- proflow-model-provider-api setup",
					nonInteractive: endpointRequired
						? "pnpm exec -- proflow-model-provider-api setup --provider-base-url <url>"
						: "pnpm exec -- proflow-model-provider-api setup",
				},
				requiredInputs: auth
					? [
							{
								name: "providerCredential",
								description: "模型服务访问凭据",
								sensitive: true,
							},
						]
					: endpointRequired
						? [
								{
									name: "providerBaseUrl",
									description: "部署层解析出的 OpenAI-compatible 模型服务 URL",
									sensitive: false,
								},
							]
						: [],
				verify: "pnpm exec -- proflow-model-provider-api verify",
				successCondition: "model-provider-api.setupStatus=READY",
				humanAction: auth
					? "安全输入模型服务访问凭据"
					: endpointRequired
						? "提供部署层解析出的模型服务 URL"
						: undefined,
			},
		],
	};
}

function issue(resolution: Exclude<Resolution, { status: "READY" }>) {
	return {
		scope: "SETUP" as const,
		code: resolution.status,
		message: resolution.message,
		relatedModuleRefs: [],
		nextCommand: "platform setup --module model-provider-api",
	};
}

export function createProviderBehaviorAdapter(
	dependencies: ProviderAdapterDependencies = {},
) {
	const probe = dependencies.probe ?? probeProvider;
	const now = dependencies.now ?? (() => new Date().toISOString());

	const resolveCurrent = async (
		context: ModuleCommandContext,
	): Promise<Resolution> => {
		const saved = await readObservation(context);
		const supplied = suppliedEndpoint(context);
		if (supplied.invalid)
			return {
				status: "PROVIDER_ENDPOINT_INVALID",
				message: "模型服务 URL 必须是有效的 HTTP(S) URL。",
			};
		const providerBaseUrl = supplied.value ?? saved?.providerBaseUrl;
		if (!providerBaseUrl)
			return {
				status: "PROVIDER_ENDPOINT_REQUIRED",
				message:
					"模型服务尚未绑定。model-provider-api 只消费部署层提供的 OpenAI-compatible URL，不识别具体设备、应用或 Provider 产品。",
			};
		const oneTimeCredential = suppliedCredential(context);
		const storedCredential = await readCredential(
			saved?.providerCredentialFile,
		);
		const credential = oneTimeCredential ?? storedCredential;
		const result = await probe({
			baseUrl: providerBaseUrl,
			...(credential ? { credential } : {}),
		});
		if (result.status === "READY") {
			const providerCredentialFile = oneTimeCredential
				? await saveCredential(context, oneTimeCredential)
				: saved?.providerCredentialFile;
			const observation: ProviderObservation = {
				contract: "proflow.model-provider-observation.v1",
				providerBaseUrl: result.baseUrl,
				models: result.models,
				verifiedAt: now(),
				...(providerCredentialFile ? { providerCredentialFile } : {}),
			};
			await publish(context, observation);
			return { status: "READY", observation };
		}
		if (result.status === "AUTH_REQUIRED")
			return {
				status: "PROVIDER_AUTH_REQUIRED",
				message: "模型服务要求认证。",
			};
		if (result.status === "AUTH_FAILED")
			return {
				status: "PROVIDER_AUTH_FAILED",
				message: "模型服务拒绝了当前凭据。",
			};
		if (result.status === "PROTOCOL_INVALID")
			return {
				status: "PROVIDER_PROTOCOL_INVALID",
				message: "模型服务没有通过 OpenAI-compatible models API 验证。",
			};
		return {
			status: "PROVIDER_UNREACHABLE",
			message: "当前无法连接已绑定的模型服务 URL。",
		};
	};

	return {
		install: async (context: ModuleCommandContext) => {
			await mkdir(stateDirectory(context), { recursive: true, mode: 0o700 });
			const saved = await readObservation(context);
			if (saved) await publish(context, saved);
			return { result: base, observedEffects: [] };
		},
		uninstall: async (_context: ModuleCommandContext) => ({
			result: base,
			observedEffects: [],
		}),
		status: async (context: ModuleCommandContext) => {
			const resolution = await resolveCurrent(context);
			if (resolution.status === "READY")
				return {
					result: {
						...base,
						data: {
							setupStatus: "READY" as const,
							runtimeStatus: "NOT_APPLICABLE" as const,
						},
					},
					observedEffects: [effect],
					externalAvailabilityClaim: "AVAILABLE" as const,
					externalAvailabilityEvidence: "real" as const,
				};
			const failed = new Set([
				"PROVIDER_ENDPOINT_INVALID",
				"PROVIDER_PROTOCOL_INVALID",
				"PROVIDER_AUTH_FAILED",
			]).has(resolution.status);
			return {
				result: {
					...base,
					data: {
						setupStatus: failed
							? ("FAILED" as const)
							: ("ACTION_REQUIRED" as const),
						runtimeStatus: "NOT_APPLICABLE" as const,
						issues: [issue(resolution)],
					},
				},
				observedEffects: [effect],
			};
		},
		setup: async (context: ModuleCommandContext) => {
			const resolution = await resolveCurrent(context);
			if (resolution.status === "READY")
				return { result: base, observedEffects: [effect] };
			if (
				resolution.status === "PROVIDER_ENDPOINT_INVALID" ||
				resolution.status === "PROVIDER_PROTOCOL_INVALID" ||
				resolution.status === "PROVIDER_AUTH_FAILED"
			)
				return {
					result: {
						...base,
						ok: false as const,
						status: "FAILED" as const,
						error: {
							code: "SETUP_FAILED" as const,
							message: resolution.message,
							retryable: true,
						},
					},
					observedEffects: [effect],
				};
			const action =
				resolution.status === "PROVIDER_ENDPOINT_REQUIRED"
					? "provide-provider-endpoint"
					: resolution.status === "PROVIDER_AUTH_REQUIRED"
						? "provide-provider-credential"
						: "retry-provider-connection";
			return {
				result: {
					...base,
					ok: false as const,
					status: "ACTION_REQUIRED" as const,
					data: setupPlan(resolution),
					actionRequired: {
						action,
						description: resolution.message,
					},
				},
				observedEffects: [effect],
			};
		},
		docs: async (_context: ModuleCommandContext) => ({
			result: {
				...base,
				data: {
					docs: readFileSync(
						new URL(
							import.meta.url.includes("/dist/")
								? "../../DOCS.md"
								: "../DOCS.md",
							import.meta.url,
						),
						"utf8",
					),
				},
			},
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
}

export const behaviorAdapter = createProviderBehaviorAdapter();
