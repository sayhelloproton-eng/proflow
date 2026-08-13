import type {
	InferenceRequest,
	ModelCapabilityProfile,
	ReasoningSpec,
} from "@tomflow/proflow-model-contracts";
import { z } from "zod";

export type ModelRole = "fast" | "reason";
export type RoleState = "READY" | "UNAVAILABLE";

export type RoleConfiguration = {
	profile: ModelCapabilityProfile;
	state: RoleState;
	reason?: string;
	verification: {
		status: "PASS" | "FAIL";
		verifiedAt: string;
		reasoningBasis:
			| "provider-response-thinking-absent"
			| "provider-response-thinking-closed";
	};
};

const verifiedRolesBrand: unique symbol = Symbol("verified-model-roles");

export type ModelRoles = Record<ModelRole, RoleConfiguration> & {
	readonly [verifiedRolesBrand]: true;
};

export type DeclaredModelRoles = Record<
	ModelRole,
	{ profile: ModelCapabilityProfile }
>;

export type ProviderCall = {
	role: ModelRole;
	request: InferenceRequest;
	spec: ReasoningSpec<unknown, unknown>;
	prompt: string;
	repair: boolean;
};

export type ProviderResponse = {
	content: string;
	providerRequestRef?: string;
	finishReason?: string;
	thinkingStatus?: "absent" | "closed" | "unclosed";
};

export type ModelProvider = {
	infer(call: ProviderCall, signal: AbortSignal): Promise<ProviderResponse>;
};

const completionResponseSchema = z
	.object({
		id: z.string().optional(),
		choices: z
			.array(
				z
					.object({
						finish_reason: z.string().optional(),
						message: z.object({ content: z.string() }).passthrough(),
					})
					.passthrough(),
			)
			.min(1),
	})
	.passthrough();

export type OpenAICompatibleProviderConfig = {
	baseUrl: string;
	apiKey?: string;
	models: Record<ModelRole, string>;
	roleBody?: Partial<Record<ModelRole, Readonly<Record<string, unknown>>>>;
	roleSystemPrompt?: Partial<Record<ModelRole, string>>;
	fetch?: typeof globalThis.fetch;
};

function stripProviderThinking(content: string): {
	content: string;
	thinkingStatus: "absent" | "closed";
} {
	const trimmed = content.trim();
	if (!trimmed.startsWith("<think>"))
		return { content: trimmed, thinkingStatus: "absent" };
	const end = trimmed.indexOf("</think>");
	if (end < 0) throw new Error("provider returned an unclosed thinking block");
	return {
		content: trimmed.slice(end + "</think>".length).trim(),
		thinkingStatus: "closed",
	};
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export function createOpenAICompatibleProvider(
	config: OpenAICompatibleProviderConfig,
): ModelProvider {
	const fetchImplementation = config.fetch ?? globalThis.fetch;
	const endpoint = new URL(
		"chat/completions",
		config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`,
	);
	return {
		async infer(call, signal) {
			const outputSchema = stableJson(
				z.toJSONSchema(call.spec.outputSchema, { unrepresentable: "any" }),
			);
			const systemPrompt = [
				config.roleSystemPrompt?.[call.role] ??
					"You are a controlled inference engine.",
				"Return exactly one JSON object matching OUTPUT_SCHEMA. Do not add markdown or prose outside that JSON object.",
				`OUTPUT_SCHEMA=${outputSchema}`,
			].join("\n");
			const userContent = call.request.images
				? [
						{ type: "text", text: call.prompt },
						...call.request.images.map((image) => ({
							type: "image_url",
							image_url: { url: `data:${image.mimeType};base64,${image.data}` },
						})),
					]
				: call.prompt;
			const repairInstruction = call.repair
				? "The previous output was invalid. Return only corrected JSON matching the required schema."
				: undefined;
			const response = await fetchImplementation(endpoint, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(config.apiKey
						? { authorization: `Bearer ${config.apiKey}` }
						: {}),
				},
				body: JSON.stringify({
					model: config.models[call.role],
					messages: [
						{
							role: "system",
							content: systemPrompt,
						},
						{ role: "user", content: userContent },
						...(repairInstruction
							? [{ role: "user", content: repairInstruction }]
							: []),
					],
					max_tokens: call.spec.maxOutputTokens,
					response_format: { type: "json_object" },
					...(config.roleBody?.[call.role] ?? {}),
				}),
				signal,
			});
			if (!response.ok) {
				throw new Error(`provider returned HTTP ${response.status}`);
			}
			const parsed = completionResponseSchema.parse(await response.json());
			const content = parsed.choices[0]?.message.content;
			if (!content)
				throw new Error("provider response did not contain message content");
			const stripped = stripProviderThinking(content);
			return {
				content: stripped.content,
				thinkingStatus: stripped.thinkingStatus,
				...(parsed.id ? { providerRequestRef: parsed.id } : {}),
				...(parsed.choices[0]?.finish_reason
					? { finishReason: parsed.choices[0].finish_reason }
					: {}),
			};
		},
	};
}

export type ObservedRoleCapabilities = Record<
	ModelRole,
	{
		text: boolean;
		image: boolean;
		structuredOutput: boolean;
		reasoning: "thinking" | "no-thinking";
		reasoningBasis:
			| "provider-response-thinking-absent"
			| "provider-response-thinking-closed";
		verifiedAt: string;
	}
>;

export function verifyRoleCapabilities(input: {
	declared: DeclaredModelRoles;
	observed: ObservedRoleCapabilities;
}): ModelRoles {
	const roles = Object.fromEntries(
		(["fast", "reason"] as const).map((role) => {
			const declared = input.declared[role];
			const observed = input.observed[role];
			const requiredReasoning = role === "fast" ? "no-thinking" : "thinking";
			const requiredBasis =
				role === "fast"
					? "provider-response-thinking-absent"
					: "provider-response-thinking-closed";
			const ready =
				observed.text &&
				observed.structuredOutput &&
				observed.reasoning === requiredReasoning &&
				observed.reasoningBasis === requiredBasis &&
				declared.profile.reasoningModes.includes(requiredReasoning) &&
				declared.profile.inputModalities.includes("text") &&
				declared.profile.structuredOutput !== "unsupported" &&
				(!declared.profile.inputModalities.includes("image") || observed.image);
			return [
				role,
				Object.freeze({
					...declared,
					state: ready ? ("READY" as const) : ("UNAVAILABLE" as const),
					...(!ready ? { reason: "capability verification mismatch" } : {}),
					verification: {
						status: ready ? ("PASS" as const) : ("FAIL" as const),
						verifiedAt: observed.verifiedAt,
						reasoningBasis: observed.reasoningBasis,
					},
				}),
			];
		}),
	) as Record<ModelRole, RoleConfiguration>;
	Object.defineProperty(roles, verifiedRolesBrand, { value: true });
	return Object.freeze(roles) as ModelRoles;
}

export function assertVerifiedModelRoles(
	roles: unknown,
	input: { now: number; maxAgeMs: number },
): asserts roles is ModelRoles {
	if (
		typeof roles !== "object" ||
		roles === null ||
		Reflect.get(roles, verifiedRolesBrand) !== true
	) {
		throw new TypeError(
			"Model roles require current capability verification; caller-supplied READY is forbidden",
		);
	}
	const verified = roles as ModelRoles;
	for (const role of ["fast", "reason"] as const) {
		const verifiedAt = Date.parse(verified[role].verification.verifiedAt);
		const age = input.now - verifiedAt;
		if (!Number.isFinite(verifiedAt) || age < -30_000 || age > input.maxAgeMs)
			throw new TypeError(`role ${role} capability verification is stale`);
	}
}
