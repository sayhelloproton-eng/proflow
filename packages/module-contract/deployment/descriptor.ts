export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "module-contract",
	packageName: "@tomflow/proflow-module-contract",
	moduleVersion: "0.1.4",
	kind: "library",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	identity: {
		domain: "deployment-governance",
		summary: "Defines the canonical governance contract for ProFlow modules.",
	},
	provides: [],
	requires: [],
	requirements: [
		{
			kind: "runtime",
			runtime: "node",
			versionRange: ">=24.19.0",
		},
	],
	configSlots: [],
	effects: [],
	documentation: {
		docs: "DOCS.md",
		setup: "SETUP.md",
	},
} as const;
