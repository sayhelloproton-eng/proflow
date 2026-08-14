export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "platform-cli",
	packageName: "@tomflow/proflow-platform-cli",
	moduleVersion: "0.1.0",
	kind: "cli",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
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
				id: "cli-surface",
				description: "Deterministic command surface parses and dispatches",
				lifecycle: "verify",
			},
		],
	},
	effects: [],
} as const;
