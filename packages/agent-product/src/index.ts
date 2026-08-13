export type AgentPackageMaterial = {
	packageName: string;
	version: string;
	displayName: string;
	instructions: string;
	conversationStarters: string[];
	knowledgeFiles: string[];
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
	if (agent?.kind !== "agent-package" || !carrier)
		throw new TypeError("invalid Agent Package manifest");
	return {
		packageName: String(metadata.name),
		version: String(metadata.version),
		displayName: String(agent.displayName),
		instructions: String(agent.instructions),
		conversationStarters: [...(agent.conversationStarters as string[])],
		knowledgeFiles: [...(carrier.knowledgeFiles as string[])],
		actionSchema: String(carrier.actionSchema),
	};
}
