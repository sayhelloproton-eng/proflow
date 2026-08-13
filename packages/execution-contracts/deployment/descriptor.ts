export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "execution-contracts",
	packageName: "@tomflow/proflow-execution-contracts",
	moduleVersion: "0.1.0",
	kind: "library",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	provides: [{ contractRef: "execution", version: "1.0.0" }],
	requires: [],
	requirements: [
		{ kind: "runtime", runtime: "node", versionRange: ">=24.19.0" },
	],
	configSlots: [],
	lifecycle: { supported: ["describe", "preflight", "verify", "doctor"] },
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
} as const;
