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
};

export type ModelRoles = Record<ModelRole, RoleConfiguration>;

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
					.object({ message: z.object({ content: z.string() }).passthrough() })
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

function stripProviderThinking(content: string): string {
	const trimmed = content.trim();
	if (!trimmed.startsWith("<think>")) return trimmed;
	const end = trimmed.indexOf("</think>");
	if (end < 0) throw new Error("provider returned an unclosed thinking block");
	return trimmed.slice(end + "</think>".length).trim();
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
							content:
								config.roleSystemPrompt?.[call.role] ??
								"You are a controlled inference engine. Keep reasoning bounded and return only the final JSON object after any provider-internal thinking.",
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
			return {
				content: stripProviderThinking(content),
				...(parsed.id ? { providerRequestRef: parsed.id } : {}),
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
	}
>;

export function verifyRoleCapabilities(input: {
	declared: ModelRoles;
	observed: ObservedRoleCapabilities;
}): ModelRoles {
	return Object.fromEntries(
		(["fast", "reason"] as const).map((role) => {
			const declared = input.declared[role];
			const observed = input.observed[role];
			const requiredReasoning = role === "fast" ? "no-thinking" : "thinking";
			const ready =
				declared.state === "READY" &&
				observed.text &&
				observed.structuredOutput &&
				observed.reasoning === requiredReasoning &&
				(!declared.profile.inputModalities.includes("image") || observed.image);
			return [
				role,
				ready
					? declared
					: {
							...declared,
							state: "UNAVAILABLE" as const,
							reason: "capability verification mismatch",
						},
			];
		}),
	) as ModelRoles;
}
