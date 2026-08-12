export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "task-orchestration",
	packageName: "@tomflow/proflow-task-orchestration",
	moduleVersion: "0.1.0",
	kind: "library",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	provides: [{ contractRef: "task-orchestration", version: "1.0.0" }],
	requires: [],
	requirements: [
		{ kind: "runtime", runtime: "node", versionRange: ">=24.19.0" },
	],
	configSlots: [],
	lifecycle: { supported: ["describe", "preflight", "verify", "doctor"] },
	verification: {
		checks: [
			{
				id: "task-domain-tests-pass",
				description: "Task orchestration Critical Proofs pass",
				lifecycle: "verify",
			},
		],
	},
	effects: [
		{
			kind: "filesystem",
			description:
				"Owns TaskDocument Markdown writes inside the configured workspace",
		},
	],
} as const;
