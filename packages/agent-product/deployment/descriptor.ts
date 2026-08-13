export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "agent-product",
	packageName: "@tomflow/proflow-agent-product",
	moduleVersion: "0.1.0",
	kind: "agent-package",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	provides: [],
	requires: [
		{
			contractRef: "custom-gpt-actions-gateway",
			versionRange: ">=1.0.0 <2.0.0",
		},
	],
	requirements: [
		{ kind: "runtime", runtime: "node", versionRange: ">=24.19.0" },
		{ kind: "network", url: "https://chatgpt.com/" },
		{ kind: "human", action: "Materialize and verify the Custom GPT carrier" },
	],
	configSlots: [],
	lifecycle: {
		supported: ["describe", "preflight", "status", "verify", "doctor"],
	},
	verification: {
		checks: [
			{
				id: "agent-package-material",
				description: "Static Custom GPT package material is complete",
				lifecycle: "verify",
			},
		],
	},
	effects: [
		{
			kind: "external-resource",
			description: "Register an agent package through an explicit action",
		},
	],
} as const;
