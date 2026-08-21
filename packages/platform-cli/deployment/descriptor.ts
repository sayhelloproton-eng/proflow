export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "platform-cli",
	packageName: "@tomflow/proflow-platform-cli",
	moduleVersion: "0.1.26",
	kind: "cli",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	identity: {
		domain: "deployment-governance",
		summary:
			"Thin Platform CLI for Module discovery, documentation, package synchronization and lifecycle orchestration.",
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
