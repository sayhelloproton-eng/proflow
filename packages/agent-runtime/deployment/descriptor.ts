export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "agent-runtime",
	packageName: "@tomflow/proflow-agent-runtime",
	moduleVersion: "0.1.0",
	kind: "library",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	installClass: "core",
	identity: {
		domain: "agent-runtime-collaboration",
		summary:
			"Agent-owned Role Registry, credential binding and Collaboration durable runtime.",
	},
	provides: [{ contractRef: "agent-runtime", version: "1.0.0" }],
	requires: [
		{ contractRef: "task-orchestration", versionRange: ">=1.0.0 <2.0.0" },
		{ contractRef: "execution", versionRange: ">=1.0.0 <2.0.0" },
	],
	requirements: [
		{ kind: "runtime", runtime: "node", versionRange: ">=24.19.0" },
	],
	configSlots: [],
	lifecycle: { supported: ["describe", "preflight", "verify", "doctor"] },
	verification: {
		checks: [
			{
				id: "agent-runtime-boundary",
				description: "Agent runtime owner boundary is available",
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
