export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "agent-gateway",
	packageName: "@tomflow/proflow-agent-gateway",
	moduleVersion: "0.1.5",
	kind: "service",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	identity: {
		domain: "agent-runtime-collaboration",
		summary:
			"The sole Custom GPT Actions HTTP ingress and OpenAI transport anti-corruption layer.",
	},
	provides: [
		{
			contractRef: "custom-gpt-actions-gateway",
			version: "1.0.0",
		},
	],
	requires: [
		{
			contractRef: "agent-runtime",
			versionRange: ">=1.0.0 <2.0.0",
		},
		{
			contractRef: "task-orchestration",
			versionRange: ">=1.0.0 <2.0.0",
		},
		{
			contractRef: "execution",
			versionRange: ">=1.0.0 <2.0.0",
		},
	],
	requirements: [
		{
			kind: "runtime",
			runtime: "node",
			versionRange: ">=24.19.0",
		},
	],
	configSlots: [],
	effects: [
		{
			kind: "process",
			description: "Manage the declared service process",
			retention: "remove",
		},
	],
	documentation: {
		docs: "DOCS.md",
		setup: "SETUP.md",
	},
} as const;
