export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "module-contract",
	packageName: "@tomflow/proflow-module-contract",
	moduleVersion: "0.1.3",
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
		{ kind: "runtime", runtime: "node", versionRange: ">=24.19.0" },
	],
	configSlots: [],
	lifecycle: {
		supported: ["describe", "preflight", "status", "verify", "doctor"],
	},
	verification: {
		checks: [
			{
				id: "contract-tests-pass",
				description: "Module contract tests pass",
				lifecycle: "verify",
			},
		],
	},
	effects: [],
	documentation: [
		{
			id: "overview",
			path: "./README.md",
			description: "Module contract package overview",
		},
	],
} as const;
