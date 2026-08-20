export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "execution-runtime",
	packageName: "@tomflow/proflow-execution-runtime",
	moduleVersion: "0.1.8",
	kind: "service",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	identity: {
		domain: "execution",
		summary:
			"Durable, policy-controlled Execution Core orchestration over SQLite and controlled executor ports.",
	},
	provides: [
		{
			contractRef: "execution",
			version: "1.0.0",
		},
	],
	requires: [
		{
			contractRef: "execution-local",
			versionRange: ">=1.0.0 <2.0.0",
		},
	],
	requirements: [
		{
			kind: "runtime",
			runtime: "node",
			versionRange: ">=24.19.0",
		},
		{
			kind: "filesystem",
			path: ".proflow",
			access: "read-write",
		},
	],
	configSlots: [],
	effects: [
		{
			kind: "process",
			description: "Runs the single backend Execution Runtime service",
			retention: "remove",
		},
		{
			kind: "filesystem",
			description:
				"Persists execution state, output references and evidence in WAL SQLite",
			retention: "preserve",
		},
	],
	documentation: {
		docs: "DOCS.md",
		setup: "SETUP.md",
	},
} as const;
