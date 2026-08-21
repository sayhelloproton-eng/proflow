export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "execution-contracts",
	packageName: "@tomflow/proflow-execution-contracts",
	moduleVersion: "0.1.6",
	kind: "library",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	identity: {
		domain: "execution",
		summary:
			"Typed public Execution contracts and runtime validation for the ProFlow real-world effect plane.",
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
