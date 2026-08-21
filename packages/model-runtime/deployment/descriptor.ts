export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "model-runtime",
	packageName: "@tomflow/proflow-model-runtime",
	moduleVersion: "0.1.12",
	kind: "service",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	identity: {
		domain: "model-reasoning",
		summary:
			"Provides the ProFlow Model Runtime service with FAST/REASON routing, provider capability checks and inference observability.",
	},
	provides: [
		{
			contractRef: "model-inference",
			version: "1.0.0",
		},
	],
	requires: [
		{
			contractRef: "model.provider.api",
			versionRange: ">=1.0.0 <2.0.0",
		},
	],
	requirements: [
		{
			kind: "runtime",
			runtime: "node",
			versionRange: ">=24.19.0",
		},
	],
	configSlots: [
		{
			key: "fastModel",
			type: "string",
			required: true,
			description: "Provider model identifier for FAST",
		},
		{
			key: "reasonModel",
			type: "string",
			required: true,
			description: "Provider model identifier for REASON",
		},
	],
	effects: [
		{
			kind: "process",
			description: "Runs the Model Runtime HTTP service process",
			retention: "remove",
		},
		{
			kind: "network",
			description: "Calls the configured model provider API",
			retention: "preserve",
		},
	],
	documentation: {
		docs: "DOCS.md",
		setup: "SETUP.md",
	},
} as const;
