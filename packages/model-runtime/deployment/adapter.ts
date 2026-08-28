import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { modelCapabilityProfileSchema } from "@tomflow/proflow-model-contracts";
import {
	deterministicLoopbackPort,
	ensureModuleSecretFile,
	type ModuleCommandContext,
	moduleWorkspaceStateDirectory,
	readModuleSharedFacts,
	writeModuleSharedFacts,
} from "@tomflow/proflow-module-contract";
import { z } from "zod";
import type { ModelRuntimeService } from "../src/service.ts";
import { descriptor } from "./descriptor.ts";
import {
	createOpenAIModelDeploymentProbe,
	type ModelRoleMapping,
	type RoleMappingDecision,
	verifyAndMapInventory,
} from "./role-mapper.ts";

type InventoryModel = {
	id: string;
	object?: string;
	ownedBy?: string;
};
type ProviderFacts = {
	providerBaseUrl: string;
	models: readonly InventoryModel[];
	providerCredentialFile?: string;
};
type MapInventoryInput = ProviderFacts & {
	credential?: string;
	previous?: Partial<ModelRoleMapping>;
};
type ObserveInventoryInput = {
	providerBaseUrl: string;
	credential?: string;
};
type ModelRuntimeAdapterDependencies = {
	mapInventory?: (input: MapInventoryInput) => Promise<RoleMappingDecision>;
	observeInventory?: (
		input: ObserveInventoryInput,
	) => Promise<readonly string[]>;
	now?: () => string;
};

const evidenceSchema = z.strictObject({
	modelRef: z.string().min(1),
	text: z.boolean(),
	vision: z.boolean(),
	structuredOutput: z.enum(["native", "prompted", "unsupported"]),
	reasoning: z.enum(["thinking", "no-thinking"]),
	contextWindow: z.number().int().positive(),
	maxOutputTokens: z.number().int().positive(),
	verifiedAt: z.iso.datetime(),
	metadataSignals: z.array(z.string()).optional(),
});
const mappingStateSchema = z.strictObject({
	contract: z.literal("proflow.model-role-mapping.v1"),
	inventoryFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
	mapping: z.strictObject({
		fast: z.string().min(1),
		reason: z.string().min(1),
	}),
	profiles: z.strictObject({
		fast: modelCapabilityProfileSchema,
		reason: modelCapabilityProfileSchema,
	}),
	evidence: z.array(evidenceSchema),
	verifiedAt: z.iso.datetime(),
});
type MappingState = z.infer<typeof mappingStateSchema>;

const services = new Map<string, ModelRuntimeService>();
const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;
const processEffect = "Runs the Model Runtime HTTP service process";

const key = (context: ModuleCommandContext) => resolve(context.workspaceRoot);
const stateDirectory = (context: ModuleCommandContext) =>
	moduleWorkspaceStateDirectory(context, descriptor.moduleRef);
const mappingPath = (context: ModuleCommandContext) =>
	join(stateDirectory(context), "role-mapping.json");

function string(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function selectedRoles(
	context: ModuleCommandContext,
): Partial<ModelRoleMapping> | undefined {
	if (
		typeof context.input !== "object" ||
		context.input === null ||
		Array.isArray(context.input)
	)
		return undefined;
	const fast = string(Reflect.get(context.input, "fastModel"));
	const reason = string(Reflect.get(context.input, "reasonModel"));
	return fast || reason
		? { ...(fast ? { fast } : {}), ...(reason ? { reason } : {}) }
		: undefined;
}

function inventory(value: unknown): readonly InventoryModel[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const parsed: InventoryModel[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null || Array.isArray(item))
			return undefined;
		const id = string(Reflect.get(item, "id"));
		if (!id) return undefined;
		const object = string(Reflect.get(item, "object"));
		const ownedBy = string(Reflect.get(item, "ownedBy"));
		parsed.push({
			id,
			...(object ? { object } : {}),
			...(ownedBy ? { ownedBy } : {}),
		});
	}
	return parsed;
}

async function providerFacts(
	context: ModuleCommandContext,
): Promise<ProviderFacts | undefined> {
	const facts = await readModuleSharedFacts(context, "model-provider-api");
	const providerBaseUrl = string(facts?.providerBaseUrl);
	const models = inventory(facts?.models);
	const providerCredentialFile = string(facts?.providerCredentialFile);
	return providerBaseUrl && models
		? {
				providerBaseUrl,
				models,
				...(providerCredentialFile ? { providerCredentialFile } : {}),
			}
		: undefined;
}

async function credential(
	path: string | undefined,
): Promise<string | undefined> {
	if (!path) return undefined;
	try {
		return string((await readFile(path, "utf8")).trim());
	} catch {
		return undefined;
	}
}

function fingerprint(models: readonly { id: string }[]): string {
	return createHash("sha256")
		.update(
			[...models]
				.map((model) => model.id)
				.sort()
				.join("\0"),
		)
		.digest("hex");
}

async function readMapping(
	context: ModuleCommandContext,
): Promise<MappingState | undefined> {
	try {
		return mappingStateSchema.parse(
			JSON.parse(await readFile(mappingPath(context), "utf8")),
		);
	} catch {
		return undefined;
	}
}

async function writeMapping(
	context: ModuleCommandContext,
	state: MappingState,
): Promise<void> {
	await mkdir(stateDirectory(context), { recursive: true, mode: 0o700 });
	const target = mappingPath(context);
	const temporary = `${target}.${process.pid}.tmp`;
	await writeFile(
		temporary,
		`${JSON.stringify(mappingStateSchema.parse(state), null, 2)}\n`,
		{ encoding: "utf8", mode: 0o600 },
	);
	await rename(temporary, target);
}

async function ownFacts(context: ModuleCommandContext) {
	await mkdir(stateDirectory(context), { recursive: true, mode: 0o700 });
	const mapping = await readMapping(context);
	const facts = {
		endpoint: `http://127.0.0.1:${deterministicLoopbackPort(context, descriptor.moduleRef)}`,
		transportCredentialFile: await ensureModuleSecretFile(
			context,
			descriptor.moduleRef,
			"transport",
		),
		stateRoot: stateDirectory(context),
		...(mapping
			? {
					roleMapping: mapping.mapping,
					mappingVerifiedAt: mapping.verifiedAt,
				}
			: {}),
	};
	await writeModuleSharedFacts(context, descriptor.moduleRef, facts);
	return facts;
}
async function readOwnFacts(context: ModuleCommandContext) {
	const facts = await readModuleSharedFacts(context, descriptor.moduleRef);
	const endpoint =
		typeof facts?.endpoint === "string" ? facts.endpoint : undefined;
	return endpoint ? { endpoint } : undefined;
}

async function defaultObserveInventory(
	input: ObserveInventoryInput,
): Promise<readonly string[]> {
	const response = await fetch(
		`${input.providerBaseUrl.replace(/\/+$/, "")}/models`,
		{
			headers: input.credential
				? { authorization: `Bearer ${input.credential}` }
				: {},
			signal: AbortSignal.timeout(5_000),
		},
	);
	if (!response.ok) throw new Error("provider inventory unavailable");
	const payload: unknown = await response.json();
	if (typeof payload !== "object" || payload === null || Array.isArray(payload))
		throw new Error("provider inventory invalid");
	const models = inventory(Reflect.get(payload, "data"));
	if (!models) throw new Error("provider inventory invalid");
	return models.map((model) => model.id);
}

async function isRunning(context: ModuleCommandContext): Promise<boolean> {
	const owned = services.get(key(context));
	if (owned?.status() === "RUNNING") return true;
	const facts = await readOwnFacts(context);
	if (!facts) return false;
	try {
		return (
			await fetch(`${facts.endpoint}/health`, {
				signal: AbortSignal.timeout(500),
			})
		).ok;
	} catch {
		return false;
	}
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

export function createModelRuntimeBehaviorAdapter(
	dependencies: ModelRuntimeAdapterDependencies = {},
) {
	const now = dependencies.now ?? (() => new Date().toISOString());
	const observeInventory =
		dependencies.observeInventory ?? defaultObserveInventory;
	const mapInventory =
		dependencies.mapInventory ??
		(async (input: MapInventoryInput) =>
			verifyAndMapInventory({
				models: input.models,
				probe: createOpenAIModelDeploymentProbe({
					baseUrl: input.providerBaseUrl,
					...(input.credential ? { credential: input.credential } : {}),
				}),
				...(input.previous ? { previous: input.previous } : {}),
			}));

	const compose = async (
		context: ModuleCommandContext,
	): Promise<ModelRuntimeService> => {
		const owned = await ownFacts(context);
		const provider = await providerFacts(context);
		const mapping = await readMapping(context);
		if (!provider || !mapping)
			throw new Error("model runtime setup or provider facts are not ready");
		const providerSecret = await credential(provider.providerCredentialFile);
		const processModule = await import("../src/process.ts");
		const url = new URL(owned.endpoint);
		return processModule.createModelRuntimeProcess({
			config: processModule.parseModelRuntimeProcessConfig({
				host: url.hostname,
				port: Number(url.port),
				stateRoot: owned.stateRoot,
				transportCredentialFile: owned.transportCredentialFile,
				providerBaseUrl: provider.providerBaseUrl,
				...(providerSecret
					? { providerCredentialEnv: "PROFLOW_MODEL_PROVIDER_CREDENTIAL" }
					: {}),
				models: mapping.mapping,
				profiles: mapping.profiles,
				capabilityFacts: {
					fast: {
						contextWindow: mapping.profiles.fast.contextWindow,
						maxOutputTokens: mapping.profiles.fast.maxOutputTokens,
						basis: "bounded-probe",
					},
					reason: {
						contextWindow: mapping.profiles.reason.contextWindow,
						maxOutputTokens: mapping.profiles.reason.maxOutputTokens,
						basis: "bounded-probe",
					},
				},
			}),
			...(providerSecret
				? { env: { PROFLOW_MODEL_PROVIDER_CREDENTIAL: providerSecret } }
				: {}),
		});
	};

	return {
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
				observedEffects: service ? [processEffect] : [],
			};
		},
		status: async (context: ModuleCommandContext) => {
			const provider = await providerFacts(context);
			const mapping = await readMapping(context);
			if (!provider)
				return {
					result: {
						...base,
						data: {
							setupStatus: "BLOCKED" as const,
							runtimeStatus: (await isRunning(context))
								? ("RUNNING" as const)
								: ("STOPPED" as const),
							issues: [
								{
									scope: "SETUP" as const,
									code: "UPSTREAM_NOT_READY",
									message: "等待 model-provider-api 发布验证过的模型 inventory",
									relatedModuleRefs: ["model-provider-api"],
									nextCommand: "platform setup --module model-provider-api",
								},
							],
						},
					},
					observedEffects: [],
				};
			if (!mapping)
				return {
					result: {
						...base,
						data: {
							setupStatus: "BLOCKED" as const,
							runtimeStatus: (await isRunning(context))
								? ("RUNNING" as const)
								: ("STOPPED" as const),
							issues: [
								{
									scope: "SETUP" as const,
									code: "MODEL_MAPPING_REQUIRED",
									message: "等待自动验证并映射 FAST / REASON",
									relatedModuleRefs: ["model-provider-api"],
									nextCommand: "platform setup --module model-runtime",
								},
							],
						},
					},
					observedEffects: [],
				};
			const providerSecret = await credential(provider.providerCredentialFile);
			let live: readonly string[];
			try {
				live = await observeInventory({
					providerBaseUrl: provider.providerBaseUrl,
					...(providerSecret ? { credential: providerSecret } : {}),
				});
			} catch {
				return {
					result: {
						...base,
						data: {
							setupStatus: "READY" as const,
							runtimeStatus: (await isRunning(context))
								? ("RUNNING" as const)
								: ("STOPPED" as const),
							issues: [
								{
									scope: "RUNTIME" as const,
									code: "PROVIDER_UNAVAILABLE",
									message: "模型 Provider 当前不可用",
									relatedModuleRefs: ["model-provider-api"],
									nextCommand: "platform setup --module model-provider-api",
								},
							],
						},
					},
					observedEffects: [],
				};
			}
			if (
				fingerprint(live.map((id) => ({ id }))) !== mapping.inventoryFingerprint
			)
				return {
					result: {
						...base,
						data: {
							setupStatus: "BLOCKED" as const,
							runtimeStatus: (await isRunning(context))
								? ("RUNNING" as const)
								: ("STOPPED" as const),
							issues: [
								{
									scope: "SETUP" as const,
									code: "MODEL_MAPPING_STALE",
									message: "Provider model inventory 已变化，需要自动重新映射",
									relatedModuleRefs: ["model-provider-api"],
									nextCommand: "platform setup --module model-runtime",
								},
							],
						},
					},
					observedEffects: [],
				};
			return {
				result: {
					...base,
					data: {
						setupStatus: "READY" as const,
						runtimeStatus: (await isRunning(context))
							? ("RUNNING" as const)
							: ("STOPPED" as const),
					},
				},
				observedEffects: [],
			};
		},
		setup: async (context: ModuleCommandContext) => {
			const provider = await providerFacts(context);
			if (!provider)
				return {
					result: {
						...base,
						data: { waitingFor: ["model-provider-api"] },
					},
					observedEffects: [],
				};
			const existing = await readMapping(context);
			const inventoryFingerprint = fingerprint(provider.models);
			if (existing?.inventoryFingerprint === inventoryFingerprint) {
				await ownFacts(context);
				return { result: base, observedEffects: [] };
			}
			const providerSecret = await credential(provider.providerCredentialFile);
			const selected = selectedRoles(context);
			if (!selected?.fast || !selected.reason)
				return {
					result: {
						...base,
						ok: false as const,
						status: "ACTION_REQUIRED" as const,
						data: {
							steps: [
								{
									id: "STEP-MODEL-RUNTIME-01",
									title: "选择 FAST 与 THINK 模型",
									description:
										"从模型服务真实库存中分别选择快速模型与推理模型，随后由 Model Runtime 验证能力。",
									state: "TODO" as const,
									responsible: "USER" as const,
									execution: {
										interactive: "platform setup",
										nonInteractive: "platform setup",
									},
									requiredInputs: [
										{
											name: "fastModel",
											description: "FAST 模型",
											sensitive: false,
										},
										{
											name: "reasonModel",
											description: "THINK 模型",
											sensitive: false,
										},
									],
									verify: "platform status",
									successCondition: "FAST / THINK 能力验证通过",
									humanAction: "选择 FAST 与 THINK 模型",
								},
							],
						},
						actionRequired: {
							action: "select-model-roles",
							description: "请选择 FAST 与 THINK 模型。",
						},
					},
					observedEffects: [],
				};
			const preferred = {
				...(existing?.mapping ?? {}),
				...(selected ?? {}),
			};
			const decision = await mapInventory({
				...provider,
				...(providerSecret ? { credential: providerSecret } : {}),
				...(Object.keys(preferred).length > 0 ? { previous: preferred } : {}),
			});
			if (decision.status === "READY") {
				await writeMapping(context, {
					contract: "proflow.model-role-mapping.v1",
					inventoryFingerprint,
					mapping: decision.mapping,
					profiles: decision.profiles,
					evidence: decision.evidence.map(({ metadataSignals, ...item }) => ({
						...item,
						...(metadataSignals
							? { metadataSignals: [...metadataSignals] }
							: {}),
					})),
					verifiedAt: now(),
				});
				await ownFacts(context);
				return { result: base, observedEffects: [] };
			}
			if (decision.status === "AMBIGUOUS")
				return {
					result: {
						...base,
						ok: false as const,
						status: "ACTION_REQUIRED" as const,
						data: {
							steps: [
								{
									id: "STEP-MODEL-RUNTIME-01",
									title: `选择 ${decision.role.toUpperCase()} 模型`,
									description: `能力验证后仍有多个等价候选：${decision.candidates.join(", ")}`,
									state: "TODO" as const,
									responsible: "USER" as const,
									execution: {
										interactive: "pnpm exec -- proflow-model-runtime setup",
										nonInteractive: "pnpm exec -- proflow-model-runtime setup",
									},
									requiredInputs: [
										{
											name: `${decision.role}Model`,
											description: `${decision.role.toUpperCase()} 候选中的人工选择`,
											sensitive: false,
										},
									],
									verify: "pnpm exec -- proflow-model-runtime verify",
									successCondition: "model-runtime.setupStatus=READY",
									humanAction: "仅在等价候选中选择一个模型角色",
								},
							],
						},
						actionRequired: {
							action: `select-${decision.role}-model`,
							description: `${decision.candidates.join(", ")} 无法由当前证据唯一排序`,
						},
					},
					observedEffects: [],
				};
			return {
				result: failed(
					"SETUP_FAILED",
					`Provider inventory 缺少合格的 ${decision.role.toUpperCase()} 模型`,
					false,
				),
				observedEffects: [],
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
		start: async (context: ModuleCommandContext) => {
			try {
				const service = await compose(context);
				const data = await service.start();
				services.set(key(context), service);
				return {
					result: { ...base, data },
					observedEffects: [processEffect],
				};
			} catch (error) {
				return {
					result: failed(
						"START_FAILED",
						error instanceof Error
							? error.message
							: "model-runtime start failed",
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
				return { result: base, observedEffects: [processEffect] };
			}
			return {
				result: (await isRunning(context))
					? failed(
							"STOP_FAILED",
							"model-runtime is running without an owned lifecycle handle",
						)
					: base,
				observedEffects: [],
			};
		},
	} as const;
}

export const behaviorAdapter = createModelRuntimeBehaviorAdapter();
