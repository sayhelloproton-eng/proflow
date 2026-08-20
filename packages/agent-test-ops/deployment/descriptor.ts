export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "agent-test-ops",
	packageName: "@tomflow/proflow-agent-test-ops",
	moduleVersion: "0.1.5",
	kind: "agent-package",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	identity: {
		domain: "agent-runtime-collaboration",
		summary:
			"Versioned Test/Operations Custom GPT materialization package for the fixed Test-Ops role.",
	},
	provides: [],
	requires: [
		{
			contractRef: "custom-gpt-actions-gateway",
			versionRange: ">=1.0.0 <2.0.0",
		},
	],
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
	configSlots: [
		{
			key: "carrierModuleRef",
			type: "moduleRef",
			required: false,
			description: "External resource module governing the Custom GPT carrier",
			default: "chatgpt-carrier",
		},
	],
	effects: [
		{
			kind: "external-resource",
			description: "Register an agent package through an explicit action",
			retention: "preserve",
		},
	],
	documentation: {
		docs: "DOCS.md",
		setup: "SETUP.md",
	},
} as const;
