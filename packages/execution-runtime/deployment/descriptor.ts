export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "execution-runtime",
	packageName: "@tomflow/proflow-execution-runtime",
	moduleVersion: "0.1.0",
	kind: "service",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	provides: [{ contractRef: "execution", version: "1.0.0" }],
	requires: [
		{ contractRef: "execution-local", versionRange: ">=1.0.0 <2.0.0" },
	],
	requirements: [
		{ kind: "runtime", runtime: "node", versionRange: ">=24.19.0" },
		{ kind: "filesystem", path: ".proflow", access: "read-write" },
	],
	configSlots: [
		{
			key: "databasePath",
			type: "path",
			required: true,
			description: "Execution SQLite database",
		},
	],
	lifecycle: {
		supported: [
			"describe",
			"preflight",
			"status",
			"verify",
			"doctor",
			"start",
			"stop",
			"restart",
		],
	},
	verification: {
		checks: [
			{
				id: "execution-runtime-critical-proofs",
				description: "All seven runtime proofs pass",
				lifecycle: "verify",
			},
		],
	},
	effects: [
		{
			kind: "process",
			description: "Runs the single backend Execution Runtime service",
		},
		{
			kind: "filesystem",
			description:
				"Persists execution state, output references and evidence in WAL SQLite",
		},
	],
} as const;
