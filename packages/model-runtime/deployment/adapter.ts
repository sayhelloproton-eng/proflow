import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
const setupFailurePath = (context: ModuleCommandContext) =>
	join(stateDirectory(context), "setup-failure.json");

type SetupFailureState = {
	contract: "proflow.model-runtime-setup-failure.v1";
	inventoryFingerprint: string;
	message: string;
	recordedAt: string;
};

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

async function readSetupFailure(
	context: ModuleCommandContext,
): Promise<SetupFailureState | undefined> {
	try {
		const raw = JSON.parse(await readFile(setupFailurePath(context), "utf8"));
		return raw?.contract === "proflow.model-runtime-setup-failure.v1" &&
			typeof raw.inventoryFingerprint === "string" &&
			typeof raw.message === "string" &&
			typeof raw.recordedAt === "string"
			? (raw as SetupFailureState)
			: undefined;
	} catch {
		return undefined;
	}
}

async function writeSetupFailure(
	context: ModuleCommandContext,
	state: SetupFailureState,
): Promise<void> {
	await mkdir(stateDirectory(context), { recursive: true, mode: 0o700 });
	const target = setupFailurePath(context);
	const temporary = `${target}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await rename(temporary, target);
}

async function clearSetupFailure(context: ModuleCommandContext): Promise<void> {
	await rm(setupFailurePath(context), { force: true });
}

function decisionFailureMessage(
	decision: Exclude<RoleMappingDecision, { status: "READY" }>,
) {
	const failures = decision.failures ?? [];
	const probeDetail = failures.length
		? `；探测失败：${failures.map((item) => `${item.modelRef}（${item.reason}）`).join("、")}`
		: "";
	const rejections = decision.rejections ?? [];
	const qualificationDetail = rejections.length
		? `；资格不符：${rejections.map((item) => `${item.modelRef}（${item.reasons.join("、") || "没有形成有效能力证据"}）`).join("、")}`
		: "";
	const roleLabel = decision.role === "reason" ? "THINK" : "FAST";
	return `Provider inventory 缺少合格的 ${roleLabel} 模型${probeDetail}${qualificationDetail}`;
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
									nextCommand: "platform setup",
								},
							],
						},
					},
					observedEffects: [],
				};
			if (!mapping) {
				const persistedFailure = await readSetupFailure(context);
				if (
					persistedFailure?.inventoryFingerprint ===
					fingerprint(provider.models)
				)
					return {
						result: {
							...base,
							data: {
								setupStatus: "FAILED" as const,
								runtimeStatus: (await isRunning(context))
									? ("RUNNING" as const)
									: ("STOPPED" as const),
								issues: [
									{
										scope: "SETUP" as const,
										code: "MODEL_ROLE_VALIDATION_FAILED",
										message: persistedFailure.message,
										relatedModuleRefs: ["model-provider-api"],
										nextCommand: "platform setup",
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
							setupStatus: "BLOCKED" as const,
							runtimeStatus: (await isRunning(context))
								? ("RUNNING" as const)
								: ("STOPPED" as const),
							issues: [
								{
									scope: "SETUP" as const,
									code: "MODEL_MAPPING_REQUIRED",
									message: "等待自动验证并映射 FAST / THINK",
									relatedModuleRefs: ["model-provider-api"],
									nextCommand: "platform setup",
								},
							],
						},
					},
					observedEffects: [],
				};
			}
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
							runtimeStatus: "FAILED" as const,
							issues: [
								{
									scope: "RUNTIME" as const,
									code: "PROVIDER_UNAVAILABLE",
									message: "模型 Provider 当前不可用",
									relatedModuleRefs: ["model-provider-api"],
									nextCommand: "platform setup",
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
									nextCommand: "platform setup",
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
			const providerSecret = await credential(provider.providerCredentialFile);
			let live: readonly string[];
			try {
				live = await observeInventory({
					providerBaseUrl: provider.providerBaseUrl,
					...(providerSecret ? { credential: providerSecret } : {}),
				});
			} catch (error) {
				const message = `模型能力验证失败：${error instanceof Error ? error.message : String(error)}`;
				return { result: failed("SETUP_FAILED", message), observedEffects: [] };
			}
			const providerModelsById = new Map(
				provider.models.map((model) => [model.id, model] as const),
			);
			const liveModels: readonly InventoryModel[] = live.map(
				(id) => providerModelsById.get(id) ?? { id },
			);
			const inventoryFingerprint = fingerprint(liveModels);
			if (existing?.inventoryFingerprint === inventoryFingerprint) {
				await ownFacts(context);
				return { result: base, observedEffects: [] };
			}
			const selected = selectedRoles(context);
			const liveModelIds = new Set(live);
			if (
				existing &&
				!selected &&
				liveModelIds.has(existing.mapping.fast) &&
				liveModelIds.has(existing.mapping.reason)
			) {
				// Inventory additions/removals that do not remove either verified role
				// model must not force a full capability re-probe. This keeps an
				// already-valid FAST/THINK mapping stable while still requiring remap
				// when a mapped model actually disappears or the user explicitly
				// selects a different role model.
				await writeMapping(context, { ...existing, inventoryFingerprint });
				await clearSetupFailure(context);
				await ownFacts(context);
				return { result: base, observedEffects: [] };
			}
			const preferred = {
				...(existing?.mapping ?? {}),
				...(selected ?? {}),
			};
			let decision: RoleMappingDecision;
			try {
				decision = await mapInventory({
					...provider,
					models: liveModels,
					...(providerSecret ? { credential: providerSecret } : {}),
					...(Object.keys(preferred).length > 0 ? { previous: preferred } : {}),
				});
			} catch (error) {
				const message = `模型能力验证失败：${error instanceof Error ? error.message : String(error)}`;
				await writeSetupFailure(context, {
					contract: "proflow.model-runtime-setup-failure.v1",
					inventoryFingerprint,
					message,
					recordedAt: now(),
				});
				return { result: failed("SETUP_FAILED", message), observedEffects: [] };
			}
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
				await clearSetupFailure(context);
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
							candidates: [...decision.candidates],
							steps: [
								{
									id: "STEP-MODEL-RUNTIME-01",
									title: `选择 ${decision.role === "reason" ? "THINK" : "FAST"} 模型`,
									description: `能力验证后仍有多个等价候选：${decision.candidates.join(", ")}`,
									state: "TODO" as const,
									responsible: "USER" as const,
									execution: {
										interactive: "platform setup",
										nonInteractive: "platform setup",
									},
									requiredInputs: [
										{
											name: `${decision.role}Model`,
											description: `${decision.role === "reason" ? "THINK" : "FAST"} 候选中的人工选择`,
											sensitive: false,
										},
									],
									verify: "platform status",
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
			const message = decisionFailureMessage(decision);
			await writeSetupFailure(context, {
				contract: "proflow.model-runtime-setup-failure.v1",
				inventoryFingerprint,
				message,
				recordedAt: now(),
			});
			return {
				result: failed("SETUP_FAILED", message, false),
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
