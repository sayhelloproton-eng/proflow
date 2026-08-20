export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "model-runtime",
	packageName: "@tomflow/proflow-model-runtime",
	moduleVersion: "0.1.6",
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
			key: "stateRoot",
			type: "path",
			required: true,
			description: "Absolute .proflow owner state root",
		},
		{
			key: "transportCredentialFile",
			type: "path",
			required: true,
			sensitive: true,
			description:
				"File containing the dedicated local credential required by Model Runtime callers",
		},
		{
			key: "providerBaseUrl",
			type: "url",
			required: true,
			description: "OpenAI-compatible provider API base URL",
		},
		{
			key: "providerCredential",
			type: "secretRef",
			required: false,
			sensitive: true,
			description: "Credential reference resolved outside module configuration",
		},
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
		{
			key: "capabilityProfilesFile",
			type: "path",
			required: true,
			description:
				"JSON file containing Deployment-configured FAST/REASON ModelCapabilityProfile values",
		},
		{
			key: "providerModuleRef",
			type: "moduleRef",
			required: false,
			description: "External resource module governing the provider API",
			default: "model-provider-api",
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
			"uninstall",
		],
	},
	verification: {
		checks: [
			{
				id: "runtime-status-fresh",
				description: "Runtime reports fresh role and lane diagnostics",
				lifecycle: "status",
			},
			{
				id: "real-provider-capabilities",
				description: "Configured provider roles pass live capability probes",
				lifecycle: "verify",
			},
			{
				id: "provider-diagnostics",
				description: "Provider configuration has actionable diagnostics",
				lifecycle: "doctor",
			},
		],
	},
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
	documentation: [
		{
			id: "overview",
			path: "./README.md",
			description: "Model Runtime package overview",
		},
		{
			id: "configuration",
			path: "./CONFIGURATION.md",
			description:
				"Module configuration fields, sources and materialization instructions",
		},
	],
} as const;
