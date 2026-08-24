export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "chatgpt-carrier",
	packageName: "@tomflow/proflow-chatgpt-carrier",
	moduleVersion: "0.1.12",
	kind: "external-resource",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	identity: {
		domain: "deployment-governance",
		summary:
			"Observes ChatGPT Web external availability without duplicating Agent-owned Role or capability truth.",
	},
	provides: [],
	requires: [],
	requirements: [
		{
			kind: "runtime",
			runtime: "node",
			versionRange: ">=24.19.0",
		},
		{
			kind: "network",
			url: "https://chatgpt.com/",
		},
	],
	configSlots: [],
	effects: [
		{
			kind: "external-resource",
			description: "Observes ChatGPT Web external availability",
			retention: "preserve",
		},
	],
	documentation: {
		docs: "DOCS.md",
		setup: "SETUP.md",
	},
} as const;
