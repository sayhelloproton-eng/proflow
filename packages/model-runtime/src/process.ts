import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
	type InferenceRequest,
	modelCapabilityProfileSchema,
} from "@tomflow/proflow-model-contracts";
import { z } from "zod";
import { createModelRuntime } from "./index.ts";
import { createFileModelRuntimeLogger } from "./logging.ts";
import {
	createOpenAICompatibleProvider,
	type ProviderCapabilityFact,
	verifyProviderCapabilities,
} from "./provider.ts";
import { createModelRuntimeService } from "./service.ts";
import { browserPageVisionSpec } from "./specs/browser-page-vision.ts";
import { executionCommandRiskSpec } from "./specs/execution-command-risk.ts";
import { systemHealthAssessmentSpec } from "./specs/system-health-assessment.ts";
import { taskDiagnosticSpec } from "./specs/task-diagnostic.ts";

const configSchema = z
	.object({
		host: z.string().min(1).default("127.0.0.1"),
		port: z.number().int().min(0).max(65_535).default(0),
		stateRoot: z.string().min(1),
		providerBaseUrl: z.url(),
		providerCredentialEnv: z.string().min(1).optional(),
		transportCredentialFile: z.string().min(1).optional(),
		models: z
			.object({ fast: z.string().min(1), reason: z.string().min(1) })
			.strict(),
		profiles: z
			.object({
				fast: modelCapabilityProfileSchema,
				reason: modelCapabilityProfileSchema,
			})
			.strict(),
		capabilityFacts: z
			.object({
				fast: z.object({
					contextWindow: z.number().int().positive(),
					maxOutputTokens: z.number().int().positive(),
					basis: z.enum([
						"provider-config",
						"provider-protocol",
						"bounded-probe",
					]),
				}),
				reason: z.object({
					contextWindow: z.number().int().positive(),
					maxOutputTokens: z.number().int().positive(),
					basis: z.enum([
						"provider-config",
						"provider-protocol",
						"bounded-probe",
					]),
				}),
			})
			.strict(),
	})
	.strict();

export type ModelRuntimeProcessConfig = z.infer<typeof configSchema>;
export const parseModelRuntimeProcessConfig = (value: unknown) =>
	configSchema.parse(value);
export async function loadModelRuntimeProcessConfig(path: string) {
	return parseModelRuntimeProcessConfig(
		JSON.parse(await readFile(resolve(path), "utf8")),
	);
}

export async function createModelRuntimeProcess(input: {
	config: ModelRuntimeProcessConfig;
	env?: Readonly<Record<string, string | undefined>>;
	log?: (entry: Record<string, unknown>) => void;
}) {
	const credential = input.config.providerCredentialEnv
		? (input.env ?? process.env)[input.config.providerCredentialEnv]
		: undefined;
	const transportCredentialFile = input.config.transportCredentialFile;
	const transportCredential = transportCredentialFile
		? await (async () => {
				const path = resolve(transportCredentialFile);
				const info = await stat(path);
				if (process.platform !== "win32" && (info.mode & 0o077) !== 0)
					throw new TypeError(
						"model-runtime transport credential permissions must be owner-only",
					);
				return (await readFile(path, "utf8")).trim();
			})()
		: undefined;
	if (transportCredential !== undefined && transportCredential.length < 32)
		throw new TypeError(
			"model-runtime transport credential must contain at least 32 characters",
		);
	if (input.config.providerCredentialEnv && !credential)
		throw new TypeError(
			"configured provider credential environment value is missing",
		);
	const provider = createOpenAICompatibleProvider({
		baseUrl: input.config.providerBaseUrl,
		models: input.config.models,
		...(credential ? { apiKey: credential } : {}),
	});
	const request = (role: "fast" | "reason"): InferenceRequest => ({
		contractVersion: "1.0.0",
		specRef: systemHealthAssessmentSpec.specRef,
		mode: role,
		priority: "background",
		trace: { callerRef: "model-runtime:capability-verifier" },
		payload: {
			service: "model-runtime",
			checks: [{ name: "probe", state: "PASS" }],
		},
	});
	const verify = () =>
		verifyProviderCapabilities({
			declared: {
				fast: { profile: input.config.profiles.fast },
				reason: { profile: input.config.profiles.reason },
			},
			provider,
			probes: {
				fast: {
					request: request("fast"),
					spec: systemHealthAssessmentSpec,
					prompt: "capability probe",
				},
				reason: {
					request: request("reason"),
					spec: systemHealthAssessmentSpec,
					prompt: "capability probe",
				},
			},
			capabilityFacts: input.config.capabilityFacts as Record<
				"fast" | "reason",
				ProviderCapabilityFact
			>,
		});
	let runtime: ReturnType<typeof createModelRuntime> | undefined;
	let service: ReturnType<typeof createModelRuntimeService> | undefined;
	const build = async () => {
		let roles = await verify();
		runtime = createModelRuntime({
			specs: [
				systemHealthAssessmentSpec,
				taskDiagnosticSpec,
				executionCommandRiskSpec,
				browserPageVisionSpec,
			],
			roles,
			provider,
			refreshRoles: async () => {
				roles = await verify();
				return roles;
			},
			logger: createFileModelRuntimeLogger({
				proflowRoot: input.config.stateRoot,
			}),
		});
		service = createModelRuntimeService({
			runtime,
			host: input.config.host,
			port: input.config.port,
			...(transportCredential ? { transportCredential } : {}),
		});
		return service;
	};
	const unavailableDependency = () => ({
		runtime: "UNAVAILABLE" as const,
		lane: "IDLE" as const,
		fast: "UNAVAILABLE" as const,
		reason: "UNAVAILABLE" as const,
		businessQueueDepth: 0,
		backgroundQueueDepth: 0,
	});
	return Object.freeze({
		status: () => service?.status() ?? "STOPPED",
		inspect: () =>
			service?.inspect() ?? {
				process: "STOPPED" as const,
				liveness: "DOWN" as const,
				readiness: "NOT_READY" as const,
				accepting: false,
				inFlight: 0,
				dependency: unavailableDependency(),
			},
		async verifyCapabilities() {
			if (runtime === undefined) {
				const roles = await verify();
				return roles.fast.state === "READY" && roles.reason.state === "READY";
			}
			await runtime.refreshCapabilities();
			const status = runtime.getRuntimeStatus();
			return status.fast === "READY" && status.reason === "READY";
		},
		async start() {
			let current = service;
			if (current === undefined) current = await build();
			else if (current.status() !== "RUNNING")
				await runtime?.refreshCapabilities();
			const address = await current.start();
			input.log?.({
				timestamp: new Date().toISOString(),
				component: "model-runtime-process",
				event: "SERVICE_STARTED",
				...address,
			});
			return address;
		},
		async stop() {
			if (service === undefined) return;
			await service.stop();
			input.log?.({
				timestamp: new Date().toISOString(),
				component: "model-runtime-process",
				event: "SERVICE_STOPPED",
			});
		},
		async restart() {
			await this.stop();
			return this.start();
		},
	});
}
