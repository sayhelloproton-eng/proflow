export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "execution-browser-extension",
	packageName: "@tomflow/proflow-execution-browser-extension",
	moduleVersion: "0.1.4",
	kind: "browser-extension",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	identity: {
		domain: "execution",
		summary:
			"Execution-owned MV3 Browser executor, evidence provider and browser application surface.",
	},
	provides: [
		{
			contractRef: "execution-browser-executor",
			version: "1.0.0",
		},
	],
	requires: [
		{
			contractRef: "execution",
			versionRange: ">=1.0.0 <2.0.0",
		},
		{
			contractRef: "task-orchestration",
			versionRange: ">=1.0.0 <2.0.0",
		},
		{
			contractRef: "agent-runtime",
			versionRange: ">=1.0.0 <2.0.0",
		},
	],
	requirements: [
		{
			kind: "runtime",
			runtime: "browser",
			versionRange: ">=1",
		},
		{
			kind: "human",
			action:
				"Load and verify the unpacked MV3 extension in the real Chrome profile",
		},
	],
	configSlots: [],
	effects: [
		{
			kind: "external-resource",
			description:
				"Package an MV3 extension that performs Execution-authorized Browser effects",
			retention: "preserve",
		},
	],
	documentation: {
		docs: "DOCS.md",
		setup: "SETUP.md",
	},
} as const;
