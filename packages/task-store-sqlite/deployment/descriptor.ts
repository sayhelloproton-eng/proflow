export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "task-store-sqlite",
	packageName: "@tomflow/proflow-task-store-sqlite",
	moduleVersion: "0.1.0",
	kind: "library",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	provides: [],
	requires: [
		{ contractRef: "task-orchestration", versionRange: ">=1.0.0 <2.0.0" },
	],
	requirements: [
		{ kind: "runtime", runtime: "node", versionRange: ">=24.19.0" },
	],
	configSlots: [
		{
			key: "databasePath",
			type: "path",
			required: true,
			description: "Task SQLite database path",
		},
	],
	lifecycle: { supported: ["describe", "preflight", "verify", "doctor"] },
	verification: {
		checks: [
			{
				id: "sqlite-integrity-pass",
				description: "SQLite schema and integrity checks pass",
				lifecycle: "verify",
			},
		],
	},
	effects: [
		{
			kind: "filesystem",
			description: "Persists Task-owned structured facts in SQLite",
		},
	],
} as const;
