export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "execution-contracts",
	packageName: "@tomflow/proflow-execution-contracts",
	moduleVersion: "0.1.2",
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
		{ kind: "runtime", runtime: "node", versionRange: ">=24.19.0" },
	],
	configSlots: [],
	lifecycle: {
		supported: ["describe", "preflight", "status", "verify", "doctor"],
	},
	verification: {
		checks: [
			{
				id: "execution-contract-boundaries",
				description:
					"Execution public schemas reject invalid state and effect combinations",
				lifecycle: "verify",
			},
		],
	},
	effects: [],
	documentation: [
		{
			id: "overview",
			path: "./README.md",
			description: "Package-owned module overview",
		},
	],
} as const;
