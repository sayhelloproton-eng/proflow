export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "chatgpt-carrier",
	packageName: "@tomflow/proflow-chatgpt-carrier",
	moduleVersion: "0.1.8",
	kind: "external-resource",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	identity: {
		domain: "deployment-governance",
		summary:
			"Governs and verifies the real-world ChatGPT Custom GPT carrier without faking readiness.",
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
		{
			kind: "human",
			action: "Materialize and verify the Custom GPT carrier",
		},
	],
	configSlots: [],
	effects: [
		{
			kind: "external-resource",
			description: "Observes the ChatGPT Custom GPT carrier",
			retention: "preserve",
		},
	],
	documentation: {
		docs: "DOCS.md",
		setup: "SETUP.md",
	},
} as const;
