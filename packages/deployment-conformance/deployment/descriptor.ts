export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "deployment-conformance",
	packageName: "@tomflow/proflow-deployment-conformance",
	moduleVersion: "0.1.8",
	kind: "cli",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	identity: {
		domain: "deployment-governance",
		summary:
			"Validates ProFlow module contract, package and behavior conformance.",
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
