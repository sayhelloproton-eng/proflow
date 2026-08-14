import { readFile } from "node:fs/promises";
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
import { systemHealthAssessmentSpec } from "./specs/system-health-assessment.ts";

const configSchema = z
	.object({
		host: z.string().min(1).default("127.0.0.1"),
		port: z.number().int().min(0).max(65_535).default(0),
		stateRoot: z.string().min(1),
		providerBaseUrl: z.url(),
		providerCredentialEnv: z.string().min(1).optional(),
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
	let roles = await verify();
	const runtime = createModelRuntime({
		specs: [systemHealthAssessmentSpec],
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
	const service = createModelRuntimeService({
		runtime,
		host: input.config.host,
		port: input.config.port,
	});
	return Object.freeze({
		...service,
		async start() {
			const address = await service.start();
			input.log?.({
				timestamp: new Date().toISOString(),
				component: "model-runtime-process",
				event: "SERVICE_STARTED",
				...address,
			});
			return address;
		},
		async stop() {
			await service.stop();
			input.log?.({
				timestamp: new Date().toISOString(),
				component: "model-runtime-process",
				event: "SERVICE_STOPPED",
			});
		},
		async restart() {
			await this.stop();
			await runtime.refreshCapabilities();
			return this.start();
		},
	});
}
