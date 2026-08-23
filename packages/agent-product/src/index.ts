export type CustomGptCapabilities = {
	webSearch: boolean;
	imageGeneration: boolean;
	codeInterpreter: boolean;
};

export type AgentPackageMaterial = {
	packageName: string;
	version: string;
	displayName: string;
	description: string;
	instructions: string;
	conversationStarters: string[];
	recommendedModel: string;
	capabilities: CustomGptCapabilities;
	knowledgeBundle: string;
	actionSchema: string;
};

export function materializeAgentPackage(input: unknown): AgentPackageMaterial {
	if (!input || typeof input !== "object")
		throw new TypeError("invalid package metadata");
	const metadata = input as Record<string, unknown>;
	const agent = metadata.proflowAgent as Record<string, unknown> | undefined;
	const carrier = (
		agent?.carrierProfiles as
			| Record<string, Record<string, unknown>>
			| undefined
	)?.["custom-gpt"];
	const capabilities = carrier?.capabilities as
		| Record<string, unknown>
		| undefined;
	if (
		agent?.kind !== "agent-package" ||
		!carrier ||
		typeof metadata.description !== "string" ||
		typeof carrier.recommendedModel !== "string" ||
		typeof carrier.knowledgeBundle !== "string" ||
		typeof carrier.actionSchema !== "string" ||
		!capabilities ||
		typeof capabilities.webSearch !== "boolean" ||
		typeof capabilities.imageGeneration !== "boolean" ||
		typeof capabilities.codeInterpreter !== "boolean"
	)
		throw new TypeError("invalid Agent Package manifest");
	return {
		packageName: String(metadata.name),
		version: String(metadata.version),
		displayName: String(agent.displayName),
		description: metadata.description,
		instructions: String(agent.instructions),
		conversationStarters: [...(agent.conversationStarters as string[])],
		recommendedModel: carrier.recommendedModel,
		capabilities: {
			webSearch: capabilities.webSearch,
			imageGeneration: capabilities.imageGeneration,
			codeInterpreter: capabilities.codeInterpreter,
		},
		knowledgeBundle: carrier.knowledgeBundle,
		actionSchema: carrier.actionSchema,
	};
}
