export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "task-migration-runner",
	packageName: "@tomflow/proflow-task-migration-runner",
	moduleVersion: "0.1.0",
	kind: "cli",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	installClass: "core",
	identity: {
		domain: "task-orchestration",
		summary: "Deterministically discovers, applies and verifies Task Store SQLite schema migrations.",
	},
	provides: [],
	requires: [],
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
	lifecycle: {
		supported: [
			"describe",
			"preflight",
			"status",
			"verify",
			"doctor",
			"migrate",
		],
	},
	verification: {
		checks: [
			{
				id: "migration-state-pass",
				description: "Migration state matches the Task schema",
				lifecycle: "verify",
			},
		],
	},
	effects: [
		{
			kind: "filesystem",
			description: "Applies Task Store migration SQL to SQLite",
			retention: "preserve",
		},
	],
	documentation: [
		{ id: "overview", path: "./README.md", description: "Package-owned module overview" },
	],
} as const;
