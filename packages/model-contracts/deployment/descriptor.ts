export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "model-contracts",
	packageName: "@tomflow/proflow-model-contracts",
	moduleVersion: "0.1.8",
	kind: "library",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	identity: {
		domain: "model-reasoning",
		summary:
			"Typed public Model & Reasoning contracts and runtime validation for ProFlow inference.",
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
